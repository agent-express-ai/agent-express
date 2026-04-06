import { describe, it, expect } from "vitest"
import {
  AgentExpressError,
  AbortError,
  ModelError,
  RateLimitError,
  ContextOverflowError,
  ContentFilterError,
  AuthenticationError,
  NetworkError,
  ToolDeniedError,
  ToolExecutionError,
} from "../../src/errors.js"

describe("AgentExpressError", () => {
  it("sets code, retryable, and cause", () => {
    const cause = new Error("original")
    const err = new AgentExpressError("test", "TEST", true, cause)
    expect(err.message).toBe("test")
    expect(err.code).toBe("TEST")
    expect(err.retryable).toBe(true)
    expect(err.cause).toBe(cause)
    expect(err).toBeInstanceOf(Error)
  })
})

describe("AbortError", () => {
  it("is not retryable and has reason", () => {
    const err = new AbortError("budget exceeded")
    expect(err.reason).toBe("budget exceeded")
    expect(err.retryable).toBe(false)
    expect(err.code).toBe("ABORT")
    expect(err).toBeInstanceOf(AgentExpressError)
  })
})

describe("ModelError subtypes", () => {
  it("RateLimitError is retryable with retryAfter", () => {
    const err = new RateLimitError("anthropic", 30)
    expect(err.retryable).toBe(true)
    expect(err.statusCode).toBe(429)
    expect(err.retryAfter).toBe(30)
    expect(err.provider).toBe("anthropic")
    expect(err).toBeInstanceOf(ModelError)
  })

  it("ContextOverflowError is retryable", () => {
    const err = new ContextOverflowError("anthropic")
    expect(err.retryable).toBe(true)
    expect(err.code).toBe("CONTEXT_OVERFLOW")
  })

  it("ContentFilterError is not retryable", () => {
    const err = new ContentFilterError("openai")
    expect(err.retryable).toBe(false)
    expect(err.code).toBe("CONTENT_FILTER")
  })

  it("AuthenticationError is not retryable", () => {
    const err = new AuthenticationError("openai")
    expect(err.retryable).toBe(false)
    expect(err.statusCode).toBe(401)
  })

  it("NetworkError is retryable without status code", () => {
    const err = new NetworkError("anthropic")
    expect(err.retryable).toBe(true)
    expect(err.statusCode).toBeUndefined()
  })
})

describe("ToolDeniedError", () => {
  it("has toolName and is not retryable", () => {
    const err = new ToolDeniedError("delete_user", "not allowed")
    expect(err.toolName).toBe("delete_user")
    expect(err.retryable).toBe(false)
    expect(err.code).toBe("TOOL_DENIED")
  })
})

describe("ToolExecutionError", () => {
  it("wraps cause error and has toolName", () => {
    const cause = new Error("timeout")
    const err = new ToolExecutionError("search", cause)
    expect(err.toolName).toBe("search")
    expect(err.cause).toBe(cause)
    expect(err.message).toContain("search")
    expect(err.message).toContain("timeout")
  })
})
