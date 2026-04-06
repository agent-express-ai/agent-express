/**
 * Pluggable token counting interface.
 *
 * Used by `memory.compaction()` and `model.router()` to estimate token counts.
 * The default implementation uses a `chars / 4` heuristic (~85% accuracy).
 * Users can plug in `tokenx` (~95%) or `js-tiktoken` (100%) for better accuracy.
 *
 * @example
 * ```typescript
 * // Default (built-in, zero deps):
 * memory.compaction({ maxTokens: 8192 })
 *
 * // Better estimation (user installs tokenx):
 * import { estimateTokenCount } from "tokenx"
 * memory.compaction({ maxTokens: 8192, tokenCounter: (text) => estimateTokenCount(text) })
 *
 * // Exact counting (user installs js-tiktoken):
 * import { encodingForModel } from "js-tiktoken"
 * const enc = encodingForModel("gpt-4o")
 * memory.compaction({ maxTokens: 8192, tokenCounter: (text) => enc.encode(text).length })
 * ```
 */
export type TokenCounter = (text: string) => number

/**
 * Default token counter: `chars / 4` heuristic.
 *
 * ~85% accurate for English text. The 80% default context limit in
 * `memory.compaction()` provides a safety margin for this inaccuracy.
 *
 * @param text - Text to estimate token count for
 * @returns Estimated token count
 */
export const defaultTokenCounter: TokenCounter = (text: string): number => {
  return Math.ceil(text.length / 4)
}

/**
 * Estimates total token count for an array of messages.
 *
 * @param messages - Messages to count
 * @param counter - Token counter function (default: chars/4)
 * @returns Total estimated tokens
 */
export function countMessageTokens(
  messages: Array<{ content: string | unknown[] }>,
  counter: TokenCounter = defaultTokenCounter,
): number {
  let total = 0
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      total += counter(msg.content)
    } else if (Array.isArray(msg.content)) {
      total += counter(JSON.stringify(msg.content))
    }
  }
  return total
}
