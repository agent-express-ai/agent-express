import { Agent, tools, guard, model } from "agent-express"
import { z } from "zod"

const agent = new Agent({
  name: "research",
  model: "anthropic/claude-sonnet-4-6",
  instructions: `You are a research agent that searches for information and synthesizes reports.

Your workflow:
1. Break down the research question into specific search queries
2. Search for relevant information using web_search
3. Synthesize findings into a clear, structured report
4. Save the report using save_report

Always cite your sources. Be thorough but concise.`,
})

// Web search tool (fake results for demo)
agent.use(
  tools.function({
    name: "web_search",
    description: "Search the web for information. Returns a list of relevant results with titles, URLs, and snippets.",
    schema: z.object({
      query: z.string().describe("Search query"),
    }),
    execute: async ({ query }) => {
      // Fake search results — replace with a real search API (SerpAPI, Tavily, etc.)
      return {
        results: [
          {
            title: `Result 1 for: ${query}`,
            url: `https://example.com/article-1?q=${encodeURIComponent(query as string)}`,
            snippet: `This is a relevant article about ${query}. It covers the main aspects and provides detailed analysis.`,
          },
          {
            title: `Result 2 for: ${query}`,
            url: `https://example.com/article-2?q=${encodeURIComponent(query as string)}`,
            snippet: `Another perspective on ${query}, with data from recent studies and expert opinions.`,
          },
          {
            title: `Result 3 for: ${query}`,
            url: `https://example.com/article-3?q=${encodeURIComponent(query as string)}`,
            snippet: `A comprehensive overview of ${query} including historical context and future outlook.`,
          },
        ],
      }
    },
  }),
)

// Save report tool (fake save for demo)
agent.use(
  tools.function({
    name: "save_report",
    description: "Save a research report to a file. Returns the file path where the report was saved.",
    schema: z.object({
      title: z.string().describe("Report title"),
      content: z.string().describe("Report content in markdown format"),
    }),
    execute: async ({ title, content }) => {
      // Fake file save — replace with real file I/O
      const filename = `${(title as string).toLowerCase().replace(/\s+/g, "-")}.md`
      return {
        saved: true,
        path: `./reports/${filename}`,
        size: (content as string).length,
      }
    },
  }),
)

// Model router — use cheaper model for simple searches, expensive for synthesis
agent.use(
  model.router({
    routes: {
      simple: "anthropic/claude-haiku-3-5",
      medium: "anthropic/claude-sonnet-4-6",
      complex: "anthropic/claude-sonnet-4-6",
    },
  }),
)

// Output guard — redact PII (email and phone patterns)
agent.use(
  guard.output(async (response) => {
    if (!response.text) return { ok: true }

    let redacted = response.text
    // Redact email addresses
    redacted = redacted.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[EMAIL REDACTED]")
    // Redact phone numbers (various formats)
    redacted = redacted.replace(/(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, "[PHONE REDACTED]")

    if (redacted !== response.text) {
      return { ok: true, output: redacted }
    }

    return { ok: true }
  }),
)

// Turn timeout — 30 seconds per turn
agent.use(guard.timeout({ turn: 30_000 }))

export default agent
export { agent }
