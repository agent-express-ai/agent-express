import { describe, it, expect, vi } from "vitest"
import { Agent } from "../../src/agent.js"
import { toolsFunction } from "../../src/tools/function.js"
import { z } from "zod"
import type { LanguageModelV3, LanguageModelV3GenerateResult } from "@ai-sdk/provider"

/** Creates a mock model that returns tool calls on first call, text on second. */
function createToolCallingModel(
  toolCalls: Array<{ toolCallId: string; toolName: string; input: Record<string, unknown> }>,
  finalText: string,
): LanguageModelV3 {
  let callCount = 0
  return {
    specificationVersion: "v3",
    provider: "mock",
    modelId: "mock-tool-model",
    supportedUrls: {},
    doGenerate: vi.fn(async (): Promise<LanguageModelV3GenerateResult> => {
      callCount++
      if (callCount === 1) {
        // First call: return tool calls
        return {
          content: toolCalls.map((tc) => ({
            type: "tool-call" as const,
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            input: tc.input,
          })),
          finishReason: { unified: "tool-calls" as const, raw: "tool_use" },
          usage: {
            inputTokens: { total: 20, noCache: 20, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 10, text: 0, reasoning: 0 },
          },
          warnings: [],
        }
      }
      // Second call: return text
      return {
        content: [{ type: "text" as const, text: finalText }],
        finishReason: { unified: "stop" as const, raw: "end_turn" },
        usage: {
          inputTokens: { total: 30, noCache: 30, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 15, text: 15, reasoning: 0 },
        },
        warnings: [],
      }
    }),
    doStream: vi.fn(async () => {
      throw new Error("not implemented")
    }),
  }
}

describe("Agent with tools", () => {
  it("completes model → tool → model cycle", async () => {
    const model = createToolCallingModel(
      [{ toolCallId: "tc1", toolName: "add", input: { a: 2, b: 3 } }],
      "The sum is 5.",
    )

    const agent = new Agent({ name: "calc", model, instructions: "Use tools.", defaults: false })
    agent.use(
      toolsFunction({
        name: "add",
        description: "Add two numbers",
        schema: z.object({ a: z.number(), b: z.number() }),
        execute: async ({ a, b }) => (a as number) + (b as number),
      }),
    )

    const result = await agent.run("What is 2+3?").result

    expect(result.text).toBe("The sum is 5.")
  })

  it("executes parallel tool calls", async () => {
    const model = createToolCallingModel(
      [
        { toolCallId: "tc1", toolName: "add", input: { a: 1, b: 2 } },
        { toolCallId: "tc2", toolName: "add", input: { a: 3, b: 4 } },
      ],
      "Results: 3 and 7.",
    )

    const executionOrder: string[] = []
    const agent = new Agent({ name: "calc", model, instructions: "Use tools.", defaults: false })
    agent.use(
      toolsFunction({
        name: "add",
        description: "Add",
        schema: z.object({ a: z.number(), b: z.number() }),
        execute: async ({ a, b }) => {
          executionOrder.push(`add(${a},${b})`)
          return (a as number) + (b as number)
        },
      }),
    )

    const result = await agent.run("test").result

    expect(result.text).toBe("Results: 3 and 7.")
    // Both executed (order may vary due to Promise.all)
    expect(executionOrder).toHaveLength(2)
  })

  it("handles tool execution error gracefully", async () => {
    const model = createToolCallingModel(
      [{ toolCallId: "tc1", toolName: "fail_tool", input: {} }],
      "I couldn't use the tool.",
    )

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(
      toolsFunction({
        name: "fail_tool",
        description: "Always fails",
        schema: z.object({}),
        execute: async () => {
          throw new Error("tool broke")
        },
      }),
    )

    const result = await agent.run("test").result

    expect(result.text).toBe("I couldn't use the tool.")
  })

  it("records tool calls in streaming events", async () => {
    const model = createToolCallingModel(
      [{ toolCallId: "tc1", toolName: "greet", input: { name: "Alice" } }],
      "Done!",
    )

    const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
    agent.use(
      toolsFunction({
        name: "greet",
        description: "Greet someone",
        schema: z.object({ name: z.string() }),
        execute: async ({ name }) => `Hello ${name}!`,
      }),
    )

    const events: import("../../src/types.js").Event[] = []
    for await (const event of agent.run("test")) {
      events.push(event)
    }

    const types = events.map((e) => e.type)
    expect(types).toContain("tool:call")
    expect(types).toContain("tool:result")

    const toolCall = events.find((e) => e.type === "tool:call")
    expect(toolCall).toBeDefined()
    const payload = toolCall!.payload as { tool: string; args: Record<string, unknown> }
    expect(payload.tool).toBe("greet")
    expect(payload.args).toEqual({ name: "Alice" })
  })
})
