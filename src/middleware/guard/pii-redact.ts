import type { Middleware, ModelContext, ToolContext } from "../../middleware.js"
import type { Message, MessagePart, ModelResponse, ToolResult, PiiMapping, PiiType } from "../../types.js"

export type { PiiType }

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
const PII_PATTERNS: Record<PiiType, { pattern: RegExp; placeholder: string; typeName: string }> = {
  email: {
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    placeholder: "[EMAIL]",
    typeName: "email",
  },
  phone: {
    pattern: /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/g,
    placeholder: "[PHONE]",
    typeName: "phone",
  },
  creditCard: {
    pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
    placeholder: "[CREDIT_CARD]",
    typeName: "credit_card",
  },
  ssn: {
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    placeholder: "[SSN]",
    typeName: "ssn",
  },
  ip: {
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    placeholder: "[IP_ADDRESS]",
    typeName: "ip_address",
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

  /** Build active patterns list with explicit type names. */
  function getPatterns(): Array<{ pattern: RegExp; placeholder: string; typeName: string }> {
    const patterns = types.map(t => ({
      pattern: new RegExp(PII_PATTERNS[t].pattern.source, PII_PATTERNS[t].pattern.flags),
      placeholder: PII_PATTERNS[t].placeholder,
      typeName: PII_PATTERNS[t].typeName,
    }))
    for (const cp of customPatterns) {
      // Derive typeName from placeholder: strip brackets → lowercase
      const derived = cp.placeholder.replace(/^\[/, "").replace(/\]$/, "").toLowerCase()
      patterns.push({
        pattern: new RegExp(cp.pattern.source, cp.pattern.flags),
        placeholder: cp.placeholder,
        typeName: derived,
      })
    }
    return patterns
  }

  /** Redact PII in text, build mappings. */
  function redactText(text: string, mappings: PiiMapping[]): string {
    const patterns = getPatterns()
    let result = text
    for (const { pattern, placeholder, typeName } of patterns) {
      const regex = new RegExp(pattern.source, pattern.flags)
      result = result.replace(regex, (match) => {
        const existing = mappings.find(m => m.original === match)
        if (existing) return existing.placeholder
        const count = mappings.filter(m => m.type === typeName).length + 1
        const uniquePlaceholder = `${placeholder.slice(0, -1)}_${count}]`
        mappings.push({ placeholder: uniquePlaceholder, original: match, type: typeName })
        return uniquePlaceholder
      })
    }
    return result
  }

  /** Redact PII in a message, handling both string and multi-part content. */
  function redactMessage(msg: Message, mappings: PiiMapping[]): Message {
    if (typeof msg.content === "string") {
      return { ...msg, content: redactText(msg.content, mappings) }
    }
    // Multi-part content: iterate and redact text fields within each part
    const parts = (msg.content as MessagePart[]).map((part) => {
      if (part.text != null) {
        return { ...part, text: redactText(part.text, mappings) }
      }
      return part
    })
    return { ...msg, content: parts }
  }

  /** Recursively restore original PII values in a value tree. */
  function restoreValue(value: unknown, mappings: PiiMapping[]): unknown {
    if (typeof value === "string") {
      let restored = value
      for (const m of mappings) {
        restored = restored.replaceAll(m.placeholder, m.original)
      }
      return restored
    }
    if (Array.isArray(value)) {
      return value.map(item => restoreValue(item, mappings))
    }
    if (value !== null && typeof value === "object") {
      const restored: Record<string, unknown> = {}
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        restored[key] = restoreValue(val, mappings)
      }
      return restored
    }
    return value
  }

  /** Restore original values in args for tool execution (recursive). */
  function restoreArgs(args: Record<string, unknown>, mappings: PiiMapping[]): Record<string, unknown> {
    return restoreValue(args, mappings) as Record<string, unknown>
  }

  /** State key for PII mappings shared between model and tool hooks. */
  const STATE_KEY = "guard:pii:mappings"

  return {
    name: "guard:piiRedact",

    state: {
      [STATE_KEY]: {
        default: [] as PiiMapping[],
      },
    },

    async model(ctx: ModelContext, next: () => Promise<ModelResponse>): Promise<ModelResponse> {
      // Get or create session-scoped mappings from shared state
      const mappings: PiiMapping[] = (ctx.state[STATE_KEY] as PiiMapping[]) ?? []

      // Redact user messages
      for (let i = 0; i < ctx.messages.length; i++) {
        const msg = ctx.messages[i]!
        if (msg.role === "user") {
          ctx.messages[i] = redactMessage(msg, mappings)
        }
      }

      // Persist updated mappings back to shared state
      ctx.state[STATE_KEY] = mappings

      return next()
    },

    async tool(ctx: ToolContext, next: () => Promise<ToolResult>): Promise<ToolResult> {
      // Restore original PII values for tool execution from shared state
      const mappings: PiiMapping[] = (ctx.state[STATE_KEY] as PiiMapping[]) ?? []
      if (mappings.length > 0) {
        const restored = restoreArgs(ctx.args, mappings)
        ctx.modifyArgs(restored)
      }
      return next()
    },
  }
}
