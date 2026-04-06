import { describe, it, expect } from "vitest"
import { Agent, tools, guard } from "agent-express"
import { FunctionModel, testAgent } from "agent-express/test"
import { z } from "zod"

function createTestAgent() {
  // FunctionModel for multi-step control: search -> synthesize -> save
  const testModel = new FunctionModel((messages, { tools: availableTools, callIndex }) => {
    // Step 1: Call web_search
    if (callIndex === 0) {
      return {
        toolCalls: [
          {
            toolCallId: "tc-search-1",
            toolName: "web_search",
            args: { query: "TypeScript middleware frameworks" },
          },
        ],
        usage: { inputTokens: 100, outputTokens: 50 },
        finishReason: "tool-calls",
      }
    }

    // Step 2: Call save_report with synthesized content
    if (callIndex === 1) {
      return {
        toolCalls: [
          {
            toolCallId: "tc-save-1",
            toolName: "save_report",
            args: {
              title: "TypeScript Middleware Frameworks",
              content: "# Report\n\nFindings from research on TypeScript middleware frameworks.",
            },
          },
        ],
        usage: { inputTokens: 200, outputTokens: 100 },
        finishReason: "tool-calls",
      }
    }

    // Step 3: Final text response
    return {
      text: "I have completed the research and saved the report. The report covers TypeScript middleware frameworks.",
      usage: { inputTokens: 150, outputTokens: 80 },
      finishReason: "stop",
    }
  })

  const agent = new Agent({
    name: "research",
    model: testModel,
    instructions: "You are a research agent.",
    defaults: false,
  })

  agent.use(
    tools.function({
      name: "web_search",
      description: "Search the web",
      schema: z.object({ query: z.string() }),
      execute: async ({ query }) => ({
        results: [
          { title: `Result for: ${query}`, url: "https://example.com", snippet: "Relevant info." },
        ],
      }),
    }),
  )

  agent.use(
    tools.function({
      name: "save_report",
      description: "Save a research report",
      schema: z.object({
        title: z.string(),
        content: z.string(),
      }),
      execute: async ({ title, content }) => ({
        saved: true,
        path: `./reports/${(title as string).toLowerCase().replace(/\s+/g, "-")}.md`,
      }),
    }),
  )

  // Output guard — redact PII
  agent.use(
    guard.output(async (response) => {
      if (!response.text) return { ok: true }
      let redacted = response.text
      redacted = redacted.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[EMAIL REDACTED]")
      redacted = redacted.replace(/(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, "[PHONE REDACTED]")
      if (redacted !== response.text) return { ok: true, output: redacted }
      return { ok: true }
    }),
  )

  return agent
}

describe("research agent", () => {
  it("should complete a multi-step research flow (search -> save)", async () => {
    const agent = createTestAgent()
    const result = await testAgent(agent, {
      input: "Research TypeScript middleware frameworks",
      expect: {
        toolsCalled: ["web_search", "save_report"],
      },
    })

    expect(result.passed).toBe(true)
  })

  it("should produce a final text response", async () => {
    const agent = createTestAgent()
    const { text } = await agent.run("Research TypeScript middleware frameworks").result

    expect(text).toContain("report")
  })

  it("should redact email addresses in output", async () => {
    const modelWithEmail = new FunctionModel(() => ({
      text: "Contact us at test@example.com for more info.",
      usage: { inputTokens: 10, outputTokens: 20 },
      finishReason: "stop",
    }))

    const agent = new Agent({
      name: "research",
      model: modelWithEmail,
      instructions: "You are a research agent.",
      defaults: false,
    })

    agent.use(
      guard.output(async (response) => {
        if (!response.text) return { ok: true }
        const redacted = response.text.replace(
          /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
          "[EMAIL REDACTED]",
        )
        if (redacted !== response.text) return { ok: true, output: redacted }
        return { ok: true }
      }),
    )

    const { text } = await agent.run("Find contact info").result

    expect(text).toContain("[EMAIL REDACTED]")
    expect(text).not.toContain("test@example.com")
  })
})
