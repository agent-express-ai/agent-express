import { describe, it, expect } from "vitest"
import { Agent, tools } from "agent-express"
import { TestModel, testAgent } from "agent-express/test"
import { z } from "zod"

// Recreate the agent with TestModel for deterministic tests
function createTestAgent() {
  const agent = new Agent({
    name: "assistant",
    model: new TestModel(),
    instructions: "You are a helpful assistant. Answer questions clearly and concisely.",
    defaults: false,
  })

  agent.use(
    tools.function({
      name: "get_weather",
      description: "Get current weather for a city",
      schema: z.object({
        city: z.string().describe("City name"),
      }),
      execute: async ({ city }) => {
        return { city, temperature: "22°C", condition: "Sunny" }
      },
    }),
  )

  return agent
}

describe("assistant agent", () => {
  it("should respond to a simple message", async () => {
    const agent = createTestAgent()
    const { text } = await agent.run("Hello!").result

    expect(text).toBeDefined()
    expect(typeof text).toBe("string")
  })

  it("should call get_weather tool", async () => {
    const agent = createTestAgent()
    const result = await testAgent(agent, {
      input: "What's the weather in Paris?",
      expect: {
        toolsCalled: ["get_weather"],
      },
    })

    expect(result.passed).toBe(true)
  })

  it("should return a text response after tool call", async () => {
    const agent = createTestAgent()
    const { text } = await agent.run("What's the weather in Tokyo?").result

    expect(text).toBe("test response")
  })
})
