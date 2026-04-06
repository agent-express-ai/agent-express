import { Agent, tools } from "agent-express"
import { z } from "zod"

const agent = new Agent({
  name: "assistant",
  model: "anthropic/claude-sonnet-4-6",
  instructions: "You are a helpful assistant. Answer questions clearly and concisely.",
})

// Register the get_weather tool
agent.use(
  tools.function({
    name: "get_weather",
    description: "Get current weather for a city",
    schema: z.object({
      city: z.string().describe("City name, e.g. 'San Francisco'"),
    }),
    execute: async ({ city }) => {
      // Fake weather data — replace with a real API call
      const conditions = ["Sunny", "Cloudy", "Rainy", "Partly cloudy"]
      const temp = Math.floor(Math.random() * 30) + 10
      const condition = conditions[Math.floor(Math.random() * conditions.length)]
      return { city, temperature: `${temp}°C`, condition }
    },
  }),
)

export default agent
export { agent }
