import { describe, it, expect } from "vitest"
import { supportBot } from "../src/support-bot.js"

describe("supportBot()", () => {
  it("returns middleware array with defaults", () => {
    const middlewares = supportBot()
    expect(Array.isArray(middlewares)).toBe(true)
    expect(middlewares.length).toBeGreaterThan(0)
  })

  it("includes composition middleware named preset:supportBot", () => {
    const middlewares = supportBot()
    expect(middlewares.some(m => m.name === "preset:supportBot")).toBe(true)
  })

  it("includes tone middleware by default", () => {
    const middlewares = supportBot()
    expect(middlewares.some(m => m.name === "guard:tone")).toBe(true)
  })

  it("includes escalation safety net", () => {
    const middlewares = supportBot()
    expect(middlewares.some(m => m.name === "support:escalation")).toBe(true)
  })

  it("tone: false disables tone middleware", () => {
    const middlewares = supportBot({ tone: false })
    expect(middlewares.some(m => m.name === "guard:tone")).toBe(false)
  })

  it("escalation tool registered when provided", () => {
    const mockTool = {
      name: "escalate_to_human",
      description: "Transfer to human",
      jsonSchema: {},
      execute: async () => "transferred",
    }
    const middlewares = supportBot({ escalation: mockTool })
    // Composition middleware should register the tool in agent hook
    const composition = middlewares.find(m => m.name === "preset:supportBot")
    expect(composition?.agent).toBeDefined()
  })

  it("fileSearch middleware included when provided", () => {
    const mockSearch = { name: "search:file", model: async (_ctx: any, next: any) => next() }
    const middlewares = supportBot({ fileSearch: mockSearch })
    expect(middlewares.some(m => m.name === "search:file")).toBe(true)
  })

  it("webSearch middleware included when provided", () => {
    const mockSearch = { name: "search:web", model: async (_ctx: any, next: any) => next() }
    const middlewares = supportBot({ webSearch: mockSearch })
    expect(middlewares.some(m => m.name === "search:web")).toBe(true)
  })

  it("sessionStore middleware included when provided", () => {
    const mockStore = { name: "memory:store", session: async (_ctx: any, next: any) => next() }
    const middlewares = supportBot({ sessionStore: mockStore })
    expect(middlewares.some(m => m.name === "memory:store")).toBe(true)
  })

  it("custom tone style", () => {
    const middlewares = supportBot({ tone: "formal" })
    expect(middlewares.some(m => m.name === "guard:tone")).toBe(true)
  })

  it("custom escalationAfter", () => {
    const middlewares = supportBot({ escalationAfter: 3 })
    expect(middlewares.some(m => m.name === "support:escalation")).toBe(true)
  })

  it("includes budget guard by default", () => {
    const middlewares = supportBot()
    expect(middlewares.some(m => m.name === "guard:budget")).toBe(true)
  })

  it("budget: false disables budget guard", () => {
    const middlewares = supportBot({ budget: false })
    expect(middlewares.some(m => m.name === "guard:budget")).toBe(false)
  })

  it("custom budget value", () => {
    const middlewares = supportBot({ budget: 1.0 })
    expect(middlewares.some(m => m.name === "guard:budget")).toBe(true)
  })

  it("includes timeout guard by default", () => {
    const middlewares = supportBot()
    expect(middlewares.some(m => m.name === "guard:timeout")).toBe(true)
  })

  it("timeout: false disables timeout guard", () => {
    const middlewares = supportBot({ timeout: false })
    expect(middlewares.some(m => m.name === "guard:timeout")).toBe(false)
  })

  it("includes PII redaction by default", () => {
    const middlewares = supportBot()
    expect(middlewares.some(m => m.name === "guard:piiRedact")).toBe(true)
  })

  it("pii: false disables PII redaction", () => {
    const middlewares = supportBot({ pii: false })
    expect(middlewares.some(m => m.name === "guard:piiRedact")).toBe(false)
  })

  it("includes rate limiting by default", () => {
    const middlewares = supportBot()
    expect(middlewares.some(m => m.name === "guard:rateLimit")).toBe(true)
  })

  it("rateLimit: false disables rate limiting", () => {
    const middlewares = supportBot({ rateLimit: false })
    expect(middlewares.some(m => m.name === "guard:rateLimit")).toBe(false)
  })

  it("custom rateLimit config", () => {
    const middlewares = supportBot({ rateLimit: { maxPerMinute: 30, by: "ip" } })
    expect(middlewares.some(m => m.name === "guard:rateLimit")).toBe(true)
  })
})
