import { describe, it, expect, vi } from "vitest"
import { Agent } from "../../src/agent.js"
import { observeLog } from "../../src/middleware/observe/log.js"
import { RateLimitError, AuthenticationError } from "../../src/errors.js"
import type { LanguageModelV3, LanguageModelV3GenerateResult } from "@ai-sdk/provider"
import type { LogEvent } from "../../src/types.js"

/** Helper to create a mock model with configurable behavior. */
function createMockModel(responses: Array<() => LanguageModelV3GenerateResult | Error>): LanguageModelV3 {
  let callIndex = 0
  return {
    specificationVersion: "v3",
    provider: "mock",
    modelId: "mock-model",
    supportedUrls: {},
    doGenerate: vi.fn(async (): Promise<LanguageModelV3GenerateResult> => {
      const responseOrError = responses[Math.min(callIndex++, responses.length - 1)]!()
      if (responseOrError instanceof Error) throw responseOrError
      return responseOrError
    }),
    doStream: vi.fn(async () => { throw new Error("not implemented") }),
  }
}

const successResponse = (): LanguageModelV3GenerateResult => ({
  content: [{ type: "text", text: "Hello!" }],
  finishReason: { unified: "stop", raw: "stop" },
  usage: {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 5, text: 5, reasoning: 0 },
  },
  warnings: [],
})

describe("Built-in Default: Retry", () => {
  it("bare agent retries rate limit error and completes", async () => {
    const model = createMockModel([
      () => { throw new RateLimitError("mock") },
      successResponse,
    ])
    // defaults: true (implicit) includes model.retry() with default config
    // Override retry delay for fast tests via defaults options
    const agent = new Agent({
      name: "test",
      model,
      instructions: "test",
      defaults: { retry: { maxRetries: 2, initialDelayMs: 10 } },
    })

    const result = await agent.run("hi").result
    expect(result.text).toBe("Hello!")
    expect(model.doGenerate).toHaveBeenCalledTimes(2)
  })

  it("bare agent does NOT retry auth error", async () => {
    const model = createMockModel([
      () => { throw new AuthenticationError("mock") },
    ])
    const agent = new Agent({
      name: "test",
      model,
      instructions: "test",
      defaults: { retry: { maxRetries: 2, initialDelayMs: 10 } },
    })

    await expect(agent.run("hi").result).rejects.toThrow(AuthenticationError)
    expect(model.doGenerate).toHaveBeenCalledTimes(1)
  })

  it("defaults: false disables retry", async () => {
    const model = createMockModel([
      () => { throw new RateLimitError("mock") },
    ])
    const agent = new Agent({
      name: "test",
      model,
      instructions: "test",
      defaults: false,
    })

    await expect(agent.run("hi").result).rejects.toThrow(RateLimitError)
    expect(model.doGenerate).toHaveBeenCalledTimes(1)
  })

  it("custom retry config is respected", async () => {
    let attempts = 0
    const model = createMockModel([
      () => { attempts++; throw new RateLimitError("mock") },
      () => { attempts++; throw new RateLimitError("mock") },
      () => { attempts++; throw new RateLimitError("mock") },
      () => { attempts++; throw new RateLimitError("mock") },
      () => { attempts++; return successResponse() },
    ])
    const agent = new Agent({
      name: "test",
      model,
      instructions: "test",
      defaults: { retry: { maxRetries: 5, initialDelayMs: 5 } },
    })

    const result = await agent.run("hi").result
    expect(result.text).toBe("Hello!")
    expect(attempts).toBe(5)
  })
})

describe("Built-in Default: Logging (observe.log)", () => {
  it("observe.log() emits log events when added explicitly", async () => {
    const events: LogEvent[] = []
    const model = createMockModel([successResponse])
    const agent = new Agent({
      name: "test",
      model,
      instructions: "test",
      defaults: false,
    })
    agent.use(observeLog({ output: (e) => events.push(e) }))

    await agent.run("hi").result

    const types = events.map((e) => e.type)
    expect(types).toContain("session:start")
    expect(types).toContain("turn:start")
    expect(types).toContain("model:call")
    expect(types).toContain("model:response")
    expect(types).toContain("turn:end")
    expect(types).toContain("session:end")
  })

  it("no logging when observe.log() is not added", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)

    const model = createMockModel([successResponse])
    const agent = new Agent({
      name: "test",
      model,
      instructions: "test",
      defaults: false,
    })

    await agent.run("hi").result

    // No stderr output since observe.log() is not added
    expect(stderrSpy).not.toHaveBeenCalled()
    stderrSpy.mockRestore()
  })

  it("custom logging output receives events", async () => {
    const events: LogEvent[] = []
    const model = createMockModel([successResponse])
    const agent = new Agent({
      name: "test",
      model,
      instructions: "test",
      defaults: false,
    })
    agent.use(observeLog({ output: (e) => events.push(e) }))

    await agent.run("hi").result

    expect(events.length).toBeGreaterThan(0)
    expect(events[0]!.sessionId).toBeTruthy()
    expect(events[0]!.timestamp).toBeTruthy()
  })

  it("log events include model call data", async () => {
    const events: LogEvent[] = []
    const model = createMockModel([successResponse])
    const agent = new Agent({
      name: "test",
      model,
      instructions: "test",
      defaults: false,
    })
    agent.use(observeLog({ output: (e) => events.push(e) }))

    await agent.run("hi").result

    const modelCall = events.find((e) => e.type === "model:call")
    expect(modelCall).toBeDefined()

    const modelResponse = events.find((e) => e.type === "model:response")
    expect(modelResponse).toBeDefined()
    expect(modelResponse!.data).toHaveProperty("usage")
  })
})
