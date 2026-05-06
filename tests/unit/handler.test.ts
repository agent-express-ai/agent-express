import { describe, it, expect, vi } from "vitest"
import { Readable } from "node:stream"
import { Agent } from "../../src/agent.js"
import { createHandler, toExpressHandler, toFastifyHandler } from "../../src/http/handler.js"
import type { LanguageModelV3, LanguageModelV3GenerateResult } from "@ai-sdk/provider"

function createMockModel(responses?: string[]): LanguageModelV3 {
  let callIndex = 0
  return {
    specificationVersion: "v3",
    provider: "mock",
    modelId: "mock",
    supportedUrls: {},
    doGenerate: vi.fn(async (opts): Promise<LanguageModelV3GenerateResult> => {
      // Echo back the last user message or use pre-configured responses
      const text = responses
        ? responses[callIndex++ % responses.length]
        : `echo: ${opts.prompt.at(-1)?.content?.toString() ?? "?"}`
      return {
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 5, text: 5, reasoning: 0 },
        },
        warnings: [],
      }
    }),
    doStream: vi.fn(async () => { throw new Error("not implemented") }),
  }
}

function makeRequest(input: string, sessionId?: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (sessionId) headers["x-session-id"] = sessionId
  return new Request("http://localhost/api/agent", {
    method: "POST",
    headers,
    body: JSON.stringify({ input }),
  })
}

async function collectSSE(response: Response): Promise<Record<string, unknown>[]> {
  const text = await response.text()
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>)
}

describe("createHandler()", () => {
  it("returns 405 for non-POST requests", () => {
    const agent = new Agent({ name: "test", model: createMockModel(), instructions: "test", defaults: false })
    const handler = createHandler(agent)
    const response = handler(new Request("http://localhost/api/agent", { method: "GET" }))
    expect(response.status).toBe(405)
  })

  it("handles a basic request and streams SSE", async () => {
    const agent = new Agent({ name: "test", model: createMockModel(["hello"]), instructions: "test", defaults: false })
    const handler = createHandler(agent)
    const response = handler(makeRequest("hi"))

    expect(response.headers.get("Content-Type")).toBe("text/event-stream")

    const events = await collectSSE(response)
    const sessionEnd = events.find((e) => e["type"] === "result") as Record<string, unknown> | undefined
    expect(sessionEnd).toBeDefined()

    const result = sessionEnd?.["result"] as Record<string, unknown>
    expect(result?.["text"]).toBe("hello")
  })

  it("creates independent sessions per request without session ID", async () => {
    let callCount = 0
    const model: LanguageModelV3 = {
      specificationVersion: "v3",
      provider: "mock",
      modelId: "mock",
      supportedUrls: {},
      doGenerate: vi.fn(async (opts): Promise<LanguageModelV3GenerateResult> => {
        callCount++
        return {
          content: [{ type: "text", text: `messages: ${opts.prompt.length}` }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 5, text: 5, reasoning: 0 },
          },
          warnings: [],
        }
      }),
      doStream: vi.fn(async () => { throw new Error("not implemented") }),
    }

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    const handler = createHandler(agent)

    // Two requests without session ID — both should have same minimal message count
    const events1 = await collectSSE(handler(makeRequest("first")))
    const events2 = await collectSSE(handler(makeRequest("second")))

    const text1 = ((events1.find((e) => e["type"] === "result") as Record<string, unknown>)?.["result"] as Record<string, unknown>)?.["text"] as string
    const text2 = ((events2.find((e) => e["type"] === "result") as Record<string, unknown>)?.["result"] as Record<string, unknown>)?.["text"] as string

    const msgCount1 = parseInt((text1.match(/messages: (\d+)/) ?? [])[1] ?? "0")
    const msgCount2 = parseInt((text2.match(/messages: (\d+)/) ?? [])[1] ?? "0")

    // Both should have same count — no accumulated history
    expect(msgCount1).toBe(msgCount2)
  })

  it("reuses session when same session ID is provided", async () => {
    let callCount = 0
    const model: LanguageModelV3 = {
      specificationVersion: "v3",
      provider: "mock",
      modelId: "mock",
      supportedUrls: {},
      doGenerate: vi.fn(async (opts): Promise<LanguageModelV3GenerateResult> => {
        callCount++
        // On second call, the history should contain the first exchange
        const messageCount = opts.prompt.length
        return {
          content: [{ type: "text", text: `call ${callCount}, messages: ${messageCount}` }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 5, text: 5, reasoning: 0 },
          },
          warnings: [],
        }
      }),
      doStream: vi.fn(async () => { throw new Error("not implemented") }),
    }

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    const handler = createHandler(agent)

    // First request with session ID
    const events1 = await collectSSE(handler(makeRequest("hello", "session-1")))
    const result1 = (events1.find((e) => e["type"] === "result") as Record<string, unknown>)?.["result"] as Record<string, unknown>
    expect(result1?.["text"]).toContain("call 1")

    // Second request with SAME session ID — should have history from first request
    const events2 = await collectSSE(handler(makeRequest("follow up", "session-1")))
    const result2 = (events2.find((e) => e["type"] === "result") as Record<string, unknown>)?.["result"] as Record<string, unknown>
    expect(result2?.["text"]).toContain("call 2")

    // Second call should have more messages (history from first exchange)
    const text2 = result2?.["text"] as string
    const msgCount1 = parseInt(((result1?.["text"] as string).match(/messages: (\d+)/) ?? [])[1] ?? "0")
    const msgCount2 = parseInt((text2.match(/messages: (\d+)/) ?? [])[1] ?? "0")
    expect(msgCount2).toBeGreaterThan(msgCount1)
  })

  it("does not share state between different session IDs", async () => {
    let callCount = 0
    const model: LanguageModelV3 = {
      specificationVersion: "v3",
      provider: "mock",
      modelId: "mock",
      supportedUrls: {},
      doGenerate: vi.fn(async (opts): Promise<LanguageModelV3GenerateResult> => {
        callCount++
        return {
          content: [{ type: "text", text: `messages: ${opts.prompt.length}` }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 5, text: 5, reasoning: 0 },
          },
          warnings: [],
        }
      }),
      doStream: vi.fn(async () => { throw new Error("not implemented") }),
    }

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    const handler = createHandler(agent)

    // Two requests to session-A
    await collectSSE(handler(makeRequest("first", "session-A")))
    await collectSSE(handler(makeRequest("second", "session-A")))

    // One request to session-B — should NOT have session-A's history
    const eventsB = await collectSSE(handler(makeRequest("hello", "session-B")))
    const resultB = (eventsB.find((e) => e["type"] === "result") as Record<string, unknown>)?.["result"] as Record<string, unknown>
    const textB = resultB?.["text"] as string

    // session-B should have minimal messages (system + user), not session-A's accumulated history
    const msgCountB = parseInt((textB.match(/messages: (\d+)/) ?? [])[1] ?? "0")
    expect(msgCountB).toBeLessThanOrEqual(2) // system + user "hello"
  })

  it("validates session ID format", async () => {
    const agent = new Agent({ name: "test", model: createMockModel(), instructions: "test", defaults: false })
    const handler = createHandler(agent)

    const response = handler(makeRequest("hi", "invalid session id!@#"))
    const events = await collectSSE(response)
    const error = events.find((e) => e["type"] === "error")
    expect(error?.["message"]).toContain("session ID")
  })

  it("rejects input that exceeds maxInputLength", async () => {
    const agent = new Agent({ name: "test", model: createMockModel(), instructions: "test", defaults: false })
    const handler = createHandler(agent, { maxInputLength: 10 })

    const response = handler(makeRequest("this input is way too long for the limit"))
    const events = await collectSSE(response)
    const error = events.find((e) => e["type"] === "error")
    expect(error?.["message"]).toContain("too long")
  })

  it("rejects new sessions when maxSessions is reached", async () => {
    const agent = new Agent({ name: "test", model: createMockModel(["ok"]), instructions: "test", defaults: false })
    const handler = createHandler(agent, { maxSessions: 2 })

    // Fill up session slots
    await collectSSE(handler(makeRequest("a", "s1")))
    await collectSSE(handler(makeRequest("b", "s2")))

    // Third session should be rejected
    const events = await collectSSE(handler(makeRequest("c", "s3")))
    const error = events.find((e) => e["type"] === "error")
    expect(error?.["message"]).toContain("Too many")
  })

  it("allows reuse of existing session even at maxSessions limit", async () => {
    const agent = new Agent({ name: "test", model: createMockModel(["ok"]), instructions: "test", defaults: false })
    const handler = createHandler(agent, { maxSessions: 1 })

    // Create one session
    await collectSSE(handler(makeRequest("first", "s1")))

    // Reuse same session — should work even though limit is 1
    const events = await collectSSE(handler(makeRequest("second", "s1")))
    const sessionEnd = events.find((e) => e["type"] === "result")
    expect(sessionEnd).toBeDefined()
  })
})

