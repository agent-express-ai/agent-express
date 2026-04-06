import type { LanguageModelV3, LanguageModelV3GenerateResult, LanguageModelV3CallOptions } from "@ai-sdk/provider"
import type { ModelResponse } from "../types.js"
import { toGenerateResult } from "./model-utils.js"

/**
 * Options for TestModel.
 */
export interface TestModelOptions {
  /** Ordered list of responses. Each model call gets the next response. */
  responses?: ModelResponse[]
  /** Default text when no responses configured or after responses exhausted (with auto-tool). Default: "test response". */
  defaultText?: string
}

/**
 * Deterministic mock model for testing. Implements LanguageModelV3.
 *
 * Three modes:
 * 1. **No config**: Auto-calls all available tools on first call, returns defaultText on second.
 * 2. **responses[]**: Returns pre-configured responses in order. Throws when exhausted.
 * 3. **defaultText**: Always returns the specified text (no tool calls).
 *
 * Zero cost, zero latency, no network calls.
 *
 * @example
 * ```typescript
 * const agent = new Agent({
 *   name: "test",
 *   model: new TestModel({ defaultText: "Hello!" }),
 *   instructions: "test",
 *   defaults: false,
 * })
 * const { text } = await agent.run("Hi").result  // "Hello!"
 * ```
 */
export class TestModel implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const
  readonly provider = "test"
  readonly modelId = "test-model"
  readonly supportedUrls = {}

  private readonly responses: ModelResponse[] | undefined
  private readonly defaultText: string
  private callIndex = 0

  constructor(opts?: TestModelOptions) {
    this.responses = opts?.responses ? [...opts.responses] : undefined
    this.defaultText = opts?.defaultText ?? "test response"
  }

  async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
    const idx = this.callIndex++

    // Mode 1: Pre-configured responses
    if (this.responses) {
      if (idx >= this.responses.length) {
        throw new Error(
          `TestModel exhausted: expected ${this.responses.length} calls, got ${idx + 1}. ` +
          `Configure more responses or use FunctionModel for dynamic behavior.`,
        )
      }
      return toGenerateResult(this.responses[idx]!)
    }

    // Mode 2: Auto-tool-calling (no responses configured)
    // First call: call all available tools
    const tools = options.tools
    if (idx === 0 && tools && tools.length > 0) {
      const toolCalls = tools
        .filter((t) => t.type === "function")
        .map((t, i) => ({
          type: "tool-call" as const,
          toolCallId: `test-tc-${i}`,
          toolName: (t as any).name,
          input: JSON.stringify(this.generateToolArgs((t as any).inputSchema ?? (t as any).parameters)),
        }))

      if (toolCalls.length > 0) {
        return {
          content: toolCalls,
          finishReason: { unified: "tool-calls", raw: "tool_use" },
          usage: {
            inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 0, text: 0, reasoning: 0 },
          },
          warnings: [],
        }
      }
    }

    // Subsequent calls or no tools: return default text
    return {
      content: [{ type: "text", text: this.defaultText }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 0, text: 0, reasoning: 0 },
      },
      warnings: [],
    }
  }

  async doStream(): Promise<never> {
    throw new Error("TestModel does not support streaming. Use doGenerate().")
  }

  /** Reset call index for reuse across tests. */
  reset(): void {
    this.callIndex = 0
  }

  private generateToolArgs(parameters: unknown): Record<string, unknown> {
    // Generate minimal valid args from JSON schema
    const schema = parameters as { type?: string; properties?: Record<string, { type?: string }> }
    if (!schema?.properties) return {}

    const args: Record<string, unknown> = {}
    for (const [key, prop] of Object.entries(schema.properties)) {
      switch (prop.type) {
        case "string": args[key] = "test"; break
        case "number": args[key] = 0; break
        case "boolean": args[key] = true; break
        default: args[key] = "test"
      }
    }
    return args
  }
}
