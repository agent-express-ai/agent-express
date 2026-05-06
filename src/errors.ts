/**
 * Base error class for all Agent Express errors.
 *
 * Every error in the framework extends this class, providing a machine-readable
 * `code`, a `retryable` flag for middleware like `turn.retry()`, and an optional
 * `cause` for error chaining.
 *
 * @example
 * ```typescript
 * try {
 *   await agent.run({ input: "test" }).result
 * } catch (err) {
 *   if (err instanceof AgentExpressError) {
 *     console.log(err.code, err.retryable)
 *   }
 * }
 * ```
 */
export class AgentExpressError extends Error {
  /** Machine-readable error code (e.g., "ABORT", "RATE_LIMIT", "TOOL_DENIED"). */
  code: string
  /** Whether this error can be retried by retry middleware. */
  readonly retryable: boolean
  /** Original error that caused this one, if any. */
  override readonly cause?: Error

  constructor(message: string, code: string, retryable: boolean, cause?: Error) {
    super(message)
    this.name = "AgentExpressError"
    this.code = code
    this.retryable = retryable
    if (cause !== undefined) this.cause = cause
  }
}

/**
 * Thrown when `ctx.abort(reason)` is called in any middleware hook.
 *
 * This is a hard stop — it unwinds the entire onion stack up to the session level
 * and rejects the `AgentRun.result` promise. No LLM call is made after abort.
 *
 * @example
 * ```typescript
 * // In a middleware:
 * turn: async (ctx, next) => {
 *   if (ctx.state.totalCost > 1.00) ctx.abort("Budget exceeded")
 *   await next()
 * }
 * ```
 */
export class AbortError extends AgentExpressError {
  /** The reason passed to `ctx.abort()`. */
  readonly reason: string

  constructor(reason: string) {
    super(`Agent aborted: ${reason}`, "ABORT", false)
    this.name = "AbortError"
    this.reason = reason
  }
}

/**
 * Base class for errors originating from LLM model providers.
 *
 * Subtypes cover specific failure modes: rate limits, context overflow,
 * content filters, authentication, and network errors. The `retryable`
 * flag is set per subtype to guide retry middleware.
 */
export class ModelError extends AgentExpressError {
  /** Provider name (e.g., "anthropic", "openai"). */
  readonly provider: string
  /** HTTP status code from the provider API, if available. */
  readonly statusCode?: number

  constructor(message: string, provider: string, retryable: boolean, statusCode?: number, cause?: Error) {
    super(message, "MODEL_ERROR", retryable, cause)
    this.name = "ModelError"
    this.provider = provider
    if (statusCode !== undefined) this.statusCode = statusCode
  }
}

/**
 * HTTP 429 — the provider rate-limited the request. Retryable with backoff.
 *
 * @example
 * ```typescript
 * if (err instanceof RateLimitError) {
 *   await sleep(err.retryAfter ?? 5000)
 * }
 * ```
 */
export class RateLimitError extends ModelError {
  /** Suggested wait time in seconds before retrying, if the provider sent one. */
  readonly retryAfter?: number

  constructor(provider: string, retryAfter?: number, cause?: Error) {
    super(`Rate limit exceeded for ${provider}`, provider, true, 429, cause)
    this.name = "RateLimitError"
    this.code = "RATE_LIMIT"
    if (retryAfter !== undefined) this.retryAfter = retryAfter
  }
}

/** The prompt exceeded the model's context window. Retryable after truncation. */
export class ContextOverflowError extends ModelError {
  constructor(provider: string, cause?: Error) {
    super(`Context window exceeded for ${provider}`, provider, true, 400, cause)
    this.name = "ContextOverflowError"
    this.code = "CONTEXT_OVERFLOW"
  }
}

/** The provider blocked the request due to content policy. Not retryable. */
export class ContentFilterError extends ModelError {
  constructor(provider: string, cause?: Error) {
    super(`Content filtered by ${provider}`, provider, false, 400, cause)
    this.name = "ContentFilterError"
    this.code = "CONTENT_FILTER"
  }
}

/** Invalid or missing API key. Not retryable. */
export class AuthenticationError extends ModelError {
  constructor(provider: string, cause?: Error) {
    super(`Authentication failed for ${provider}`, provider, false, 401, cause)
    this.name = "AuthenticationError"
    this.code = "AUTH_ERROR"
  }
}

/** Network-level failure (DNS, TCP, TLS). Retryable. */
export class NetworkError extends ModelError {
  constructor(provider: string, cause?: Error) {
    super(`Network error connecting to ${provider}`, provider, true, undefined, cause)
    this.name = "NetworkError"
    this.code = "NETWORK_ERROR"
  }
}

/**
 * Thrown when `ctx.deny(reason)` is called in a `tool` hook.
 *
 * This is a soft failure — the tool is not executed, and the LLM receives
 * an error message so it can try a different approach. Does not unwind the stack.
 */
export class ToolDeniedError extends AgentExpressError {
  /** Name of the tool that was denied. */
  readonly toolName: string

  constructor(toolName: string, reason: string) {
    super(`Tool denied: ${toolName} — ${reason}`, "TOOL_DENIED", false)
    this.name = "ToolDeniedError"
    this.toolName = toolName
  }
}

/** A tool's `execute()` function threw an error. Wrapped with the tool name for context. */
export class ToolExecutionError extends AgentExpressError {
  /** Name of the tool that failed. */
  readonly toolName: string

  constructor(toolName: string, cause: Error) {
    super(`Tool execution failed: ${toolName} — ${cause.message}`, "TOOL_EXECUTION", false, cause)
    this.name = "ToolExecutionError"
    this.toolName = toolName
  }
}

