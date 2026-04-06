import { describe, it, expect } from "vitest"
import { Agent } from "../../src/agent.js"
import { TestModel } from "../../src/test/test-model.js"
import { toolsFunction } from "../../src/tools/function.js"
import { z } from "zod"

describe("TestModel", () => {
  it("returns default text with no config", async () => {
    const agent = new Agent({ name: "test", model: new TestModel(), instructions: "test", defaults: false })
    const { text } = await agent.run("Hello").result
    expect(text).toBe("test response")
  })

  it("returns custom default text", async () => {
    const agent = new Agent({ name: "test", model: new TestModel({ defaultText: "Hello!" }), instructions: "test", defaults: false })
    const { text } = await agent.run("Hi").result
    expect(text).toBe("Hello!")
  })

  it("auto-calls all available tools", async () => {
    let toolCalled = false
    const agent = new Agent({ name: "test", model: new TestModel(), instructions: "test", defaults: false })
      .use(toolsFunction({
        name: "greet",
        description: "Greet someone",
        schema: z.object({ name: z.string() }),
        execute: async ({ name }) => {
          toolCalled = true
          return `Hello ${name}!`
        },
      }))

    await agent.run("Greet Alice").result
    expect(toolCalled).toBe(true)
  })

  it("returns configured responses in order", async () => {
    const model = new TestModel({
      responses: [
        { text: "first", usage: { inputTokens: 0, outputTokens: 0 }, finishReason: "stop" },
        { text: "second", usage: { inputTokens: 0, outputTokens: 0 }, finishReason: "stop" },
      ],
    })

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })

    const r1 = await agent.run("one").result
    expect(r1.text).toBe("first")

    const r2 = await agent.run("two").result
    expect(r2.text).toBe("second")
  })

  it("throws when configured responses are exhausted", async () => {
    const model = new TestModel({
      responses: [
        { text: "only one", usage: { inputTokens: 0, outputTokens: 0 }, finishReason: "stop" },
      ],
    })

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    await agent.run("one").result

    await expect(agent.run("two").result).rejects.toThrow("TestModel exhausted")
  })
})
