import { describe, it, expect } from "vitest"
import { Agent } from "../../src/agent.js"
import { FunctionModel } from "../../src/test/function-model.js"
import { guardPiiRedact } from "../../src/middleware/guard/pii-redact.js"

function createAgent(config?: Parameters<typeof guardPiiRedact>[0]) {
  const model = new FunctionModel((messages) => {
    const lastUser = messages.filter(m => m.role === "user").pop()
    return {
      text: `Received: ${typeof lastUser?.content === "string" ? lastUser.content : ""}`,
      usage: { inputTokens: 10, outputTokens: 5 },
      finishReason: "stop",
    }
  })
  const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
  agent.use(guardPiiRedact(config))
  return agent
}

describe("guard.piiRedact()", () => {
  it("redacts email addresses", async () => {
    const agent = createAgent()
    const { text } = await agent.run("My email is john@example.com").result
    expect(text).not.toContain("john@example.com")
    expect(text).toContain("[EMAIL")
  })

  it("redacts phone numbers", async () => {
    const agent = createAgent()
    const { text } = await agent.run("Call me at +1-555-123-4567").result
    expect(text).not.toContain("555-123-4567")
    expect(text).toContain("[PHONE")
  })

  it("redacts credit card numbers", async () => {
    const agent = createAgent()
    const { text } = await agent.run("My card is 4111-1111-1111-1111").result
    expect(text).not.toContain("4111")
    expect(text).toContain("[CREDIT_CARD")
  })

  it("redacts SSN", async () => {
    const agent = createAgent()
    const { text } = await agent.run("My SSN is 123-45-6789").result
    expect(text).not.toContain("123-45-6789")
    expect(text).toContain("[SSN")
  })

  it("redacts IP addresses", async () => {
    const agent = createAgent()
    const { text } = await agent.run("Server at 192.168.1.100").result
    expect(text).not.toContain("192.168.1.100")
    expect(text).toContain("[IP_ADDRESS")
  })

  it("type selection — only specified types masked", async () => {
    const agent = createAgent({ types: ["email"] })
    const { text } = await agent.run("Email john@test.com phone 555-123-4567").result
    expect(text).not.toContain("john@test.com")
    expect(text).toContain("555-123-4567") // phone NOT redacted
  })

  it("custom patterns", async () => {
    const agent = createAgent({
      custom: [{ pattern: /ACCT-\d+/g, placeholder: "[ACCOUNT]" }],
    })
    const { text } = await agent.run("Account ACCT-12345").result
    expect(text).not.toContain("ACCT-12345")
    expect(text).toContain("[ACCOUNT")
  })

  it("multiple PII in one message", async () => {
    const agent = createAgent()
    const { text } = await agent.run("Email: a@b.com, phone: 555-111-2222").result
    expect(text).not.toContain("a@b.com")
    expect(text).not.toContain("555-111-2222")
  })

  it("no PII — message unchanged", async () => {
    const agent = createAgent()
    const { text } = await agent.run("Hello, how are you?").result
    expect(text).toContain("Hello, how are you?")
  })
})
