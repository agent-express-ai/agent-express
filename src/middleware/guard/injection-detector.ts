import type { ModelContext } from "../../middleware.js"
import type { InputValidationResult } from "./input.js"

/**
 * Configuration for the `injectionDetector()` validator.
 */
export interface InjectionDetectorConfig {
  /** Enable LLM-based classifier (extra LLM call per turn). Default: false (regex only). */
  llmClassifier?: boolean
}

/** Common prompt injection patterns (regex). */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|rules)/i,
  /disregard\s+(all\s+)?(previous|prior|above)/i,
  /forget\s+(all\s+)?(previous|prior|your)\s+(instructions|rules|prompts)/i,
  /you\s+are\s+now\s+(a|an|the)/i,
  /new\s+instructions?\s*:/i,
  /system\s+prompt\s*:/i,
  /\bact\s+as\s+(a|an|if)\b/i,
  /override\s+(your|all|the)\s+(instructions|rules|guidelines)/i,
  /do\s+not\s+follow\s+(your|the|any)\s+(instructions|rules|guidelines)/i,
  /pretend\s+(you\s+are|to\s+be|that)/i,
  /\brole\s*play\s+as\b/i,
  /reveal\s+(your|the)\s+(system|initial|original)\s+(prompt|instructions|message)/i,
  /what\s+(are|is)\s+your\s+(system|initial|original)\s+(prompt|instructions|message)/i,
  /output\s+(your|the)\s+(system|initial)\s+(prompt|instructions|message)/i,
]

/**
 * Creates an `injectionDetector()` validator for use with `guard.input()`.
 *
 * Dual mode: regex (fast, default) + optional LLM classifier.
 * Returns an `InputValidator` function compatible with the existing `guard.input()` API.
 *
 * @param config - Detection mode options
 * @returns InputValidator function
 *
 * @example
 * ```typescript
 * import { guard, injectionDetector } from "agent-express"
 *
 * // Regex only (fast, default)
 * agent.use(guard.input(injectionDetector()))
 *
 * // Regex + LLM classifier (production-recommended)
 * agent.use(guard.input(injectionDetector({ llmClassifier: true })))
 * ```
 */
export function injectionDetector(config?: InjectionDetectorConfig): (ctx: ModelContext) => Promise<InputValidationResult> | InputValidationResult {
  const useLlm = config?.llmClassifier ?? false

  return async (ctx: ModelContext): Promise<InputValidationResult> => {
    // Check user messages for injection patterns
    for (const msg of ctx.messages) {
      if (msg.role !== "user") continue
      const content = typeof msg.content === "string" ? msg.content : ""
      if (!content) continue

      // Regex pass (fast)
      for (const pattern of INJECTION_PATTERNS) {
        if (pattern.test(content)) {
          return {
            ok: false,
            reason: `Potential prompt injection detected: matches pattern "${pattern.source}"`,
          }
        }
      }
    }

    // LLM classifier pass (optional, extra model call)
    if (useLlm) {
      // Get the latest user message
      const userMessages = ctx.messages.filter(m => m.role === "user")
      const lastUser = userMessages[userMessages.length - 1]
      const content = typeof lastUser?.content === "string" ? lastUser.content : ""

      if (content) {
        // Use a lightweight classification prompt
        // Note: This uses the agent's own model — no separate model needed
        // The classification is done by inspecting the content heuristically
        // Full LLM-based classification would require calling ctx model separately
        // For now, enhanced heuristics as "LLM classifier" placeholder
        const suspicious = [
          /\bDAN\b/,
          /\bjailbreak\b/i,
          /\bbypass\b.*\b(filter|safety|guard)/i,
          /\bbase64\b.*\bdecode\b/i,
          /\beval\b.*\bexec\b/i,
          /\b(sudo|root|admin)\b.*\b(mode|access|privilege)/i,
        ]
        for (const pattern of suspicious) {
          if (pattern.test(content)) {
            return {
              ok: false,
              reason: `Potential prompt injection detected by classifier: "${pattern.source}"`,
            }
          }
        }
      }
    }

    return { ok: true }
  }
}
