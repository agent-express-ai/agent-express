import { describe, it, expect } from "vitest"
import { Agent } from "../../src/agent.js"
import { TestModel } from "../../src/test/test-model.js"
import { FunctionModel } from "../../src/test/function-model.js"
import { capture } from "../../src/test/capture.js"
import { toolsFunction } from "../../src/tools/function.js"
import { z } from "zod"

describe("capture", () => {
  it("records single model call (input messages + response)", async () => {
    const { middleware, result } = capture()
    const agent = new Agent({
      name: "test",
      model: new TestModel({ defaultText: "Hello!" }),
      instructions: "You are helpful.",
      defaults: false,
    }).use(middleware)

    await agent.run("Hi there").result

    expect(result.turns).toHaveLength(1)
    expect(result.turns[0]!.callIndex).toBe(0)
    // Input should contain the user message
    expect(result.turns[0]!.input.some((m) => m.role === "user")).toBe(true)
    // Response should have the text from the model
    expect(result.turns[0]!.response.text).toBe("Hello!")
    expect(result.turns[0]!.response.finishReason).toBe("stop")
  })

  it("records multiple calls in one turn (tool flow: 2 model calls)", async () => {
    const model = new FunctionModel((_messages, { callIndex }) => {
      if (callIndex === 0) {
        return {
          toolCalls: [{ toolCallId: "tc-1", toolName: "greet", args: { name: "Alice" } }],
          usage: { inputTokens: 10, outputTokens: 5 },
          finishReason: "tool-calls",
        }
      }
      return {
        text: "Done greeting Alice!",
        usage: { inputTokens: 15, outputTokens: 8 },
        finishReason: "stop",
      }
    })

    const { middleware, result } = capture()
    const agent = new Agent({
      name: "test",
      model,
      instructions: "test",
      defaults: false,
    })
      .use(middleware)
      .use(toolsFunction({
        name: "greet",
        description: "Greet someone",
        schema: z.object({ name: z.string() }),
        execute: async ({ name }) => `Hello ${name}!`,
      }))

    await agent.run("Greet Alice").result

    expect(result.turns).toHaveLength(2)

    // First call: tool-calls response
    expect(result.turns[0]!.callIndex).toBe(0)
    expect(result.turns[0]!.response.finishReason).toBe("tool-calls")
    expect(result.turns[0]!.response.toolCalls).toHaveLength(1)
    expect(result.turns[0]!.response.toolCalls![0]!.toolName).toBe("greet")

    // Second call: text response after tool execution
    expect(result.turns[1]!.callIndex).toBe(1)
    expect(result.turns[1]!.response.text).toBe("Done greeting Alice!")
    expect(result.turns[1]!.response.finishReason).toBe("stop")

    // Second call should have more messages (includes tool result)
    expect(result.turns[1]!.input.length).toBeGreaterThan(result.turns[0]!.input.length)
  })

  it("clear() resets captured data", async () => {
    const { middleware, result } = capture()
    const agent = new Agent({
      name: "test",
      model: new TestModel({ defaultText: "response" }),
      instructions: "test",
      defaults: false,
    }).use(middleware)

    await agent.run("First").result
    expect(result.turns).toHaveLength(1)

    result.clear()
    expect(result.turns).toHaveLength(0)

    await agent.run("Second").result
    expect(result.turns).toHaveLength(1)
    expect(result.turns[0]!.response.text).toBe("response")
  })
})
