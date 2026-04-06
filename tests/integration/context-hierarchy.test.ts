import { describe, it, expect, vi } from "vitest"
import { Agent } from "../../src/agent.js"
import { toolsFunction } from "../../src/tools/function.js"
import { z } from "zod"
import type {
  LanguageModelV3,
  LanguageModelV3GenerateResult,
} from "@ai-sdk/provider"
import type { Middleware, AgentContext, SessionContext, TurnContext, ModelContext, ToolContext } from "../../src/middleware.js"

function createToolCallingModel(): LanguageModelV3 {
  let callCount = 0
  return {
    specificationVersion: "v3",
    provider: "mock",
    modelId: "mock-model",
    supportedUrls: {},
    doGenerate: vi.fn(async (): Promise<LanguageModelV3GenerateResult> => {
      callCount++
      if (callCount === 1) {
        return {
          content: [{ type: "tool-call", toolCallId: "tc1", toolName: "echo", input: { text: "hi" } }],
          finishReason: { unified: "tool-calls", raw: "tool_use" },
          usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } },
          warnings: [],
        }
      }
      return {
        content: [{ type: "text", text: "Done!" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: { total: 15, noCache: 15, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 8, text: 8, reasoning: 0 } },
        warnings: [],
      }
    }),
    doStream: vi.fn(async () => { throw new Error("not implemented") }),
  }
}

describe("Context hierarchy — all 5 levels", () => {
  it("provides correct data at each lifecycle level", async () => {
    const observations: {
      agent?: { agentName: string; hasRegisterTool: boolean }
      session?: { hasSessionId: boolean; hasState: boolean; hasHistory: boolean; hasEmit: boolean }
      turn?: { hasInput: boolean; hasTurnId: boolean; turnIndex: number; hasAbort: boolean }
      model?: { hasMessages: boolean; hasModel: boolean; hasToolDefs: boolean; callIndex: number; hasSetModel: boolean; hasSkipCall: boolean }
      tool?: { hasToolDef: boolean; hasArgs: boolean; hasCallId: boolean; hasDeny: boolean; hasModifyArgs: boolean }
    } = {}

    const observer: Middleware = {
      name: "observer",
      state: { observed: { default: false } },

      async agent(ctx: AgentContext, next) {
        observations.agent = {
          agentName: ctx.agent.name,
          hasRegisterTool: typeof ctx.registerTool === "function",
        }
        await next()
      },

      async session(ctx: SessionContext, next) {
        observations.session = {
          hasSessionId: typeof ctx.sessionId === "string" && ctx.sessionId.length > 0,
          hasState: ctx.state !== undefined,
          hasHistory: Array.isArray(ctx.history),
          hasEmit: typeof ctx.emit === "function",
        }
        ctx.state.observed = true
        await next()
      },

      async turn(ctx: TurnContext, next) {
        observations.turn = {
          hasInput: Array.isArray(ctx.input) && ctx.input.length > 0,
          hasTurnId: typeof ctx.turnId === "string" && ctx.turnId.length > 0,
          turnIndex: ctx.turnIndex,
          hasAbort: typeof ctx.abort === "function",
        }
        await next()
      },

      async model(ctx: ModelContext, next) {
        observations.model = {
          hasMessages: Array.isArray(ctx.messages) && ctx.messages.length > 0,
          hasModel: typeof ctx.model === "string" && ctx.model.length > 0,
          hasToolDefs: Array.isArray(ctx.toolDefs),
          callIndex: ctx.callIndex,
          hasSetModel: typeof ctx.setModel === "function",
          hasSkipCall: typeof ctx.skipCall === "function",
        }
        return next()
      },

      async tool(ctx: ToolContext, next) {
        observations.tool = {
          hasToolDef: typeof ctx.tool === "object" && typeof ctx.tool.name === "string",
          hasArgs: typeof ctx.args === "object",
          hasCallId: typeof ctx.callId === "string" && ctx.callId.length > 0,
          hasDeny: typeof ctx.deny === "function",
          hasModifyArgs: typeof ctx.modifyArgs === "function",
        }
        return next()
      },
    }

    const agent = new Agent({ name: "test-agent", model: createToolCallingModel(), instructions: "Test.", defaults: false })
    agent.use(observer)
    agent.use(toolsFunction({
      name: "echo",
      description: "Echo text",
      schema: z.object({ text: z.string() }),
      execute: async ({ text }) => text,
    }))

    const result = await agent.run("test context").result

    // agent — AgentContext
    expect(observations.agent).toBeDefined()
    expect(observations.agent!.agentName).toBe("test-agent")
    expect(observations.agent!.hasRegisterTool).toBe(true)

    // session — SessionContext (extends AgentContext)
    expect(observations.session).toBeDefined()
    expect(observations.session!.hasSessionId).toBe(true)
    expect(observations.session!.hasState).toBe(true)
    expect(observations.session!.hasHistory).toBe(true)
    expect(observations.session!.hasEmit).toBe(true)

    // turn — TurnContext (extends SessionContext)
    expect(observations.turn).toBeDefined()
    expect(observations.turn!.hasInput).toBe(true)
    expect(observations.turn!.hasTurnId).toBe(true)
    expect(observations.turn!.turnIndex).toBe(0)
    expect(observations.turn!.hasAbort).toBe(true)

    // model — ModelContext (extends TurnContext)
    expect(observations.model).toBeDefined()
    expect(observations.model!.hasMessages).toBe(true)
    expect(observations.model!.hasModel).toBe(true)
    expect(observations.model!.hasToolDefs).toBe(true)
    expect(observations.model!.callIndex).toBeGreaterThanOrEqual(0)
    expect(observations.model!.hasSetModel).toBe(true)
    expect(observations.model!.hasSkipCall).toBe(true)

    // tool — ToolContext (extends TurnContext)
    expect(observations.tool).toBeDefined()
    expect(observations.tool!.hasToolDef).toBe(true)
    expect(observations.tool!.hasArgs).toBe(true)
    expect(observations.tool!.hasCallId).toBe(true)
    expect(observations.tool!.hasDeny).toBe(true)
    expect(observations.tool!.hasModifyArgs).toBe(true)

    // state written in session hook is in RunResult
    expect(result.state.observed).toBe(true)
  })

  it("ModelContext.messages is a mutable copy (does not affect history)", async () => {
    let messagesLengthInModelHook = 0
    let historyLengthInModelHook = 0

    const agent = new Agent({
      name: "test",
      model: {
        specificationVersion: "v3",
        provider: "mock",
        modelId: "mock",
        supportedUrls: {},
        doGenerate: vi.fn(async (): Promise<LanguageModelV3GenerateResult> => ({
          content: [{ type: "text", text: "ok" }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: { inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 3, text: 3, reasoning: 0 } },
          warnings: [],
        })),
        doStream: vi.fn(async () => { throw new Error("not implemented") }),
      },
      instructions: "Test.",
      defaults: false,
    })

    agent.use({
      name: "messages-mutator",
      model: async (ctx, next) => {
        // Mutate messages — should NOT affect session history
        ctx.addSystemMessage("Injected by middleware")
        messagesLengthInModelHook = ctx.messages.length
        historyLengthInModelHook = ctx.history.length
        return next()
      },
    })

    await agent.run("hello").result

    // model hook saw injected message
    expect(messagesLengthInModelHook).toBeGreaterThan(historyLengthInModelHook)
  })
})
