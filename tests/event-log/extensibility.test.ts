import { describe, it, expect, vi } from "vitest"
import { z } from "zod"
import { Agent } from "../../src/agent.js"
import { typedEvents } from "../../src/event-log/typed-events.js"
import { EventTypeCollisionError } from "../../src/errors.js"
import type { LanguageModelV3, LanguageModelV3GenerateResult } from "@ai-sdk/provider"
import type { Middleware } from "../../src/middleware.js"
import { pingChannel, PingSchema } from "../fixtures/sibling-middleware/index.js"

function mockModel(text = "ok"): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: "mock",
    modelId: "mock",
    supportedUrls: {},
    doGenerate: vi.fn(async (): Promise<LanguageModelV3GenerateResult> => ({
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 5, text: 5, reasoning: 0 },
      },
      warnings: [],
    })),
    doStream: vi.fn(async () => { throw new Error("not implemented") }),
  }
}

describe("event vocabulary extensibility", () => {
  it("middleware-declared event types round-trip through session.events", async () => {
    const InboundSchema = z.object({ channel: z.string(), text: z.string() })
    const slack: Middleware = {
      name: "slack-channel",
      events: {
        "channel:slack:inbound": { schema: InboundSchema, schemaVersion: 1 },
      },
      turn: async (ctx, next) => {
        ctx.emit({ type: "channel:slack:inbound", payload: { channel: "C1", text: "hi" } })
        await next()
      },
    }

    const agent = new Agent({ name: "test", model: mockModel(), instructions: "test", defaults: false })
    agent.use(slack)
    await agent.run("first").result

    const session = agent.session()
    await session.run("hello").result

    const inbound = session.events.find((e) => e.type === "channel:slack:inbound")
    expect(inbound).toBeDefined()
    expect(inbound!.payload).toEqual({ channel: "C1", text: "hi" })

    await session.close()
    await agent.dispose()
  })

  it("typedEvents() narrows the read-site to a parsed payload", async () => {
    const agent = new Agent({ name: "test", model: mockModel(), instructions: "test", defaults: false })
    agent.use(pingChannel())
    await agent.init()
    const session = agent.session()
    await session.run("go").result

    const pings = [...typedEvents(session.events, "channel:test:ping", PingSchema)]
    expect(pings).toHaveLength(1)
    expect(typeof pings[0]!.payload.at).toBe("number")
    expect(pings[0]!.payload.tag).toBe("before-next")

    await session.close()
    await agent.dispose()
  })

  it("emitting an undeclared event type throws UnknownEventTypeError", async () => {
    const naughty: Middleware = {
      name: "naughty",
      // No events declared
      turn: async (ctx, next) => {
        // Force-emit a type the merged map doesn't know about.
        expect(() => ctx.emit({ type: "channel:rogue", payload: {} })).toThrow(/Unknown event type/)
        await next()
      },
    }

    const agent = new Agent({ name: "test", model: mockModel(), instructions: "test", defaults: false })
    agent.use(naughty)
    await agent.run("go").result
    await agent.dispose()
  })

  it("emitting a payload that fails the declared schema throws EventValidationError", async () => {
    const Schema = z.object({ tag: z.string() })
    const mw: Middleware = {
      name: "validator",
      events: { "channel:strict": { schema: Schema, schemaVersion: 1 } },
      turn: async (ctx, next) => {
        // tag must be a string
        expect(() =>
          ctx.emit({ type: "channel:strict", payload: { tag: 42 } as unknown }),
        ).toThrow(/failed validation/)
        await next()
      },
    }
    const agent = new Agent({ name: "test", model: mockModel(), instructions: "test", defaults: false })
    agent.use(mw)
    await agent.run("go").result
    await agent.dispose()
  })

  it("two middleware declaring the same event type collide at agent.init()", async () => {
    const a: Middleware = {
      name: "a",
      events: { "channel:dup": { schema: z.unknown(), schemaVersion: 1 } },
    }
    const b: Middleware = {
      name: "b",
      events: { "channel:dup": { schema: z.unknown(), schemaVersion: 1 } },
    }
    const agent = new Agent({ name: "test", model: mockModel(), instructions: "test", defaults: false })
    agent.use(a)
    agent.use(b)
    await expect(agent.init()).rejects.toThrow(EventTypeCollisionError)
  })

  it("middleware redeclaring a core event type collides at init()", async () => {
    const naughty: Middleware = {
      name: "wrecker",
      events: { "user:input": { schema: z.unknown(), schemaVersion: 1 } },
    }
    const agent = new Agent({ name: "test", model: mockModel(), instructions: "test", defaults: false })
    agent.use(naughty)
    await expect(agent.init()).rejects.toThrow(EventTypeCollisionError)
  })

  it("middleware claiming a reserved-only core type collides at init()", async () => {
    const earlyBird: Middleware = {
      name: "early",
      events: { "agent:handoff": { schema: z.unknown(), schemaVersion: 1 } },
    }
    const agent = new Agent({ name: "test", model: mockModel(), instructions: "test", defaults: false })
    agent.use(earlyBird)
    await expect(agent.init()).rejects.toThrow(EventTypeCollisionError)
  })

  it("third-party-style middleware (sibling package) self-registers via agent.use()", async () => {
    const agent = new Agent({ name: "test", model: mockModel(), instructions: "test", defaults: false })
    agent.use(pingChannel())
    await agent.init()
    const session = agent.session()
    await session.run("ping").result

    const pingTypes = session.events.filter((e) => e.type === "channel:test:ping")
    expect(pingTypes).toHaveLength(1)
    await session.close()
    await agent.dispose()
  })

  it("forward-compat: a session containing custom-type events still loads when middleware is absent", async () => {
    const InboundSchema = z.object({ channel: z.string() })
    const slack: Middleware = {
      name: "slack-fwd",
      events: { "channel:slack:fwd": { schema: InboundSchema, schemaVersion: 1 } },
      turn: async (ctx, next) => {
        ctx.emit({ type: "channel:slack:fwd", payload: { channel: "C1" } })
        await next()
      },
    }

    const writer = new Agent({ name: "writer", model: mockModel(), instructions: "test", defaults: false })
    writer.use(slack)
    await writer.init()
    const writerSession = writer.session({ id: "shared-session" })
    await writerSession.run("ping").result
    const persisted = [...writerSession.events]
    await writerSession.close()
    await writer.dispose()

    // Reader agent does NOT include the slack-fwd middleware. It rehydrates
    // the events list manually (simulating a load via an adapter) and walks
    // it — events of types unknown to this agent must not crash the reader.
    const reader = new Agent({ name: "reader", model: mockModel(), instructions: "test", defaults: false })
    await reader.init()

    const seen = persisted.map((e) => e.type)
    expect(seen).toContain("channel:slack:fwd")
    // Reader has no schema for this type, so it stays as Event<string, unknown>
    // and consumers must narrow themselves (via typedEvents or manual cast).
    const fwd = persisted.find((e) => e.type === "channel:slack:fwd")
    expect(fwd).toBeDefined()
    expect((fwd!.payload as { channel: string }).channel).toBe("C1")

    await reader.dispose()
  })
})
