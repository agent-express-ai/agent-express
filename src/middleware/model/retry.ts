import type { Middleware, ModelContext } from "../../middleware.js"
import type { RetryConfig, ModelResponse } from "../../types.js"
import { isRetryableError, DEFAULT_RETRY_CONFIG } from "../../retry.js"
import { RateLimitError } from "../../errors.js"

/**
 * Creates a `model.retry()` middleware that wraps LLM calls with exponential backoff.
 *
 * On transient failures (rate limits, network errors, retryable model errors),
 * retries up to `maxRetries` times with exponential backoff starting at
 * `initialDelayMs` (doubling each attempt). Non-retryable errors propagate
 * immediately without retry.
 *
 * Uses the same retry classification as the core `withRetry()` utility:
 * `RateLimitError` and `NetworkError` are retryable, `AuthenticationError`
 * and `ContentFilterError` are not.
 *
 * @param config - Retry configuration. Defaults to 2 retries with 1000ms initial delay.
 * @returns Middleware that retries failed model calls with exponential backoff
 *
 * @example
 * ```typescript
 * // Default: 2 retries, 1s initial delay
 * agent.use(model.retry())
 *
 * // Custom: 3 retries, 500ms initial delay
 * agent.use(model.retry({ maxRetries: 3, initialDelayMs: 500 }))
 * ```
 */
export function modelRetry(config?: RetryConfig): Middleware {
  const { maxRetries, initialDelayMs } = {
    ...DEFAULT_RETRY_CONFIG,
    ...config,
  }

  return {
    name: "model:retry",

    async model(ctx: ModelContext, next: () => Promise<ModelResponse>): Promise<ModelResponse> {
      let lastError: Error | undefined

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          return await next()
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err))
          lastError = error

          // Don't retry on last attempt or non-retryable errors
          if (attempt >= maxRetries || !isRetryableError(error)) {
            throw error
          }

          // Calculate delay: exponential backoff, respect retryAfter
          let delayMs = initialDelayMs * Math.pow(2, attempt)
          if (error instanceof RateLimitError && error.retryAfter) {
            delayMs = Math.max(delayMs, error.retryAfter * 1000)
          }

          await new Promise((resolve) => setTimeout(resolve, delayMs))
        }
      }

      throw lastError ?? new Error("Retry exhausted")
    },
  }
}
