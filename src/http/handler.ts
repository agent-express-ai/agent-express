import type { Agent } from "../agent.js"

/** Regex for validating session ID format: alphanumeric, hyphens, underscores, max 128 chars. */
const SESSION_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/

/**
 * Options for the HTTP handler.
 */
export interface HandlerOptions {
  /** Header name for session ID. Default: `"x-session-id"`. */
  sessionIdHeader?: string
}

/**
 * Creates a Web-standard `Request → Response` handler for an agent.
 *
 * The handler parses a JSON request body (`{ input: string }`),
 * creates a Session per request, runs one turn, and streams `StreamEvent`
 * objects back as Server-Sent Events.
 *
 * Validates:
 * - HTTP method is POST (returns 405 otherwise)
 * - Request body has a string `input` field (returns 400 otherwise)
 * - Session ID (if provided) matches alphanumeric/hyphen format, max 128 chars
 *
 * Error messages sent to clients are generic for security (no internal details).
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

  return (req: Request): Response => {
    // Only POST allowed
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json", Allow: "POST" },
      })
    }

    const encoder = new TextEncoder()

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

          // Validate session ID format
          const rawSessionId = req.headers.get(sessionIdHeader) ?? undefined
          if (rawSessionId && !SESSION_ID_RE.test(rawSessionId)) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", message: "Invalid session ID format" })}\n\n`))
            controller.close()
            return
          }
          const sessionId = rawSessionId

          await agent.init()
          const session = agent.session(sessionId ? { id: sessionId } : undefined)

          try {
            const run = session.run(input)

            for await (const event of run) {
              const data = `data: ${JSON.stringify(event)}\n\n`
              controller.enqueue(encoder.encode(data))
            }
          } finally {
            await session.close()
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

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    })
  }
}
