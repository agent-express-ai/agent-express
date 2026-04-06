import type { Middleware, ModelContext } from "../../middleware.js"
import type { Message, ModelResponse } from "../../types.js"
import { defaultTokenCounter, countMessageTokens, type TokenCounter } from "../../token-count.js"
import type { LanguageModelV3 } from "@ai-sdk/provider"

/** Strategy for context compaction. Gentlest → most aggressive. */
export type CompactionStrategy =
  | "clear-tool-results"  // Replace old tool results with placeholder (lightest)
  | "truncate"            // Drop oldest messages (default)
  | "window"              // Keep last N messages
  | "summarize"           // LLM summarizes old messages
  | "hybrid"              // Summarize old + keep recent verbatim (best quality)

/** Summary marker prefix for summarized messages. */
export const SUMMARY_MARKER = "[CONVERSATION SUMMARY]"

/**
 * Configuration for the `memory.compaction()` middleware.
 */
export interface CompactionConfig {
  /** Maximum tokens for the context window. Default: 8192. */
  maxTokens?: number
  /** Compaction strategy. Default: "truncate". */
  strategy?: CompactionStrategy
  /** For "window": keep last N messages. */
  keepLast?: number
  /** For "clear-tool-results": keep last N tool results verbatim. Default: 3. */
  keepLastToolResults?: number
  /** For "summarize"/"hybrid": keep last N messages verbatim. */
  keepRecentMessages?: number
  /** For "summarize"/"hybrid": model for summaries. Default: agent's own model. */
  summaryModel?: string | LanguageModelV3
  /** Token counter function. Default: chars/4 heuristic. */
  tokenCounter?: TokenCounter
}

/**
 * Creates a `memory.compaction()` middleware that manages the context window.
 *
 * Automatically compacts messages before each LLM call when the token count
 * exceeds the configured limit. Only modifies `ModelContext.messages` —
 * `SessionContext.history` is never touched.
 *
 * Five strategies from gentlest to most aggressive:
 * - `clear-tool-results`: Replace old tool results with placeholder
 * - `truncate` (default): Drop oldest messages
 * - `window`: Keep last N messages
 * - `summarize`: LLM summarizes old messages
 * - `hybrid`: Summarize old + keep recent verbatim
 *
 * @param config - Working memory configuration
 * @returns Middleware that manages context window
 *
 * @example
 * ```typescript
 * // Simple truncation (default, zero cost)
 * agent.use(memory.compaction({ maxTokens: 8192 }))
 *
 * // Hybrid (best quality, one LLM call)
 * agent.use(memory.compaction({
 *   maxTokens: 8192,
 *   strategy: "hybrid",
 *   summaryModel: "anthropic/claude-haiku-4-5",
 *   keepRecentMessages: 10,
 * }))
 * ```
 */
export function memoryCompaction(config?: CompactionConfig): Middleware {
  const maxTokens = config?.maxTokens ?? 8192
  const strategy = config?.strategy ?? "truncate"
  const counter = config?.tokenCounter ?? defaultTokenCounter

  return {
    name: "memory:compaction",

    async model(ctx: ModelContext, next: () => Promise<ModelResponse>): Promise<ModelResponse> {
      const tokenCount = countMessageTokens(ctx.messages, counter)

      if (tokenCount <= maxTokens) {
        return next()
      }

      // Apply compaction strategy
      switch (strategy) {
        case "clear-tool-results":
          clearToolResults(ctx.messages, config?.keepLastToolResults ?? 3, counter)
          break

        case "truncate":
          truncateMessages(ctx.messages, maxTokens, counter)
          break

        case "window":
          windowMessages(ctx.messages, config?.keepLast ?? 20)
          break

        case "summarize":
        case "hybrid": {
          const keepRecent = config?.keepRecentMessages ?? (strategy === "hybrid" ? 10 : 5)
          try {
            await summarizeMessages(ctx.messages, keepRecent, config?.summaryModel, counter)
          } catch {
            // Fallback to truncation if summarization fails
            truncateMessages(ctx.messages, maxTokens, counter)
          }
          break
        }
      }

      return next()
    },
  }
}

/**
 * Truncation strategy: remove oldest non-system messages until within budget.
 * Always preserves: system messages, the most recent user message.
 * Never separates tool-call/result pairs.
 */