describe("toExpressHandler()", () => {
  function mockExpressReq(input: string, sessionId?: string) {
    const body = JSON.stringify({ input })
    const chunks = [Buffer.from(body)]
    const headers: Record<string, string> = { "content-type": "application/json" }
    if (sessionId) headers["x-session-id"] = sessionId
    return {
      method: "POST",
      url: "/api/agent",
      headers,
      async *[Symbol.asyncIterator]() {
        for (const c of chunks) yield c
      },
    }
  }

  function mockExpressRes() {
    const data: string[] = []
    return {
      statusCode: 0,
      status(code: number) { this.statusCode = code; return this },
      setHeader: vi.fn(),
      write(chunk: unknown) { data.push(Buffer.from(chunk as Uint8Array).toString()); return true },
      end: vi.fn(),
      _data: data,
    }
  }

  it("streams SSE through Express-compatible req/res", async () => {
    const agent = new Agent({ name: "test", model: createMockModel(["hello from express"]), instructions: "test", defaults: false })
    const handler = createHandler(agent)
    const expressHandler = toExpressHandler(handler)

    const req = mockExpressReq("hi")
    const res = mockExpressRes()

    await expressHandler(req, res)

    expect(res.end).toHaveBeenCalled()
    const output = res._data.join("")
    expect(output).toContain("result")
    expect(output).toContain("hello from express")
  })
})

describe("toFastifyHandler()", () => {
  function mockFastifyReq(input: string, sessionId?: string) {
    const headers: Record<string, string> = { "content-type": "application/json" }
    if (sessionId) headers["x-session-id"] = sessionId
    return {
      url: "/api/agent",
      headers,
      body: { input },
    }
  }

  function mockFastifyReply() {
    const data: string[] = []
    return {
      status: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
      raw: {
        write(chunk: unknown) { data.push(Buffer.from(chunk as Uint8Array).toString()); return true },
        end: vi.fn(),
      },
      _data: data,
    }
  }

  it("streams SSE through Fastify-compatible request/reply", async () => {
    const agent = new Agent({ name: "test", model: createMockModel(["hello from fastify"]), instructions: "test", defaults: false })
    const handler = createHandler(agent)
    const fastifyHandler = toFastifyHandler(handler)

    const req = mockFastifyReq("hi")
    const reply = mockFastifyReply()

    await fastifyHandler(req, reply)

    expect(reply.raw.end).toHaveBeenCalled()
    const output = reply._data.join("")
    expect(output).toContain("result")
    expect(output).toContain("hello from fastify")
  })
})
