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
export class UserRateLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UserRateLimitError"
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
  /** Maximum number of tracked keys to prevent unbounded memory growth. */
  const MAX_KEYS = 10_000

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
      // Evict oldest keys if at capacity
      if (windows.size >= MAX_KEYS) {
        const oldestKey = windows.keys().next().value as string
        windows.delete(oldestKey)
      }
      timestamps = []
      windows.set(key, timestamps)
    }
    // Remove timestamps outside window
    const cutoff = now - windowMs
    while (timestamps.length > 0 && timestamps[0]! < cutoff) {
      timestamps.shift()
    }
    // Clean up empty entries to prevent memory leak
    if (timestamps.length === 0) {
      windows.delete(key)
    }
    if (timestamps.length >= maxPerMinute) {
      return true
    }
    timestamps.push(now)
    // Re-add key if it was deleted (entry had expired but new request is allowed)
    if (!windows.has(key)) {
      windows.set(key, timestamps)
    }
    return false
  }

  return {
    name: "guard:rateLimit",

    async turn(ctx: TurnContext, next: () => Promise<void>): Promise<void> {
      const key = getKey(ctx)
      if (isExceeded(key)) {
        ctx.emit({
          type: "turn:aborted",
          payload: { reason: "rateLimit", message: `rate limit hit (max=${maxPerMinute}/min, by=${by})` },
        })
        if (onExceeded === "throw") {
          throw new UserRateLimitError(rateLimitMessage)
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
