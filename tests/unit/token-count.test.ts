import { describe, it, expect } from "vitest"
import { defaultTokenCounter, countMessageTokens } from "../../src/token-count.js"

describe("defaultTokenCounter", () => {
  it("estimates ~1 token per 4 characters", () => {
    expect(defaultTokenCounter("hello")).toBe(2) // 5/4 = 1.25, ceil = 2
    expect(defaultTokenCounter("a")).toBe(1)
    expect(defaultTokenCounter("")).toBe(0)
    expect(defaultTokenCounter("hello world this is a test")).toBe(7) // 26/4 = 6.5, ceil = 7
  })

  it("handles long text", () => {
    const text = "a".repeat(1000)
    expect(defaultTokenCounter(text)).toBe(250) // 1000/4
  })
})

describe("countMessageTokens", () => {
  it("counts string content messages", () => {
    const messages = [
      { content: "Hello" },       // 5 chars → 2 tokens
      { content: "World" },       // 5 chars → 2 tokens
    ]
    expect(countMessageTokens(messages)).toBe(4)
  })

  it("counts array content messages via JSON.stringify", () => {
    const messages = [
      { content: [{ type: "text", text: "hi" }] },
    ]
    const result = countMessageTokens(messages)
    expect(result).toBeGreaterThan(0)
  })

  it("accepts custom counter", () => {
    const messages = [{ content: "hello" }]
    const customCounter = (text: string) => text.length // 1 token per char
    expect(countMessageTokens(messages, customCounter)).toBe(5)
  })

  it("handles empty messages", () => {
    expect(countMessageTokens([])).toBe(0)
  })
})
