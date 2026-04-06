import type { LanguageModelV3, LanguageModelV3GenerateResult, LanguageModelV3CallOptions } from "@ai-sdk/provider"
import type { Message, ModelResponse } from "../types.js"
import { toGenerateResult } from "./model-utils.js"

/** Tool definition passed to FunctionModel handler. */
export interface FunctionModelToolDef {
  name: string
  description?: string
  parameters: unknown
}

/**
 * Handler function for FunctionModel.
 * Receives conversation context and returns a model response.
 */
export type FunctionModelHandler = (
  messages: Message[],
  info: { tools: FunctionModelToolDef[]; callIndex: number },
) => ModelResponse | Promise<ModelResponse>

/**
 * Callback-based mock model for complex test scenarios. Implements LanguageModelV3.
 *
 * Delegates every model call to a user-supplied function that receives the full
 * message context and can return any response — text, tool calls, or errors.
 *
 * @example
 * ```typescript
 * const model = new FunctionModel((messages, { callIndex }) => {
 *   if (callIndex === 0) return { toolCalls: [...], usage: ..., finishReason: "tool-calls" }
 *   return { text: "Done!", usage: ..., finishReason: "stop" }
 * })
 * ```
 */
export class FunctionModel implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const
  readonly provider = "function"
  readonly modelId = "function-model"
  readonly supportedUrls = {}

  private readonly handler: FunctionModelHandler
  private callIndex = 0

  constructor(handler: FunctionModelHandler) {
    this.handler = handler
  }

  async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
    const idx = this.callIndex++

    // Convert AI SDK prompt to our Message format
    const messages = this.promptToMessages(options.prompt)
    const tools: FunctionModelToolDef[] = (options.tools ?? [])
      .filter((t) => t.type === "function")
      .map((t) => ({ name: (t as any).name, description: (t as any).description, parameters: (t as any).inputSchema ?? (t as any).parameters }))

    const response = await this.handler(messages, { tools, callIndex: idx })
    return toGenerateResult(response)
  }

  async doStream(): Promise<never> {
    throw new Error("FunctionModel does not support streaming. Use doGenerate().")
  }

  /** Reset call index for reuse across tests. */
  reset(): void {
    this.callIndex = 0
  }

  private promptToMessages(prompt: LanguageModelV3CallOptions["prompt"]): Message[] {
    return prompt.map((msg): Message => {
      if (msg.role === "system") {
        const parts = Array.isArray(msg.content) ? msg.content : [msg.content]
        const text = parts.filter((p: any) => typeof p === "string" || p.type === "text").map((p: any) => typeof p === "string" ? p : p.text).join("")
        return { role: "system", content: text }
      }
      if (msg.role === "user") {
        const text = (msg.content as any[]).filter((p: any) => p.type === "text").map((p: any) => p.text).join("")
        return { role: "user", content: text }
      }
      if (msg.role === "assistant") {
        const content = msg.content as any[]
        const textParts = content.filter((p: any) => p.type === "text")
        if (textParts.length > 0) {
          return { role: "assistant", content: textParts.map((p: any) => p.text).join("") }
        }
        const toolCalls = content.filter((p: any) => p.type === "tool-call")
        return { role: "assistant", content: toolCalls.map((p: any) => ({ type: "tool-call" as const, toolCallId: p.toolCallId, toolName: p.toolName, args: typeof p.input === "string" ? JSON.parse(p.input) : p.input })) }
      }
      if (msg.role === "tool") {
        const content = msg.content as any[]
        const results = content.map((p: any) => ({ type: "tool-result" as const, toolCallId: p.toolCallId, result: p.result ?? p.content }))
        return { role: "tool", content: results }
      }
      return { role: "user", content: "" }
    })
  }

}