/** Thrown when `session.run()` is called on a session that has been closed. */
export class SessionClosedError extends AgentExpressError {
  /** ID of the closed session. */
  readonly sessionId: string

  constructor(sessionId: string) {
    super(`Session ${sessionId} is closed`, "SESSION_CLOSED", false)
    this.name = "SessionClosedError"
    this.sessionId = sessionId
  }
}

/** Thrown when `session.run()` is called while a turn is already in progress. */
export class SessionBusyError extends AgentExpressError {
  /** ID of the busy session. */
  readonly sessionId: string

  constructor(sessionId: string) {
    super(`Session ${sessionId} has a turn in progress`, "SESSION_BUSY", false)
    this.name = "SessionBusyError"
    this.sessionId = sessionId
  }
}

/** Thrown when the model returns text that is not valid JSON for structured output. */
export class StructuredOutputParseError extends AgentExpressError {
  /** The raw text the model returned. */
  readonly rawText: string

  constructor(rawText: string) {
    super(`Structured output: model returned invalid JSON`, "STRUCTURED_OUTPUT_PARSE", false)
    this.name = "StructuredOutputParseError"
    this.rawText = rawText.slice(0, 500)
  }
}

/** Thrown when the parsed JSON does not match the expected Zod schema. */
export class StructuredOutputValidationError extends AgentExpressError {
  /** Zod validation issues. */
  readonly issues: unknown[]

  constructor(issues: unknown[]) {
    super(`Structured output validation failed: ${JSON.stringify(issues)}`, "STRUCTURED_OUTPUT_VALIDATION", false)
    this.name = "StructuredOutputValidationError"
    this.issues = issues
  }
}

/**
 * Thrown when `ctx.emit()` is called outside a session context — from an
 * `agent` hook (which has no `emit` on its context type), or from a deferred
 * task after `session:end`. Events are session-scoped by design.
 */
export class EventOutsideSessionError extends AgentExpressError {
  constructor(reason: string) {
    super(
      `Cannot emit event: ${reason}. Events are session-scoped — emit from session/turn/model/tool hooks only.`,
      "EVENT_OUTSIDE_SESSION",
      false,
    )
    this.name = "EventOutsideSessionError"
  }
}

/**
 * Thrown at agent construction when two declarations register the same event type.
 * Either core ↔ middleware collision, or middleware ↔ middleware collision.
 */
export class EventTypeCollisionError extends AgentExpressError {
  /** The event type with the collision. */
  readonly type: string
  /** Names of all owners that declared this type (core + middleware names). */
  readonly owners: readonly string[]

  constructor(type: string, owners: readonly string[]) {
    super(
      `Event type "${type}" declared by multiple owners: ${owners.join(", ")}. Each event type must be owned by exactly one middleware (or by core).`,
      "EVENT_TYPE_COLLISION",
      false,
    )
    this.name = "EventTypeCollisionError"
    this.type = type
    this.owners = owners
  }
}

/** Thrown at emit time when the payload fails the declared Zod schema. */
export class EventValidationError extends AgentExpressError {
  /** The event type whose payload failed validation. */
  readonly type: string
  /** Zod issues array (raw — caller can format as needed). */
  readonly issues: unknown

  constructor(type: string, issues: unknown) {
    super(`Event payload for "${type}" failed validation. See .issues for details.`, "EVENT_VALIDATION", false)
    this.name = "EventValidationError"
    this.type = type
    this.issues = issues
  }
}

/**
 * Thrown at emit time when the payload passes Zod validation but fails
 * `JSON.stringify` — `BigInt`, circular reference, function, `Date` instance, etc.
 * Two-layer defense: schema first, serialization second; framework never silently corrupts the log.
 */
export class EventSerializationError extends AgentExpressError {
  /** The event type whose payload failed serialization. */
  readonly type: string

  constructor(type: string, cause?: Error) {
    super(
      `Event payload for "${type}" failed JSON serialization. Avoid BigInt, circular refs, functions, and Date instances; pre-normalize to JSON primitives.`,
      "EVENT_SERIALIZATION",
      false,
      cause,
    )
    this.name = "EventSerializationError"
    this.type = type
  }
}

/** Thrown at emit time when the type isn't in the merged event vocabulary. */
export class UnknownEventTypeError extends AgentExpressError {
  /** The unknown event type the caller tried to emit. */
  readonly type: string

  constructor(type: string) {
    super(
      `Unknown event type "${type}". Declare it on a middleware's "events" field and use that middleware on this agent.`,
      "UNKNOWN_EVENT_TYPE",
      false,
    )
    this.name = "UnknownEventTypeError"
    this.type = type
  }
}

/**
 * Thrown by the framework when a storage adapter cannot durably write an event
 * before `turn:end` is acknowledged. The adapter has either thrown itself or
 * refused the write; the in-memory event log MUST NOT report the event as written.
 */
export class EventStoreWriteError extends AgentExpressError {
  /** The event type that failed to persist. */
  readonly type: string
  /** The framework-assigned event ID that did not durably write. */
  readonly eventId: string
  /** The session the event belonged to. */
  readonly sessionId: string

  constructor(sessionId: string, eventId: string, type: string, cause?: Error) {
    super(
      `Failed to durably write event "${type}" (id=${eventId}) for session ${sessionId}: ${cause?.message ?? "adapter refused"}`,
      "EVENT_STORE_WRITE",
      false,
      cause,
    )
    this.name = "EventStoreWriteError"
    this.sessionId = sessionId
    this.eventId = eventId
    this.type = type
  }
}
