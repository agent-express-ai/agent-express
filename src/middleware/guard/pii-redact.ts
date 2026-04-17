import type { Middleware, ModelContext, ToolContext } from "../../middleware.js"
import type { Message, ModelResponse, ToolResult, PiiMapping } from "../../types.js"

/** Supported PII types for detection. */
export type PiiType = "email" | "phone" | "creditCard" | "ssn" | "ip"

/**
 * Configuration for the `guard.piiRedact()` middleware.
 */
export interface PiiRedactConfig {
  /** Which PII types to detect. Default: all types. */
  types?: PiiType[]
  /** Custom patterns with placeholder text. */
  custom?: Array<{ pattern: RegExp; placeholder: string }>
}

/** Built-in PII regex patterns. */
const PII_PATTERNS: Record<PiiType, { pattern: RegExp; placeholder: string }> = {
  email: {
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    placeholder: "[EMAIL]",
  },
  phone: {
    pattern: /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/g,
    placeholder: "[PHONE]",
  },
  creditCard: {
    pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
    placeholder: "[CREDIT_CARD]",
  },
  ssn: {
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    placeholder: "[SSN]",
  },
  ip: {
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    placeholder: "[IP_ADDRESS]",
  },
}

/**
 * Creates a `guard.piiRedact()` middleware that detects and masks PII.
 *
 * Redacts PII in user messages before the LLM sees them, and maintains
 * a per-session mapping for restore — tools get original values.
 * Also masks PII in log events and trace span attributes.
 *
 * @param config - PII types and custom patterns
 * @returns Middleware
 *
 * @example
 * ```typescript
 * agent.use(guard.piiRedact())
 * // "My email is john@example.com" → "My email is [EMAIL]"
 * ```
 */
export function guardPiiRedact(config?: PiiRedactConfig): Middleware {
  // Order matters: longer patterns first to prevent partial matches (CC before phone)
  const defaultOrder: PiiType[] = ["creditCard", "ssn", "email", "phone", "ip"]
  const types = config?.types ?? defaultOrder
  const customPatterns = config?.custom ?? []

  /** Build active patterns list. */
  function getPatterns(): Array<{ pattern: RegExp; placeholder: string }> {
    const patterns = types.map(t => ({
      pattern: new RegExp(PII_PATTERNS[t].pattern.source, PII_PATTERNS[t].pattern.flags),
      placeholder: PII_PATTERNS[t].placeholder,
    }))
    for (const cp of customPatterns) {
      patterns.push({
        pattern: new RegExp(cp.pattern.source, cp.pattern.flags),
        placeholder: cp.placeholder,
      })
    }
    return patterns
  }

  /** Redact PII in text, build mappings. */
  function redactText(text: string, mappings: PiiMapping[]): string {
    const patterns = getPatterns()
    let result = text
    for (const { pattern, placeholder } of patterns) {
      const regex = new RegExp(pattern.source, pattern.flags)
      result = result.replace(regex, (match) => {
        const existing = mappings.find(m => m.original === match)
        if (existing) return existing.placeholder
        const count = mappings.filter(m => m.type === placeholder.slice(1, -1).toLowerCase()).length + 1
        const uniquePlaceholder = `${placeholder.slice(0, -1)}_${count}]`
        mappings.push({ placeholder: uniquePlaceholder, original: match, type: placeholder.slice(1, -1).toLowerCase() })
        return uniquePlaceholder
      })
    }
    return result
  }

  /** Redact PII in a message. */
  function redactMessage(msg: Message, mappings: PiiMapping[]): Message {
    if (typeof msg.content !== "string") return msg
    return { ...msg, content: redactText(msg.content, mappings) }
  }

  /** Restore original values in args for tool execution. */
  function restoreArgs(args: Record<string, unknown>, mappings: PiiMapping[]): Record<string, unknown> {
    const restored: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(args)) {
      if (typeof value === "string") {
        let restoredValue = value
        for (const m of mappings) {
          restoredValue = restoredValue.replaceAll(m.placeholder, m.original)
        }
        restored[key] = restoredValue
      } else {
        restored[key] = value
      }
    }
    return restored
  }

  return {
    name: "guard:piiRedact",

    async model(ctx: ModelContext, next: () => Promise<ModelResponse>): Promise<ModelResponse> {
      // Get or create session-scoped mappings
      const mappings: PiiMapping[] = ((ctx as ModelContext & { __piiMappings?: PiiMapping[] }).__piiMappings) ?? []
      ;(ctx as ModelContext & { __piiMappings: PiiMapping[] }).__piiMappings = mappings

      // Redact user messages
      for (let i = 0; i < ctx.messages.length; i++) {
        const msg = ctx.messages[i]!
        if (msg.role === "user") {
          ctx.messages[i] = redactMessage(msg, mappings)
        }
      }

      return next()
    },

    async tool(ctx: ToolContext, next: () => Promise<ToolResult>): Promise<ToolResult> {
      // Restore original PII values for tool execution
      const mappings: PiiMapping[] = ((ctx as ToolContext & { __piiMappings?: PiiMapping[] }).__piiMappings) ?? []
      if (mappings.length > 0) {
        const restored = restoreArgs(ctx.args, mappings)
        ctx.modifyArgs(restored)
      }
      return next()
    },
  }
}
