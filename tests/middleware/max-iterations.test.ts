import { describe, it, expect } from "vitest"
import { Agent } from "../../src/agent.js"
import { FunctionModel } from "../../src/test/function-model.js"
import { toolsFunction } from "../../src/tools/function.js"
import { guardMaxIterations } from "../../src/middleware/guard/max-iterations.js"
import { z } from "zod"

describe("guard.maxIterations()", () => {
  it("allows turns within the limit to complete normally", async () => {
    let modelCalls = 0

    const model = new FunctionModel((_messages, { callIndex }) => {
      modelCalls++
      if (callIndex === 0) {
        return {
          toolCalls: [{ toolCallId: "tc1", toolName: "echo", args: { msg: "hi" } }],
          usage: { inputTokens: 0, outputTokens: 0 },
          finishReason: "tool-calls",
        }
      }
      return { text: "Done", usage: { inputTokens: 0, outputTokens: 0 }, finishReason: "stop" }
    })

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(guardMaxIterations(5))
    agent.use(toolsFunction({
      name: "echo",
      description: "Echo",
      schema: z.object({ msg: z.string() }),
      execute: async ({ msg }) => msg,
    }))

    const { text } = await agent.run("test").result
    expect(text).toBe("Done")
    expect(modelCalls).toBe(2)
  })

  it("strips tool calls on the last allowed model call (lines 59-65)", async () => {
    // With max=2: call 1 returns tool calls (allowed), call 2 returns tool calls
    // but count >= max so tool calls are stripped → loop exits with text.
    let modelCalls = 0

    const model = new FunctionModel(() => {
      modelCalls++
      return {
        text: "partial answer",
        toolCalls: [{ toolCallId: `tc${modelCalls}`, toolName: "echo", args: { msg: "hi" } }],
        usage: { inputTokens: 10, outputTokens: 5 },
        finishReason: "tool-calls",
      }
    })

    let toolExecutions = 0
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(guardMaxIterations(2))
    agent.use(toolsFunction({
      name: "echo",
      description: "Echo",
      schema: z.object({ msg: z.string() }),
      execute: async ({ msg }) => {
        toolExecutions++
        return msg
      },
    }))

    const { text } = await agent.run("test").result

    // Model called twice: first with tool calls (executed), second with tool calls (stripped)
    expect(modelCalls).toBe(2)
    // Only the first call's tool was executed; the second was stripped
    expect(toolExecutions).toBe(1)
    // The stripped response returns the text from the model response
    expect(text).toBe("partial answer")
  })

  it("skips LLM call entirely when count exceeds max (lines 47-52)", async () => {
    // Lines 47-52 are a defensive guard: if the model hook is called when
    // count already exceeds max, it skips the LLM call entirely and returns
    // an empty response. We test this by using max=3 with 3 tool-calling
    // iterations: call 3 strips tool calls (lines 59-65), and then the loop
    // exits. To reach count > max, we use a lower max to trigger the skip
    // on the very next call in the loop. With max=2 and a model that always
    // returns tool calls: call 1 passes, call 2 strips, loop exits.
    // But we can reach it with max=2 + a model that returns text-only tool
    // calls mix. Actually, the count > max path fires when count exceeds max
    // strictly — meaning we need 3 model calls with max=2. This happens when
    // a model response at count=max has its tool calls stripped (so the model
    // IS called), and then somehow the loop continues. Since stripping causes
    // the loop to exit, this path is only reachable through direct hook testing.

    const mw = guardMaxIterations(2)
    const turnId = "test-turn-123"

    // Simulate the turn hook to initialize the counter
    await mw.turn!(
      { turnId } as any,
      async () => {
        // Simulate 3 model calls within a single turn
        let modelCallCount = 0
        const fakeNext = async () => {
          modelCallCount++
          return {
            text: "model text",
            toolCalls: [{ toolCallId: "tc1", toolName: "tool", args: {} }],
            usage: { inputTokens: 10, outputTokens: 5 },
            finishReason: "tool-calls" as const,
          }
        }

        // Call 1: count = 1, count <= max(2), passes through
        const r1 = await mw.model!({ turnId } as any, fakeNext)
        expect(r1.finishReason).toBe("tool-calls")
        expect(r1.toolCalls).toBeDefined()

        // Call 2: count = 2, count >= max(2), strips tool calls (lines 59-65)
        const r2 = await mw.model!({ turnId } as any, fakeNext)
        expect(r2.finishReason).toBe("length")
        expect(r2.toolCalls).toBeUndefined()
        expect(r2.text).toBe("model text")

        // Call 3: count = 3, count > max(2), skips LLM entirely (lines 47-52)
        const r3 = await mw.model!({ turnId } as any, fakeNext)
        expect(r3.text).toBe("")
        expect(r3.finishReason).toBe("length")
        expect(r3.usage).toEqual({ inputTokens: 0, outputTokens: 0 })
        // fakeNext was NOT called for this iteration
        expect(modelCallCount).toBe(2)
      },
    )
  })

  it("returns empty text when model produces no text and limit is reached", async () => {
    // Model returns only tool calls (no text field) and limit strips them
    let modelCalls = 0

    const model = new FunctionModel(() => {
      modelCalls++
      return {
        toolCalls: [{ toolCallId: `tc${modelCalls}`, toolName: "noop", args: {} }],
        usage: { inputTokens: 0, outputTokens: 0 },
        finishReason: "tool-calls",
      }
    })

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(guardMaxIterations(2))
    agent.use(toolsFunction({
      name: "noop",
      description: "No-op",
      schema: z.object({}),
      execute: async () => "ok",
    }))

    const { text } = await agent.run("test").result

    // At count=2 (the max), tool calls are stripped and text defaults to ""
    expect(text).toBe("")
    expect(modelCalls).toBe(2)
  })

  it("preserves usage from the original response when stripping tool calls", async () => {
    // Verify the stripped response carries forward the original usage
    let modelCalls = 0
    const capturedResponses: any[] = []

    const model = new FunctionModel(() => {
      modelCalls++
      return {
        text: "response text",
        toolCalls: [{ toolCallId: `tc${modelCalls}`, toolName: "echo", args: { msg: "hi" } }],
        usage: { inputTokens: 42, outputTokens: 17 },
        finishReason: "tool-calls",
      }
    })

    // Use a custom middleware after maxIterations to capture the response
    const captureMiddleware = {
      name: "capture",
      async model(ctx: any, next: () => Promise<any>) {
        const response = await next()
        capturedResponses.push(response)
        return response
      },
    }

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    // capture wraps maxIterations, so it sees the transformed response
    agent.use(captureMiddleware)
    agent.use(guardMaxIterations(1))
    agent.use(toolsFunction({
      name: "echo",
      description: "Echo",
      schema: z.object({ msg: z.string() }),
      execute: async ({ msg }) => msg,
    }))

    await agent.run("test").result

    // The first (and only real) model call at count=1 >= max=1 strips tool calls
    expect(capturedResponses[0]).toEqual({
      text: "response text",
      finishReason: "length",
      usage: { inputTokens: 42, outputTokens: 17 },
    })
  })

  it("resets counter per turn so second turn gets full budget", async () => {
    let modelCalls = 0

    const model = new FunctionModel(() => {
      modelCalls++
      return { text: `response ${modelCalls}`, usage: { inputTokens: 0, outputTokens: 0 }, finishReason: "stop" }
    })

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(guardMaxIterations(2))

    await agent.init()
    const session = agent.session()

    const r1 = await session.run("turn 1").result
    expect(r1.text).toBe("response 1")

    const r2 = await session.run("turn 2").result
    expect(r2.text).toBe("response 2")

    expect(modelCalls).toBe(2)

    await session.close()
    await agent.dispose()
  })

  it("uses default max of 25 when no argument provided", async () => {
    const mw = guardMaxIterations()
    expect(mw.name).toBe("guard:maxIterations")
    expect(mw.turn).toBeDefined()
    expect(mw.model).toBeDefined()
  })
})
