import { describe, it, expect } from "vitest"
import { Agent } from "../../src/agent.js"
import { FunctionModel } from "../../src/test/function-model.js"
import { guardRateLimit, UserRateLimitError } from "../../src/middleware/guard/rate-limit.js"

function createAgent(config?: Parameters<typeof guardRateLimit>[0]) {
  const model = new FunctionModel(() => ({
    text: "ok",
    usage: { inputTokens: 5, outputTokens: 5 },
    finishReason: "stop",
  }))
  const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
  agent.use(guardRateLimit(config))
  return agent
}

describe("guard.rateLimit()", () => {
  it("message strategy — returns friendly text when limit exceeded", async () => {
    const agent = createAgent({ maxPerMinute: 2, onExceeded: "message" })

    // Use a single session for multiple runs so sessionId stays the same
    await agent.init()
    const session = agent.session()

    await session.run("msg1").result
    await session.run("msg2").result
    const { text } = await session.run("msg3").result // should be limited

    await session.close()
    await agent.dispose()

    expect(text).toContain("Please wait")
  })

  it("throw strategy — throws UserRateLimitError", async () => {
    const agent = createAgent({ maxPerMinute: 1, onExceeded: "throw" })

    await agent.init()
    const session = agent.session()

    await session.run("msg1").result
    await expect(session.run("msg2").result).rejects.toThrow(UserRateLimitError)

    await session.close()
    await agent.dispose()
  })

  it("per-session isolation — different sessions are independent", async () => {
    const agent = createAgent({ maxPerMinute: 1 })

    // Each agent.run() creates a new session with a unique ID
    // So two separate agent.run() calls should both succeed
    const { text: t1 } = await agent.run("msg1").result
    const { text: t2 } = await agent.run("msg2").result

    expect(t1).toBe("ok")
    expect(t2).toBe("ok")
  })

  it("custom message", async () => {
    const agent = createAgent({ maxPerMinute: 1, message: "Too fast!" })

    await agent.init()
    const session = agent.session()

    await session.run("msg1").result
    const { text } = await session.run("msg2").result

    await session.close()
    await agent.dispose()

    expect(text).toContain("Too fast!")
  })

  it("default 60 per minute — allows normal usage", async () => {
    const agent = createAgent() // default: 60/min
    const { text } = await agent.run("hello").result
    expect(text).toBe("ok")
  })
})
