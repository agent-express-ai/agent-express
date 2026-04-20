import { describe, it, expect, vi } from "vitest"
import { Agent } from "../../src/agent.js"
import { FunctionModel } from "../../src/test/function-model.js"
import { toolsFunction } from "../../src/tools/function.js"
import { guardPiiRedact } from "../../src/middleware/guard/pii-redact.js"
import { z } from "zod"

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

  it("redacts PII in multi-part message content", async () => {
    let messagesSeenByModel: any[] = []
    const model = new FunctionModel((messages) => {
      messagesSeenByModel = messages
      return {
        text: "ok",
        usage: { inputTokens: 10, outputTokens: 5 },
        finishReason: "stop",
      }
    })
    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    // Register the multipart injector FIRST — it is the outer layer in the onion,
    // so it runs before piiRedact and converts the user message to multi-part.
    // Then piiRedact runs and should redact text fields within the parts.
    agent.use({
      name: "multipart-injector",
      async model(ctx, next) {
        for (let i = 0; i < ctx.messages.length; i++) {
          const msg = ctx.messages[i]!
          if (msg.role === "user" && typeof msg.content === "string") {
            ctx.messages[i] = {
              role: "user",
              content: [
                { type: "text" as const, text: "My email is alice@secret.com" },
                { type: "text" as const, text: "Call me at 555-999-8888" },
              ],
            }
          }
        }
        return next()
      },
    })
    agent.use(guardPiiRedact())
    await agent.run("placeholder").result
    // Verify the model received redacted multi-part content
    const userMsgs = messagesSeenByModel.filter((m: any) => m.role === "user")
    expect(userMsgs.length).toBeGreaterThan(0)
    for (const msg of userMsgs) {
      if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.text) {
            expect(part.text).not.toContain("alice@secret.com")
            expect(part.text).not.toContain("555-999-8888")
          }
        }
      }
    }
  })

  it("restores PII in tool args via shared state (model→tool propagation)", async () => {
    const receivedArgs = vi.fn()

    const model = new FunctionModel((_msgs, { callIndex }) => {
      if (callIndex === 0) {
        return {
          toolCalls: [{ toolCallId: "tc1", toolName: "send_email", args: { to: "[EMAIL_1]", body: "Hello" } }],
          usage: { inputTokens: 10, outputTokens: 5 },
          finishReason: "tool-calls",
        }
      }
      return { text: "Sent!", usage: { inputTokens: 5, outputTokens: 3 }, finishReason: "stop" }
    })

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(guardPiiRedact())
    agent.use(toolsFunction({
      name: "send_email",
      description: "Send an email",
      schema: z.object({ to: z.string(), body: z.string() }),
      execute: async (args) => {
        receivedArgs(args)
        return "sent"
      },
    }))

    // Run with a message containing an email that will be redacted to [EMAIL_1]
    await agent.run("Send to alice@example.com").result

    // The tool should have received the restored original email
    expect(receivedArgs).toHaveBeenCalled()
    const args = receivedArgs.mock.calls[0]![0]
    expect(args.to).toBe("alice@example.com")
  })

  it("restores PII in nested tool args", async () => {
    const receivedArgs = vi.fn()

    const model = new FunctionModel((_msgs, { callIndex }) => {
      if (callIndex === 0) {
        return {
          toolCalls: [{
            toolCallId: "tc1",
            toolName: "update_profile",
            args: {
              user: { email: "[EMAIL_1]", contacts: [{ phone: "[PHONE_1]" }] },
              note: "Updated [EMAIL_1]",
            },
          }],
          usage: { inputTokens: 10, outputTokens: 5 },
          finishReason: "tool-calls",
        }
      }
      return { text: "Done", usage: { inputTokens: 5, outputTokens: 3 }, finishReason: "stop" }
    })

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(guardPiiRedact())
    agent.use(toolsFunction({
      name: "update_profile",
      description: "Update a user profile",
      schema: z.object({
        user: z.object({
          email: z.string(),
          contacts: z.array(z.object({ phone: z.string() })),
        }),
        note: z.string(),
      }),
      execute: async (args) => {
        receivedArgs(args)
        return "updated"
      },
    }))

    await agent.run("Update alice@example.com phone 555-111-2222").result

    expect(receivedArgs).toHaveBeenCalled()
    const args = receivedArgs.mock.calls[0]![0]
    expect(args.user.email).toBe("alice@example.com")
    expect(args.user.contacts[0].phone).toBe("555-111-2222")
    expect(args.note).toBe("Updated alice@example.com")
  })

  it("stores mappings in session state under guard:pii:mappings", async () => {
    const agent = createAgent()
    const { state } = await agent.run("My email is test@test.com").result
    const mappings = state["guard:pii:mappings"] as Array<{ placeholder: string; original: string; type: string }>
    expect(mappings).toBeDefined()
    expect(mappings.length).toBeGreaterThan(0)
    expect(mappings[0]!.original).toBe("test@test.com")
    expect(mappings[0]!.type).toBe("email")
  })
})
