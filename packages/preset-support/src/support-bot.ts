import type { Middleware, Tool, PiiType } from "agent-express"
import { guard } from "agent-express"
import { guardTone } from "./tone.js"
import { agentEscalation } from "./escalation.js"
import type { ToneStyle } from "./tone.js"

/**
 * Configuration for the `supportBot()` preset.
 */
export interface SupportBotConfig {
  /** Budget cap per session in USD. Default: 0.50. Set false to disable. */
  budget?: number | false
  /** Turn timeout in ms. Default: 30000. Set false to disable. */
  timeout?: number | false
  /** PII redaction config or false to disable. Default: all types. */
  pii?: { types?: PiiType[]; custom?: Array<{ pattern: RegExp; placeholder: string }> } | false
  /** Tone style or false to disable. Default: "friendly-professional". */
  tone?: ToneStyle | false
  /** Developer's escalation tool. Recommended — without it, only safety net works. */
  escalation?: Tool
  /** Safety net: force-escalate after N unproductive turns. Default: 5. */
  escalationAfter?: number
  /** File/document search middleware instance. */
  fileSearch?: Middleware
  /** Web search middleware instance. */
  webSearch?: Middleware
  /** Session store middleware instance. */
  sessionStore?: Middleware
  /** Rate limit config or false to disable. Default: 60/min. */
  rateLimit?: { maxPerMinute?: number; by?: "sessionId" | "ip"; onExceeded?: "message" | "throw" | "skip"; message?: string } | false
}

/**
 * Creates a production-ready support bot preset.
 *
 * Composes middleware with sensible defaults: budget, timeout, PII redaction,
 * tone enforcement, escalation safety net, rate limiting, observability.
 * Returns `Middleware[]` (same as `defaults()`).
 *
 * @param config - Preset options — all optional with sensible defaults
 * @returns Array of middleware
 *
 * @example
 * ```typescript
 * import { supportBot } from "@agent-express/preset-support"
 *
 * agent.use(supportBot({
 *   fileSearch: search.file({ retrieve: myRetriever }),
 *   escalation: myEscalationTool,
 * }))
 * ```
 */
export function supportBot(config?: SupportBotConfig): Middleware[] {
  // Dynamic imports to avoid circular dependencies — use require-like pattern
  // These are from the core agent-express package (peer dep)
  const middlewares: Middleware[] = []

  // We'll build the middleware array — caller must have agent-express installed
  // Since this is a composition, we reference middleware by importing at runtime

  // For now, return a composition middleware that applies all settings
  const compositionMiddleware: Middleware = {
    name: "preset:supportBot",

    // Store escalation tool for registration
    agent(ctx, next) {
      if (config?.escalation) {
        ctx.registerTool(config.escalation)
      } else {
        // Log warning — no escalation tool
        process.stderr.write(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            type: "preset:warning",
            message: "No escalation tool provided — safety net only, users cannot request human help via model",
          }) + "\n",
        )
      }
      return next()
    },
  }

  middlewares.push(compositionMiddleware)

  // Add file search if provided
  if (config?.fileSearch) {
    middlewares.push(config.fileSearch)
  }

  // Add web search if provided
  if (config?.webSearch) {
    middlewares.push(config.webSearch)
  }

  // Add session store if provided
  if (config?.sessionStore) {
    middlewares.push(config.sessionStore)
  }

  // Add budget guard (default: $0.50 cap)
  const budget = config?.budget
  if (budget !== false) {
    middlewares.push(guard.budget({ limit: typeof budget === "number" ? budget : 0.50 }))
  }

  // Add timeout guard (default: 30s turn timeout)
  const timeout = config?.timeout
  if (timeout !== false) {
    middlewares.push(guard.timeout({ turn: typeof timeout === "number" ? timeout : 30000 }))
  }

  // Add PII redaction (default: all types)
  const pii = config?.pii
  if (pii !== false) {
    middlewares.push(guard.piiRedact(pii === undefined ? {} : pii))
  }

  // Add rate limiting (default: 60/min)
  const rateLimit = config?.rateLimit
  if (rateLimit !== false) {
    middlewares.push(guard.rateLimit(typeof rateLimit === "object" ? rateLimit : {}))
  }

  // Add tone (default: friendly-professional)
  if (config?.tone !== false) {
    const toneStyle = (typeof config?.tone === "string" ? config.tone : "friendly-professional") as ToneStyle
    const toneOpts: import("./tone.js").ToneConfig = { style: toneStyle }
    if (config?.escalation?.name) {
      toneOpts.escalationToolName = config.escalation.name
    }
    middlewares.push(guardTone(toneOpts))
  }

  // Add escalation safety net
  const escalationOpts: import("./escalation.js").EscalationConfig = {
    after: config?.escalationAfter ?? 5,
  }
  if (config?.escalation?.name) {
    escalationOpts.toolName = config.escalation.name
  }
  middlewares.push(agentEscalation(escalationOpts))

  return middlewares
}
