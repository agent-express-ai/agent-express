import { describe, it, expect, vi } from "vitest"
import { Agent } from "../../src/agent.js"
import { FunctionModel } from "../../src/test/function-model.js"
import { observeLog } from "../../src/middleware/observe/log.js"
import { toolsFunction } from "../../src/tools/function.js"
import { defaults } from "../../src/defaults.js"
import { z } from "zod"
import type { LogEvent } from "../../src/types.js"

function createAgent(logOpts: Parameters<typeof observeLog>[0]) {
  const model = new FunctionModel(() => ({
    text: "ok",
    usage: { inputTokens: 10, outputTokens: 20 },
    finishReason: "stop",
  }))
  const agent = new Agent({ name: "test-agent", model, instructions: "test", defaults: false })
  agent.use(observeLog(logOpts))
  return agent
}

function createAgentWithTool(logOpts: Parameters<typeof observeLog>[0]) {
  const model = new FunctionModel((_messages, { callIndex }) => {
    if (callIndex === 0) {
      return {
        text: undefined,
        toolCalls: [{ toolCallId: "tc1", toolName: "greet", args: { name: "world" } }],
        usage: { inputTokens: 10, outputTokens: 5 },
        finishReason: "tool-calls",
      }
    }
    return {
      text: "Done!",
      usage: { inputTokens: 15, outputTokens: 10 },
      finishReason: "stop",
    }
  })

  const greetTool = toolsFunction({
    name: "greet",
    description: "Greet someone",
    schema: z.object({ name: z.string() }),
    execute: async ({ name }) => `Hello, ${name}!`,
  })

  const agent = new Agent({ name: "test-agent", model, instructions: "test", defaults: false })
  agent.use(defaults())
  agent.use(greetTool)
  agent.use(observeLog(logOpts))
  return agent
}

function createAgentWithFailingTool(logOpts: Parameters<typeof observeLog>[0]) {
  const model = new FunctionModel((_messages, { callIndex }) => {
    if (callIndex === 0) {
      return {
        text: undefined,
        toolCalls: [{ toolCallId: "tc1", toolName: "fail_tool", args: {} }],
        usage: { inputTokens: 10, outputTokens: 5 },
        finishReason: "tool-calls",
      }
    }
    return {
      text: "Done after error",
      usage: { inputTokens: 15, outputTokens: 10 },
      finishReason: "stop",
    }
  })

  const failTool = toolsFunction({
    name: "fail_tool",
    description: "A tool that fails",
    schema: z.object({}),
    execute: async () => { throw new Error("tool boom") },
  })

  const agent = new Agent({ name: "test-agent", model, instructions: "test", defaults: false })
  agent.use(defaults())
  agent.use(failTool)
  agent.use(observeLog(logOpts))
  return agent
}

