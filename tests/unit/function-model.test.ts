import { describe, it, expect } from "vitest"
import { Agent } from "../../src/agent.js"
import { FunctionModel } from "../../src/test/function-model.js"
import { toolsFunction } from "../../src/tools/function.js"
import { z } from "zod"

describe("FunctionModel", () => {
  it("delegates to handler function", async () => {
    const model = new FunctionModel(() => ({
      text: "custom response",
      usage: { inputTokens: 0, outputTokens: 0 },
      finishReason: "stop",
    }))

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    const { text } = await agent.run("Hello").result
    expect(text).toBe("custom response")
  })

  it("receives messages and callIndex", async () => {
    let receivedCallIndex = -1
    let receivedMessages: any[] = []

    const model = new FunctionModel((messages, { callIndex }) => {
      receivedCallIndex = callIndex
      receivedMessages = messages
      return { text: "ok", usage: { inputTokens: 0, outputTokens: 0 }, finishReason: "stop" }
    })

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    await agent.run("Hello").result

    expect(receivedCallIndex).toBe(0)
    expect(receivedMessages.length).toBeGreaterThan(0)
    expect(receivedMessages.some((m: any) => m.content === "Hello")).toBe(true)
  })

  it("supports async handlers", async () => {
    const model = new FunctionModel(async () => {
      await new Promise((r) => setTimeout(r, 10))
      return { text: "async response", usage: { inputTokens: 0, outputTokens: 0 }, finishReason: "stop" }
    })

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    const { text } = await agent.run("test").result
    expect(text).toBe("async response")
  })

  it("supports throwing errors", async () => {
    const model = new FunctionModel(() => {
      throw new Error("handler error")
    })

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    await expect(agent.run("test").result).rejects.toThrow("handler error")
  })

  it("handles tool-call → text flow", async () => {
    let toolExecuted = false

    const model = new FunctionModel((_messages, { callIndex }) => {
      if (callIndex === 0) {
        return {
          toolCalls: [{ toolCallId: "tc1", toolName: "add", args: { a: 1, b: 2 } }],
          usage: { inputTokens: 0, outputTokens: 0 },
          finishReason: "tool-calls",
        }
      }
      return { text: "The sum is 3", usage: { inputTokens: 0, outputTokens: 0 }, finishReason: "stop" }
    })

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
      .use(toolsFunction({
        name: "add",
        description: "Add numbers",
        schema: z.object({ a: z.number(), b: z.number() }),
        execute: async ({ a, b }) => {
          toolExecuted = true
          return (a as number) + (b as number)
        },
      }))

    const { text } = await agent.run("Add 1+2").result
    expect(text).toBe("The sum is 3")
    expect(toolExecuted).toBe(true)
  })
})
