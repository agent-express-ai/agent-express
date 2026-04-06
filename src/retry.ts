import type { RetryConfig } from "./types.js"
import {
  RateLimitError,
  NetworkError,
  ModelError,
  AuthenticationError,
  ContentFilterError,
} from "./errors.js"

/** Default retry configuration. Matches OpenAI SDK and Vercel AI SDK defaults. */
export const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
  maxRetries: 2,
  initialDelayMs: 1000,
}

/**
 * Determines if an error is retryable.
 *
 * Retryable: RateLimitError, NetworkError, ModelError with retryable=true.
 * Not retryable: AuthenticationError, ContentFilterError, or any error with retryable=false.
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof AuthenticationError) return false
  if (error instanceof ContentFilterError) return false
  if (error instanceof RateLimitError) return true
  if (error instanceof NetworkError) return true
  if (error instanceof ModelError) return error.retryable
  // Unknown errors: not retryable by default
  return false
}

/**
 * Wraps an async function with exponential backoff retry logic.
 *
 * Only retries errors that pass `isRetryableError()`. Non-retryable errors
 * propagate immediately. Respects `retryAfter` from RateLimitError.
 *
 * @param fn - Async function to wrap
 * @param config - Retry configuration
 * @param onRetry - Optional callback for each retry attempt (for logging)
 * @returns Result of fn()
 * @throws Last error after all retries exhausted, or non-retryable error immediately
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig | false | undefined,
  onRetry?: (attempt: number, error: Error, delayMs: number) => void,
): Promise<T> {
  if (config === false) {
    return fn()
  }

  const { maxRetries, initialDelayMs } = {
    ...DEFAULT_RETRY_CONFIG,
    ...config,
  }

  let lastError: Error | undefined

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
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

      onRetry?.(attempt + 1, error, delayMs)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  throw lastError ?? new Error("Retry exhausted")
}
