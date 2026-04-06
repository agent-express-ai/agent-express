import { describe, it, expect } from "vitest"
import { toAiSdkMessages, toAiSdkTools, fromAiSdkResult } from "../../src/providers/adapter.js"
import type { Message } from "../../src/types.js"
import type { LanguageModelV3GenerateResult } from "@ai-sdk/provider"

describe("toAiSdkMessages", () => {
  it("converts system message", () => {
    const msgs: Message[] = [{ role: "system", content: "You are helpful." }]
    const result = toAiSdkMessages(msgs)
    expect(result).toEqual([{ role: "system", content: "You are helpful." }])
  })

  it("converts user text message", () => {
    const msgs: Message[] = [{ role: "user", content: "Hello" }]
    const result = toAiSdkMessages(msgs)
    expect(result).toEqual([{ role: "user", content: [{ type: "text", text: "Hello" }] }])
  })

  it("converts assistant text message", () => {
    const msgs: Message[] = [{ role: "assistant", content: "Hi there!" }]
    const result = toAiSdkMessages(msgs)
    expect(result).toEqual([
      { role: "assistant", content: [{ type: "text", text: "Hi there!" }] },
    ])
  })

  it("converts assistant tool call message", () => {
    const msgs: Message[] = [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "tc1", toolName: "search", args: { q: "test" } },
        ],
      },
    ]
    const result = toAiSdkMessages(msgs)
    expect(result[0]!.role).toBe("assistant")
    const content = (result[0] as any).content
    expect(content[0].type).toBe("tool-call")
    expect(content[0].toolCallId).toBe("tc1")
    expect(content[0].input).toEqual({ q: "test" })
  })

  it("converts tool result message", () => {
    const msgs: Message[] = [
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "tc1", toolName: "search", result: "found it" }],
      },
    ]
    const result = toAiSdkMessages(msgs)
    expect(result[0]!.role).toBe("tool")
    const content = (result[0] as any).content
    expect(content[0].type).toBe("tool-result")
    expect(content[0].toolCallId).toBe("tc1")
    expect(content[0].output.type).toBe("text")
    expect(content[0].output.value).toBe("found it")
  })
})

describe("toAiSdkTools", () => {
  it("returns undefined for empty array", () => {
    expect(toAiSdkTools([])).toBeUndefined()
  })

  it("converts tool definitions", () => {
    const tools = toAiSdkTools([
      { name: "add", description: "Add numbers", jsonSchema: { type: "object" } },
    ])
    expect(tools).toEqual([
      { type: "function", name: "add", description: "Add numbers", inputSchema: { type: "object" } },
    ])
  })
})

describe("fromAiSdkResult", () => {
  it("extracts text from content array", () => {
    const result: LanguageModelV3GenerateResult = {
      content: [{ type: "text", text: "Hello world" }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 5, text: 5, reasoning: 0 },
      },
      warnings: [],
    }
    const response = fromAiSdkResult(result)
    expect(response.text).toBe("Hello world")
    expect(response.toolCalls).toBeUndefined()
    expect(response.usage).toEqual({ inputTokens: 10, outputTokens: 5 })
    expect(response.finishReason).toBe("stop")
  })

  it("extracts tool calls from content array", () => {
    const result: LanguageModelV3GenerateResult = {
      content: [
        { type: "tool-call", toolCallId: "tc1", toolName: "add", input: { a: 1, b: 2 } },
      ],
      finishReason: { unified: "tool-calls", raw: "tool_use" },
      usage: {
        inputTokens: { total: 20, noCache: 20, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 10, text: 0, reasoning: 0 },
      },
      warnings: [],
    }
    const response = fromAiSdkResult(result)
    expect(response.text).toBeUndefined()
    expect(response.toolCalls).toHaveLength(1)
    expect(response.toolCalls![0]!.toolName).toBe("add")
    expect(response.toolCalls![0]!.args).toEqual({ a: 1, b: 2 })
  })

  it("handles null token counts gracefully", () => {
    const result: LanguageModelV3GenerateResult = {
      content: [{ type: "text", text: "ok" }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: undefined as any, noCache: undefined as any, cacheRead: undefined as any, cacheWrite: undefined as any },
        outputTokens: { total: undefined as any, text: undefined as any, reasoning: undefined as any },
      },
      warnings: [],
    }
    const response = fromAiSdkResult(result)
    expect(response.usage).toEqual({ inputTokens: 0, outputTokens: 0 })
  })
})
