import type { Agent } from "../agent.js"
import type { Session } from "../session.js"

/** Regex for validating session ID format: alphanumeric, hyphens, underscores, max 128 chars. */
const SESSION_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/

/** Default max input length in characters. */
const DEFAULT_MAX_INPUT_LENGTH = 100_000

/** Default session TTL in milliseconds (30 minutes). */
const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000

/** Default max concurrent sessions. */
const DEFAULT_MAX_SESSIONS = 10_000

/**
 * Options for the HTTP handler.
 */
export interface HandlerOptions {
  /** Header name for session ID. Default: `"x-session-id"`. */
  sessionIdHeader?: string
  /** Maximum input string length in characters. Default: 100000. */
  maxInputLength?: number
  /** Session TTL in milliseconds. Sessions are evicted after this period of inactivity. Default: 1800000 (30 min). */
  sessionTtlMs?: number
  /** Maximum number of concurrent sessions. New sessions are rejected when limit is reached. Default: 10000. */
  maxSessions?: number
}

interface SessionEntry {
  session: Session
  lastAccess: number
}

/**
 * Creates a Web-standard `Request → Response` handler for an agent.
 *
 * The handler parses a JSON request body (`{ input: string }`),
 * runs one turn in a session, and streams `Event` objects back
 * as Server-Sent Events.
 *
 * Sessions are kept in memory keyed by session ID with automatic TTL eviction.
 * If no session ID is provided, a new ephemeral session is created and closed
 * after the request. If a session ID is provided, the session persists across
 * requests — conversation history and state are maintained until TTL expires.
 *
 * Security:
 * - Input length is capped (default 100K chars)
 * - Session count is capped (default 10K) to prevent memory exhaustion
 * - Idle sessions are evicted after TTL (default 30 min)
 * - Session IDs are validated against a strict format
 * - Error messages sent to clients are generic (no internal details)
 * - Authentication/authorization is the caller's responsibility
 *
 * @param agent - The Agent instance to handle requests for
 * @param options - Optional handler configuration
 * @returns A function that takes a `Request` and returns a `Response`
 */
export function createHandler(
  agent: Agent,
  options?: HandlerOptions,
): (req: Request) => Response {
  const sessionIdHeader = options?.sessionIdHeader ?? "x-session-id"
  const maxInputLength = options?.maxInputLength ?? DEFAULT_MAX_INPUT_LENGTH
  const sessionTtlMs = options?.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS
  const maxSessions = options?.maxSessions ?? DEFAULT_MAX_SESSIONS
  const sessions = new Map<string, SessionEntry>()

  /** Evict sessions that haven't been accessed within TTL. */
  function evictExpired(): void {
    const now = Date.now()
    for (const [id, entry] of sessions) {
      if (now - entry.lastAccess > sessionTtlMs) {
        entry.session.close().catch(() => {})
        sessions.delete(id)
      }
    }
  }

  return (req: Request): Response => {
    // Only POST allowed
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json", Allow: "POST" },
      })
    }

    // Extract session ID from header (before stream for use in response headers)
    const rawSessionId = req.headers.get(sessionIdHeader) ?? undefined

    const encoder = new TextEncoder()
    const responseHeaders: Record<string, string> = {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    }
    if (rawSessionId) {
      responseHeaders[sessionIdHeader] = rawSessionId
    }

    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Validate request body
          let body: unknown
          try {
            body = await req.json()
          } catch {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", message: "Invalid JSON body" })}\n\n`))
            controller.close()
            return
          }

          if (!body || typeof body !== "object" || typeof (body as Record<string, unknown>)["input"] !== "string") {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", message: "Request body must have a string 'input' field" })}\n\n`))
            controller.close()
            return
          }

          const { input } = body as { input: string }

          // Validate input length
          if (input.length > maxInputLength) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", message: "Input too long" })}\n\n`))
            controller.close()
            return
          }

          // Validate session ID format
          if (rawSessionId && !SESSION_ID_RE.test(rawSessionId)) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", message: "Invalid session ID format" })}\n\n`))
            controller.close()
            return
          }

          // Evict expired sessions periodically
          evictExpired()

          await agent.init()

          // Reuse existing session or create a new one
          const isEphemeral = !rawSessionId
          let session: Session
          if (rawSessionId && sessions.has(rawSessionId)) {
            const entry = sessions.get(rawSessionId)!
            entry.lastAccess = Date.now()
            session = entry.session
          } else if (rawSessionId) {
            // Check session limit
            if (sessions.size >= maxSessions) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", message: "Too many active sessions" })}\n\n`))
              controller.close()
              return
            }
            session = agent.session({ id: rawSessionId })
            sessions.set(rawSessionId, { session, lastAccess: Date.now() })
          } else {
            session = agent.session()
          }

          try {
            const run = session.run(input)

            for await (const event of run) {
              const data = `data: ${JSON.stringify(event)}\n\n`
              controller.enqueue(encoder.encode(data))
            }

            // Append a final SSE message with the run result so consumers
            // get text + state snapshot without having to track them through
            // individual events. Not part of the event log itself.
            try {
              const result = await run.result
              const data = `data: ${JSON.stringify({ type: "result", result })}\n\n`
              controller.enqueue(encoder.encode(data))
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err)
              const data = `data: ${JSON.stringify({ type: "result", error: message })}\n\n`
              controller.enqueue(encoder.encode(data))
            }
          } finally {
            // Only close ephemeral (no session ID) sessions
            if (isEphemeral) {
              await session.close()
            }
          }

          controller.close()
        } catch {
          // Send generic error to client, not raw error.message
          const data = `data: ${JSON.stringify({ type: "error", message: "Internal error" })}\n\n`
          controller.enqueue(encoder.encode(data))
          controller.close()
        }
      },
    })

    return new Response(stream, { headers: responseHeaders })
  }
}