function truncateMessages(messages: Message[], maxTokens: number, counter: TokenCounter): void {
  while (countMessageTokens(messages, counter) > maxTokens && messages.length > 2) {
    // Find the first non-system, non-last message to remove
    const removeIndex = messages.findIndex((m, i) => {
      if (m.role === "system") return false
      if (i === messages.length - 1) return false // keep last
      return true
    })

    if (removeIndex === -1) break

    // Check if this is a tool-call/result pair — remove both
    const msg = messages[removeIndex]!
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const hasToolCalls = msg.content.some((p: any) => p.type === "tool-call")
      if (hasToolCalls && removeIndex + 1 < messages.length && messages[removeIndex + 1]!.role === "tool") {
        // Remove both assistant (tool-call) and tool (tool-result)
        messages.splice(removeIndex, 2)
        continue
      }
    }
    if (msg.role === "tool") {
      // Orphaned tool result — find preceding assistant with tool-call
      if (removeIndex > 0 && messages[removeIndex - 1]!.role === "assistant") {
        messages.splice(removeIndex - 1, 2)
        continue
      }
    }

    messages.splice(removeIndex, 1)
  }
}

/**
 * Window strategy: keep only the last N messages + system message.
 */
function windowMessages(messages: Message[], keepLast: number): void {
  const systemMessages = messages.filter((m) => m.role === "system")
  const nonSystem = messages.filter((m) => m.role !== "system")
  const kept = nonSystem.slice(-keepLast)

  messages.length = 0
  messages.push(...systemMessages, ...kept)
}

/**
 * Clear tool results strategy: replace old tool results with placeholder,
 * keeping the last N tool results verbatim.
 */
function clearToolResults(
  messages: Message[],
  keepLast: number,
  counter: TokenCounter,
): void {
  // Find all tool result messages
  const toolResultIndices: number[] = []
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]!.role === "tool") {
      toolResultIndices.push(i)
    }
  }

  // Keep the last N, clear the rest
  const toClear = toolResultIndices.slice(0, -keepLast)
  for (const idx of toClear) {
    const msg = messages[idx]!
    const originalTokens = typeof msg.content === "string"
      ? counter(msg.content)
      : counter(JSON.stringify(msg.content))
    messages[idx] = {
      role: "tool",
      content: `[cleared: ${originalTokens} tokens]`,
    }
  }
}

/** Structured summary prompt with 5 sections for high-quality compaction. */
const SUMMARY_PROMPT = `Summarize the following conversation, preserving key information in these sections:

1. **Task Overview**: What was originally requested
2. **Completed Work**: What has been done so far
3. **Current State**: Current status, any files/data/decisions made
4. **Key Learnings**: Important patterns, constraints, or facts discovered
5. **Next Steps**: What remains to be done

Be concise but preserve specific details (names, numbers, file paths, decisions).
The reader of this summary has NOT seen the original conversation.

Conversation to summarize:`

/**
 * Summarize strategy: partition messages into old + recent, call a summary model
 * to compress old messages into a structured summary, keep recent verbatim.
 *
 * Summary is marked with [CONVERSATION SUMMARY] prefix so the model knows
 * it's reading a compressed history.
 *
 * Falls back to truncation if the summary call fails.
 */
async function summarizeMessages(
  messages: Message[],
  keepRecent: number,
  summaryModel: string | LanguageModelV3 | undefined,
  _counter: TokenCounter,
): Promise<void> {
  const systemMessages = messages.filter((m) => m.role === "system")
  const nonSystem = messages.filter((m) => m.role !== "system")

  if (nonSystem.length <= keepRecent) return // Nothing to summarize

  const toSummarize = nonSystem.slice(0, -keepRecent)
  const toKeep = nonSystem.slice(-keepRecent)

  // Build summary input text
  const summaryInput = toSummarize
    .map((m) => {
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content)
      return `${m.role}: ${content}`
    })
    .join("\n")

  // Call summary model
  let summaryText: string
  if (summaryModel && typeof summaryModel !== "string") {
    // LanguageModelV3 object provided — call directly
    const result = await summaryModel.doGenerate({
      prompt: [
        { role: "system", content: SUMMARY_PROMPT },
        { role: "user", content: [{ type: "text", text: summaryInput }] },
      ],
    })
    summaryText = result.content
      .filter((c): c is { type: "text"; text: string } => (c as any).type === "text")
      .map((c) => c.text)
      .join("")
  } else if (typeof summaryModel === "string") {
    // String model IDs require resolveModel() — throw a clear error instead of silently failing
    throw new Error(
      `memory.compaction() summaryModel received a string "${summaryModel}". ` +
      `Pass a LanguageModelV3 object instead (e.g., from resolveModel() or a provider SDK).`,
    )
  } else {
    // No summary model provided — can't make summary call, fall back
    throw new Error("Summary model not available. Provide a summaryModel in CompactionConfig.")
  }

  // Rebuild messages: system + summary + recent
  messages.length = 0
  messages.push(...systemMessages)
  messages.push({
    role: "system",
    content: `${SUMMARY_MARKER}\n\n${summaryText}`,
  })
  messages.push(...toKeep)
}
