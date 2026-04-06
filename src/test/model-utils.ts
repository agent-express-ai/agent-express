import type { LanguageModelV3GenerateResult } from "@ai-sdk/provider"
import type { ModelResponse } from "../types.js"

/**
 * Converts an Agent Express `ModelResponse` to an AI SDK V3 `LanguageModelV3GenerateResult`.
 *
 * Shared utility used by TestModel, FunctionModel, and RecordModel/ReplayModel
 * to produce AI SDK V3 compatible results from internal response format.
 *
 * @param response - Agent Express ModelResponse
 * @returns AI SDK V3 generate result
 */
export function toGenerateResult(response: ModelResponse): LanguageModelV3GenerateResult {
  const content: LanguageModelV3GenerateResult["content"] = []

  if (response.text) {
    content.push({ type: "text", text: response.text })
  }
  if (response.toolCalls) {
    for (const tc of response.toolCalls) {
      content.push({
        type: "tool-call",
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        input: JSON.stringify(tc.args),
      })
    }
  }
  if (content.length === 0) {
    content.push({ type: "text", text: "" })
  }

  return {
    content,
    finishReason: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      unified: (response.finishReason ?? "stop") as any,
      raw: response.finishReason ?? "stop",
    },
    usage: {
      inputTokens: {
        total: response.usage?.inputTokens ?? 0,
        noCache: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
      outputTokens: {
        total: response.usage?.outputTokens ?? 0,
        text: 0,
        reasoning: 0,
      },
    },
    warnings: [],
  }
}