describe("observe.log() enhancements", () => {
  it("level field — info for normal lifecycle events", async () => {
    const events: LogEvent[] = []
    const agent = createAgent({ output: (e) => events.push(e) })

    await agent.run("hello").result

    for (const event of events) {
      expect(event.level).toBeDefined()
      expect(["debug", "info", "warn", "error"]).toContain(event.level)
    }

    const infoEvents = events.filter(e => e.level === "info")
    expect(infoEvents.length).toBeGreaterThan(0)
  })

  it("agentName on all events", async () => {
    const events: LogEvent[] = []
    const agent = createAgent({ output: (e) => events.push(e) })

    await agent.run("hello").result

    for (const event of events) {
      expect(event.agentName).toBe("test-agent")
    }
  })

  it("turnId on turn/model events", async () => {
    const events: LogEvent[] = []
    const agent = createAgent({ output: (e) => events.push(e) })

    await agent.run("hello").result

    const turnEvents = events.filter(e => e.type.startsWith("turn:"))
    for (const event of turnEvents) {
      expect(event.turnId).toBeDefined()
    }

    const modelEvents = events.filter(e => e.type.startsWith("model:"))
    for (const event of modelEvents) {
      expect(event.turnId).toBeDefined()
    }
  })

  it("durationMs on end events", async () => {
    const events: LogEvent[] = []
    const agent = createAgent({ output: (e) => events.push(e) })

    await agent.run("hello").result

    const modelResponse = events.find(e => e.type === "model:response")
    expect(modelResponse?.durationMs).toBeDefined()
    expect(modelResponse!.durationMs!).toBeGreaterThanOrEqual(0)

    const turnEnd = events.find(e => e.type === "turn:end")
    expect(turnEnd?.durationMs).toBeDefined()
  })

  it("error field on model failure", async () => {
    const events: LogEvent[] = []
    const model = new FunctionModel(() => { throw new Error("API timeout") })
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(observeLog({ output: (e) => events.push(e) }))

    await expect(agent.run("hello").result).rejects.toThrow()

    const errorEvents = events.filter(e => e.level === "error")
    expect(errorEvents.length).toBeGreaterThan(0)

    const modelError = errorEvents.find(e => e.type === "model:response")
    expect(modelError?.error).toBeDefined()
    expect(modelError!.error!.type).toBe("Error")
    expect(modelError!.error!.message).toBe("API timeout")
  })

  it("recordContent: true — content at debug level", async () => {
    const events: LogEvent[] = []
    const agent = createAgent({ output: (e) => events.push(e), recordContent: true })

    await agent.run("hello").result

    const modelResponse = events.find(e => e.type === "model:response")
    expect(modelResponse?.level).toBe("debug")
    expect(modelResponse?.data["response"]).toBeDefined()
  })

  it("recordContent: false (default) — no content, info level", async () => {
    const events: LogEvent[] = []
    const agent = createAgent({ output: (e) => events.push(e) })

    await agent.run("hello").result

    const modelResponse = events.find(e => e.type === "model:response")
    expect(modelResponse?.level).toBe("info")
    expect(modelResponse?.data["response"]).toBeUndefined()
    expect(modelResponse?.data["messages"]).toBeUndefined()
  })

  it("backward compatibility — all original fields present", async () => {
    const events: LogEvent[] = []
    const agent = createAgent({ output: (e) => events.push(e) })

    await agent.run("hello").result

    for (const event of events) {
      expect(event.timestamp).toBeDefined()
      expect(event.type).toBeDefined()
      expect(event.sessionId).toBeDefined()
      expect(event.turnIndex).toBeDefined()
      expect(event.data).toBeDefined()
    }
  })

  it("session error — error log event when inner session middleware throws", async () => {
    const events: LogEvent[] = []
    const model = new FunctionModel(() => ({
      text: "ok",
      usage: { inputTokens: 10, outputTokens: 20 },
      finishReason: "stop",
    }))
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(observeLog({ output: (e) => events.push(e) }))
    // A middleware that throws during session lifecycle — inner middleware
    // so that observe.log sees the error from its catch block
    agent.use({
      name: "exploding-session",
      session: async () => {
        throw new Error("session boom")
      },
    })

    await expect(agent.run("hello").result).rejects.toThrow("session boom")

    const sessionEnd = events.find(e => e.type === "session:end")
    expect(sessionEnd).toBeDefined()
    expect(sessionEnd!.level).toBe("error")
    expect(sessionEnd!.error).toBeDefined()
    expect(sessionEnd!.error!.type).toBe("Error")
    expect(sessionEnd!.error!.message).toBe("session boom")
    expect(sessionEnd!.durationMs).toBeGreaterThanOrEqual(0)
  })

  it("turn error — error log event with durationMs", async () => {
    const events: LogEvent[] = []
    const model = new FunctionModel(() => { throw new TypeError("bad input") })
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(observeLog({ output: (e) => events.push(e) }))

    await expect(agent.run("hello").result).rejects.toThrow("bad input")

    const turnEnd = events.find(e => e.type === "turn:end" && e.level === "error")
    expect(turnEnd).toBeDefined()
    expect(turnEnd!.error!.type).toBe("TypeError")
    expect(turnEnd!.error!.message).toBe("bad input")
    expect(turnEnd!.durationMs).toBeGreaterThanOrEqual(0)
    expect(turnEnd!.turnId).toBeDefined()
  })

  it("tool:start and tool:end events emitted for successful tool calls", async () => {
    const events: LogEvent[] = []
    const agent = createAgentWithTool({ output: (e) => events.push(e) })

    await agent.run("hello").result

    const toolStart = events.find(e => e.type === "tool:start")
    expect(toolStart).toBeDefined()
    expect(toolStart!.level).toBe("info")
    expect(toolStart!.data["tool"]).toBe("greet")
    expect(toolStart!.data["callId"]).toBeDefined()
    expect(toolStart!.turnId).toBeDefined()

    const toolEnd = events.find(e => e.type === "tool:end")
    expect(toolEnd).toBeDefined()
    expect(toolEnd!.level).toBe("info")
    expect(toolEnd!.durationMs).toBeGreaterThanOrEqual(0)
    expect(toolEnd!.data["tool"]).toBe("greet")
  })

  it("tool:end with recordContent: true — args and result in data, debug level", async () => {
    const events: LogEvent[] = []
    const agent = createAgentWithTool({ output: (e) => events.push(e), recordContent: true })

    await agent.run("hello").result

    const toolEnd = events.find(e => e.type === "tool:end" && !e.error)
    expect(toolEnd).toBeDefined()
    expect(toolEnd!.level).toBe("debug")
    expect(toolEnd!.data["args"]).toBeDefined()
    expect(toolEnd!.data["result"]).toBeDefined()
  })

  it("tool:end with recordContent: false — no args/result, info level", async () => {
    const events: LogEvent[] = []
    const agent = createAgentWithTool({ output: (e) => events.push(e), recordContent: false })

    await agent.run("hello").result

    const toolEnd = events.find(e => e.type === "tool:end" && !e.error)
    expect(toolEnd).toBeDefined()
    expect(toolEnd!.level).toBe("info")
    expect(toolEnd!.data["args"]).toBeUndefined()
    expect(toolEnd!.data["result"]).toBeUndefined()
  })

  it("tool error — warn level with ToolExecutionError", async () => {
    const events: LogEvent[] = []
    const agent = createAgentWithFailingTool({ output: (e) => events.push(e) })

    await agent.run("hello").result

    const toolEnd = events.find(e => e.type === "tool:end" && e.error !== undefined)
    expect(toolEnd).toBeDefined()
    expect(toolEnd!.level).toBe("warn")
    expect(toolEnd!.error!.type).toBe("ToolExecutionError")
    // Without recordContent, error message is generic
    expect(toolEnd!.error!.message).toBe("Tool execution failed")
  })

  it("tool error with recordContent — actual error message in log", async () => {
    const events: LogEvent[] = []
    const agent = createAgentWithFailingTool({ output: (e) => events.push(e), recordContent: true })

    await agent.run("hello").result

    const toolEnd = events.find(e => e.type === "tool:end" && e.error !== undefined)
    expect(toolEnd).toBeDefined()
    expect(toolEnd!.level).toBe("warn")
    // With recordContent, the actual error result is in the message
    expect(toolEnd!.error!.message).toBeDefined()
  })

  it("model:call event — includes model and callIndex in data", async () => {
    const events: LogEvent[] = []
    const agent = createAgent({ output: (e) => events.push(e) })

    await agent.run("hello").result

    const modelCall = events.find(e => e.type === "model:call")
    expect(modelCall).toBeDefined()
    expect(modelCall!.level).toBe("info")
    expect(modelCall!.data["model"]).toBeDefined()
    expect(modelCall!.data["callIndex"]).toBe(0)
    expect(modelCall!.turnId).toBeDefined()
  })

  it("model:response data — includes finishReason and usage", async () => {
    const events: LogEvent[] = []
    const agent = createAgent({ output: (e) => events.push(e) })

    await agent.run("hello").result

    const modelResp = events.find(e => e.type === "model:response")
    expect(modelResp).toBeDefined()
    expect(modelResp!.data["finishReason"]).toBe("stop")
    expect(modelResp!.data["usage"]).toEqual({ inputTokens: 10, outputTokens: 20 })
    expect(modelResp!.data["model"]).toBeDefined()
    expect(modelResp!.data["callIndex"]).toBe(0)
  })

  it("model error — includes model and callIndex in error event data", async () => {
    const events: LogEvent[] = []
    const model = new FunctionModel(() => { throw new Error("rate limited") })
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(observeLog({ output: (e) => events.push(e) }))

    await expect(agent.run("hello").result).rejects.toThrow()

    const modelErr = events.find(e => e.type === "model:response" && e.level === "error")
    expect(modelErr).toBeDefined()
    expect(modelErr!.data["model"]).toBeDefined()
    expect(modelErr!.data["callIndex"]).toBe(0)
    expect(modelErr!.durationMs).toBeGreaterThanOrEqual(0)
  })

  it("default output writes JSON to stderr", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    try {
      const agent = new Agent({
        name: "stderr-test",
        model: new FunctionModel(() => ({
          text: "ok",
          usage: { inputTokens: 1, outputTokens: 1 },
          finishReason: "stop",
        })),
        instructions: "test",
        defaults: false,
      })
      agent.use(observeLog()) // no output callback — uses stderr

      await agent.run("hello").result

      expect(stderrSpy).toHaveBeenCalled()
      // Each call should be valid JSON + newline
      for (const call of stderrSpy.mock.calls) {
        const line = call[0] as string
        expect(line.endsWith("\n")).toBe(true)
        const parsed = JSON.parse(line.slice(0, -1))
        expect(parsed.type).toBeDefined()
        expect(parsed.timestamp).toBeDefined()
      }
    } finally {
      stderrSpy.mockRestore()
    }
  })

  it("recordContent: true — messages in model:response data", async () => {
    const events: LogEvent[] = []
    const agent = createAgent({ output: (e) => events.push(e), recordContent: true })

    await agent.run("hello").result

    const modelResp = events.find(e => e.type === "model:response")
    expect(modelResp).toBeDefined()
    expect(modelResp!.data["messages"]).toBeDefined()
    expect(modelResp!.data["response"]).toBe("ok")
  })

  it("tool:end error event when tool middleware throws (catch branch)", async () => {
    const events: LogEvent[] = []
    const model = new FunctionModel((_messages, { callIndex }) => {
      if (callIndex === 0) {
        return {
          text: undefined,
          toolCalls: [{ toolCallId: "tc1", toolName: "ok_tool", args: {} }],
          usage: { inputTokens: 10, outputTokens: 5 },
          finishReason: "tool-calls",
        }
      }
      return { text: "done", usage: { inputTokens: 15, outputTokens: 10 }, finishReason: "stop" }
    })

    const okTool = toolsFunction({
      name: "ok_tool",
      description: "Does nothing",
      schema: z.object({}),
      execute: async () => "ok",
    })

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(defaults())
    agent.use(okTool)
    agent.use(observeLog({ output: (e) => events.push(e) }))
    // Tool middleware that throws after next() — the log middleware wraps this
    // and its catch block fires
    agent.use({
      name: "tool-thrower",
      tool: async (_ctx, next) => {
        await next()
        throw new Error("tool middleware boom")
      },
    })

    await expect(agent.run("hello").result).rejects.toThrow("tool middleware boom")

    const toolEndError = events.find(e => e.type === "tool:end" && e.level === "error")
    expect(toolEndError).toBeDefined()
    expect(toolEndError!.error!.type).toBe("Error")
    expect(toolEndError!.error!.message).toBe("tool middleware boom")
    expect(toolEndError!.durationMs).toBeGreaterThanOrEqual(0)
  })

  it("session:start and session:end events emitted on success", async () => {
    const events: LogEvent[] = []
    const agent = createAgent({ output: (e) => events.push(e) })

    await agent.run("hello").result

    const sessionStart = events.find(e => e.type === "session:start")
    expect(sessionStart).toBeDefined()
    expect(sessionStart!.level).toBe("info")
    expect(sessionStart!.agentName).toBe("test-agent")

    const sessionEnd = events.find(e => e.type === "session:end")
    expect(sessionEnd).toBeDefined()
    expect(sessionEnd!.level).toBe("info")
    expect(sessionEnd!.durationMs).toBeGreaterThanOrEqual(0)
  })
})
