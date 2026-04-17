import type { Middleware, TurnContext } from "../../middleware.js"

/**
 * Configuration for the `guard.rateLimit()` middleware.
 */
export interface RateLimitConfig {
  /** Maximum requests per minute. Default: 60. */
  maxPerMinute?: number
  /** Rate limit key. Default: "sessionId". */
  by?: "sessionId" | "ip"
  /** Behavior when limit exceeded. Default: "message". */
  onExceeded?: "message" | "throw" | "skip"
  /** Custom message when onExceeded is "message". */
  message?: string
}

/** Thrown when onExceeded is "throw". */
export class RateLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RateLimitError"
  }
}

/**
 * Creates a `guard.rateLimit()` middleware that limits request rate per session or IP.
 *
 * Uses sliding window algorithm. In-memory by default.
 *
 * @param config - Rate limit options
 * @returns Middleware
 */
export function guardRateLimit(config?: RateLimitConfig): Middleware {
  const maxPerMinute = config?.maxPerMinute ?? 60
  const by = config?.by ?? "sessionId"
  const onExceeded = config?.onExceeded ?? "message"
  const rateLimitMessage = config?.message ?? "Please wait a moment before sending another message."

  // In-memory sliding window: key → array of timestamps
  const windows = new Map<string, number[]>()

  function getKey(ctx: TurnContext): string {
    if (by === "ip") {
      return (ctx.state["__clientIp"] as string) ?? ctx.sessionId
    }
    return ctx.sessionId
  }

  function isExceeded(key: string): boolean {
    const now = Date.now()
    const windowMs = 60_000
    let timestamps = windows.get(key)
    if (!timestamps) {
      timestamps = []
      windows.set(key, timestamps)
    }
    // Remove timestamps outside window
    const cutoff = now - windowMs
    while (timestamps.length > 0 && timestamps[0]! < cutoff) {
      timestamps.shift()
    }
    if (timestamps.length >= maxPerMinute) {
      return true
    }
    timestamps.push(now)
    return false
  }

  return {
    name: "guard:rateLimit",

    async turn(ctx: TurnContext, next: () => Promise<void>): Promise<void> {
      const key = getKey(ctx)
      if (isExceeded(key)) {
        if (onExceeded === "throw") {
          throw new RateLimitError(rateLimitMessage)
        }
        if (onExceeded === "skip") {
          return // silently skip
        }
        // "message" — set output and return without calling model
        ctx.output = rateLimitMessage
        return
      }
      return next()
    },
  }
}
