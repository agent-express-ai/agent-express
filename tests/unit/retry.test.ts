import { describe, it, expect, vi } from "vitest"
import { withRetry, isRetryableError } from "../../src/retry.js"
import {
  RateLimitError,
  NetworkError,
  AuthenticationError,
  ContentFilterError,
  ModelError,
} from "../../src/errors.js"

describe("isRetryableError", () => {
  it("RateLimitError is retryable", () => {
    expect(isRetryableError(new RateLimitError("anthropic"))).toBe(true)
  })

  it("NetworkError is retryable", () => {
    expect(isRetryableError(new NetworkError("anthropic"))).toBe(true)
  })

  it("AuthenticationError is NOT retryable", () => {
    expect(isRetryableError(new AuthenticationError("anthropic"))).toBe(false)
  })

  it("ContentFilterError is NOT retryable", () => {
    expect(isRetryableError(new ContentFilterError("anthropic"))).toBe(false)
  })

  it("ModelError with retryable=true is retryable", () => {
    expect(isRetryableError(new ModelError("server error", "anthropic", true, 500))).toBe(true)
  })

  it("ModelError with retryable=false is NOT retryable", () => {
    expect(isRetryableError(new ModelError("bad request", "anthropic", false, 400))).toBe(false)
  })

  it("unknown error is NOT retryable", () => {
    expect(isRetryableError(new Error("random"))).toBe(false)
  })
})

describe("withRetry", () => {
  it("returns result on first success", async () => {
    const fn = vi.fn(async () => "ok")
    const result = await withRetry(fn, { maxRetries: 2, initialDelayMs: 10 })
    expect(result).toBe("ok")
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("retries retryable error and succeeds", async () => {
    let attempt = 0
    const fn = vi.fn(async () => {
      attempt++
      if (attempt === 1) throw new RateLimitError("anthropic")
      return "ok"
    })

    const result = await withRetry(fn, { maxRetries: 2, initialDelayMs: 10 })
    expect(result).toBe("ok")
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it("does NOT retry non-retryable error", async () => {
    const fn = vi.fn(async () => {
      throw new AuthenticationError("anthropic")
    })

    await expect(withRetry(fn, { maxRetries: 2, initialDelayMs: 10 })).rejects.toThrow(
      AuthenticationError,
    )
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("exhausts retries and throws last error", async () => {
    const fn = vi.fn(async () => {
      throw new NetworkError("anthropic")
    })

    await expect(withRetry(fn, { maxRetries: 2, initialDelayMs: 10 })).rejects.toThrow(
      NetworkError,
    )
    expect(fn).toHaveBeenCalledTimes(3) // 1 initial + 2 retries
  })

  it("calls onRetry callback", async () => {
    let attempt = 0
    const fn = vi.fn(async () => {
      attempt++
      if (attempt <= 2) throw new RateLimitError("anthropic")
      return "ok"
    })

    const retries: Array<{ attempt: number; delay: number }> = []
    await withRetry(fn, { maxRetries: 3, initialDelayMs: 10 }, (a, _e, d) => {
      retries.push({ attempt: a, delay: d })
    })

    expect(retries).toHaveLength(2)
    expect(retries[0]!.attempt).toBe(1)
    expect(retries[1]!.attempt).toBe(2)
  })

  it("disabled when config is false", async () => {
    const fn = vi.fn(async () => {
      throw new RateLimitError("anthropic")
    })

    await expect(withRetry(fn, false)).rejects.toThrow(RateLimitError)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("respects retryAfter from RateLimitError", async () => {
    let attempt = 0
    const fn = vi.fn(async () => {
      attempt++
      if (attempt === 1) throw new RateLimitError("anthropic", 0.01) // 10ms retryAfter
      return "ok"
    })

    const start = Date.now()
    await withRetry(fn, { maxRetries: 1, initialDelayMs: 1 })
    const elapsed = Date.now() - start
    // retryAfter = 10ms should be respected (> initialDelayMs of 1ms)
    expect(elapsed).toBeGreaterThanOrEqual(8) // allow some timing slack
  })
})