/** Minimal Node.js IncomingMessage shape (duck typed, no Express import needed). */
interface NodeRequest {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
  [Symbol.asyncIterator](): AsyncIterableIterator<Buffer | Uint8Array>
}

/** Minimal Node.js ServerResponse shape (duck typed, no Express import needed). */
interface NodeResponse {
  status?: (code: number) => unknown
  statusCode?: number
  setHeader(name: string, value: string): void
  write(chunk: unknown): boolean
  end(): void
}

/**
 * Wraps a Web-standard handler into an Express.js route handler.
 *
 * Converts Express `req`/`res` to Web `Request`/`Response` and streams the SSE response back.
 *
 * @example
 * ```typescript
 * import { createHandler, toExpressHandler } from "agent-express/http"
 * const handler = createHandler(agent)
 * app.post("/api/agent", toExpressHandler(handler))
 * ```
 */
export function toExpressHandler(
  handler: (req: Request) => Response,
): (req: NodeRequest, res: NodeResponse) => Promise<void> {
  return async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const body = Buffer.concat(chunks).toString()

    const headers: Record<string, string> = {}
    for (const [key, val] of Object.entries(req.headers)) {
      if (val !== undefined) headers[key] = Array.isArray(val) ? val[0]! : val
    }

    const host = headers["host"] ?? "localhost"
    const proto = headers["x-forwarded-proto"] ?? "http"
    const webReq = new Request(`${proto}://${host}${req.url ?? "/"}`, {
      method: req.method ?? "POST",
      headers,
      body,
    })

    const response = handler(webReq)

    if (res.status) {
      res.status(response.status)
    } else {
      res.statusCode = response.status
    }
    response.headers.forEach((value, key) => res.setHeader(key, value))

    const reader = response.body?.getReader()
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(value)
      }
    }
    res.end()
  }
}

/**
 * Wraps a Web-standard handler into a Fastify route handler.
 *
 * Converts Fastify request/reply to Web `Request`/`Response` and streams the SSE response back.
 *
 * @example
 * ```typescript
 * import { createHandler, toFastifyHandler } from "agent-express/http"
 * const handler = createHandler(agent)
 * fastify.post("/api/agent", toFastifyHandler(handler))
 * ```
 */
export function toFastifyHandler(
  handler: (req: Request) => Response,
): (request: { url: string; headers: Record<string, string | string[] | undefined>; body: unknown }, reply: { status(code: number): unknown; header(name: string, value: string): unknown; raw: { write(chunk: unknown): boolean; end(): void } }) => Promise<void> {
  return async (request, reply) => {
    const headers: Record<string, string> = {}
    for (const [key, val] of Object.entries(request.headers)) {
      if (val !== undefined) headers[key] = Array.isArray(val) ? val[0]! : val
    }

    const host = headers["host"] ?? "localhost"
    const proto = headers["x-forwarded-proto"] ?? "http"
    const webReq = new Request(`${proto}://${host}${request.url}`, {
      method: "POST",
      headers,
      body: JSON.stringify(request.body),
    })

    const response = handler(webReq)

    reply.status(response.status)
    response.headers.forEach((value, key) => reply.header(key, value))

    const reader = response.body?.getReader()
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        reply.raw.write(value)
      }
    }
    reply.raw.end()
  }
}
