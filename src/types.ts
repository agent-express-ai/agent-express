/**
 * Core type definitions for Agent Express.
 *
 * This module defines the shared types used across the framework:
 * messages, tools, model responses, agent configuration, run results,
 * stream events, and state schemas.
 *
 * @module types
 */

import type { LanguageModelV3 } from "@ai-sdk/provider"
import type { ZodSchema } from "zod"

// ─── Messages ──────────────────────────────────────────

/** A message in the conversation history. */
export interface Message {
  role: "system" | "user" | "assistant" | "tool"
  /** String for text-only messages, or array of parts for tool calls/results. */
  content: string | MessagePart[]
}

/** A structured part of a message (text, tool call, or tool result). */
export interface MessagePart {
  type: "text" | "tool-call" | "tool-result"
  /** Text content (for "text" parts). */
  text?: string
  /** Tool call ID linking a call to its result. */
  toolCallId?: string
  /** Name of the tool being called or that produced the result. */
  toolName?: string
  /** Arguments passed to the tool (for "tool-call" parts). */
  args?: Record<string, unknown>
  /** Result returned by the tool (for "tool-result" parts). */
  result?: unknown
}

// ─── Tools ─────────────────────────────────────────────

/**
 * Internal representation of a registered tool.
 * Created by `tools.function()` from a `ToolDef`.
 */
export interface Tool {
  /** Tool name sent to the LLM. */
  name: string
  /** Description the LLM uses to decide when to call this tool. */
  description: string
  /** Zod schema for runtime input validation. Optional for MCP tools (which use jsonSchema directly). */
  schema?: ZodSchema
  /** JSON Schema representation sent to the LLM. */
  jsonSchema: Record<string, unknown>
  /** Execution function. Receives validated args and a context reference. */
  execute: (args: Record<string, unknown>, ctx: unknown) => Promise<unknown>
  /** Maximum execution time in ms. Default: 30000. */
  timeout?: number
  /** Whether this tool requires human approval before execution. Set by tools.function() or tools.mcp(). */
  requireApproval?: boolean | ((args: Record<string, unknown>) => boolean | Promise<boolean>)
}

/** Record of a tool call that occurred during a turn. Included in `RunResult.tools`. */
export interface ToolCallRecord {
  /** Tool call ID from the model response. */
  callId: string
  /** Tool name. */
  name: string
  /** Arguments the model passed to the tool. */
  args: Record<string, unknown>
  /** Value returned by the tool (or null if it failed). */
  result: unknown
  /** Execution time in milliseconds. */
  duration: number
  /** Error message if the tool execution failed. */
  error?: string
}

// ─── Model ─────────────────────────────────────────────

/** Normalized response from an LLM call (provider-agnostic). */
export interface ModelResponse {
  /** Generated text (present when the model returns a text response). */
  text?: string
  /** Tool calls requested by the model (present when the model wants to use tools). */
  toolCalls?: ModelToolCall[]
  /** Token usage for this call. */
  usage: Usage
  /** Why the model stopped: "stop", "tool-calls", "length", "content-filter", "error", "other". */
  finishReason: string
}

/** A single tool call from the model response. */
export interface ModelToolCall {
  /** Unique ID for this tool call (used to match with tool result). */
  toolCallId: string
  /** Name of the tool the model wants to call. */
  toolName: string
  /** Arguments for the tool call. */
  args: Record<string, unknown>
}

/** Token usage information for an LLM call. */
export interface Usage {
  /** Number of input (prompt) tokens. */
  inputTokens: number
  /** Number of output (completion) tokens. */
  outputTokens: number
}

/** Result of a tool execution, fed back to the LLM. */
export type ToolResult = {
  /** Tool call ID this result corresponds to. */
  callId: string
  /** The tool's output value. */
  result: unknown
  /** Whether this result represents an error (tool failed or was denied). */
  isError?: boolean
}

// ─── Agent Definition ──────────────────────────────────

/**
 * Configuration passed to `new Agent(def)`.
 *
 * @example
 * ```typescript
 * const agent = new Agent({
 *   name: "support",
 *   model: "anthropic/claude-sonnet-4-6",
 *   instructions: "You are a customer support agent.",
 * })
 * ```
 */
export interface AgentDef {
  /** Agent name for debugging and tracing. */
  name: string
  /** Model identifier string ("provider/model") or a LanguageModelV3 object. */
  model: string | LanguageModelV3
  /** System prompt injected into every model call. */
  instructions: string
  /**
   * Auto-apply sensible default middleware (retry, usage, tools, duration, maxIterations).
   * - `true` or omitted: defaults applied
   * - `{ ... }`: defaults applied with custom options
   * - `false`: bare minimum, no defaults
   */
  defaults?: boolean | DefaultsOptions
}

/**
 * Options for the auto-applied defaults middleware set.
 * Passed to `defaults()` when `AgentDef.defaults` is an object.
 */
export interface DefaultsOptions {
  /** Maximum model→tool→model iterations per turn. Default: 25. */
  maxIterations?: number
  /** Retry config. Default: { maxRetries: 2, initialDelayMs: 1000 }. Set false to disable. */
  retry?: RetryConfig | false
}

/**
 * Retry configuration for transient LLM failures.
 * Uses exponential backoff: initialDelayMs doubles each retry (1s, 2s, 4s...).
 */
export interface RetryConfig {
  /** Maximum retry attempts. Default: 2. */
  maxRetries?: number
  /** Initial delay in ms before first retry. Doubles each attempt. Default: 1000. */
  initialDelayMs?: number
}

/**
 * Structured log event emitted by observe.log() middleware.
 * Consumable by Datadog, Grafana, ELK, etc.
 */
export interface LogEvent {
  /** ISO 8601 timestamp. */
  timestamp: string
  /** Event type: "model:call", "model:response", "tool:start", "tool:end", etc. */
  type: string
  /** Session identifier. */
  sessionId: string
  /** Turn number within this session. */
  turnIndex: number
  /** Event-specific data (model, tokens, cost, tool name, duration, error). */
  data: Record<string, unknown>
  /** Log severity level. Added in 009-providers-observability. */
  level?: "debug" | "info" | "warn" | "error"
  /** Agent name for multi-agent filtering. Added in 009-providers-observability. */
  agentName?: string
  /** Turn identifier (present on turn/model/tool events). */
  turnId?: string
  /** Duration in milliseconds (present on end events). */
  durationMs?: number
  /** Error details (present on failure events). */
  error?: { type: string; message: string }
  /** OpenTelemetry trace ID (present when OTel span context is active). */
  traceId?: string
  /** OpenTelemetry span ID (present when OTel span context is active). */
  spanId?: string
}

// ─── Observability ────────────────────────────────────

/**
 * Standalone span representation for observe.traces() middleware.
 * Used when `@opentelemetry/api` is not installed.
 */
export interface SpanData {
  /** Span name (framework or OTel convention depending on mode). */
  name: string
  /** 32-char hex trace identifier. */
  traceId: string
  /** 16-char hex span identifier. */
  spanId: string
  /** Parent span ID (undefined for root spans). */
  parentId?: string
  /** Start timestamp (epoch ms). */
  startTime: number
  /** End timestamp (epoch ms). */
  endTime: number
  /** Span attributes (framework + GenAI). */
  attributes: Record<string, string | number | boolean | string[]>
  /** Span completion status. */
  status: "ok" | "error"
  /** Error details (when status is "error"). */
  error?: { type: string; message: string }
}

/**
 * Standalone metric event for observe.metrics() middleware.
 * Used when `@opentelemetry/api` is not installed.
 */
export interface MetricEvent {
  /** Metric name (e.g., "agent_express_model_calls_total"). */
  name: string
  /** Metric type. */
  type: "counter" | "histogram"
  /** Attribute key-value pairs. */
  attributes: Record<string, string>
  /** Value (increment for counter, observation for histogram). */
  value: number
}

/**
 * Session-scoped metrics snapshot written to `state['observe:metrics']`.
 * Simple JS object for programmatic access — independent of OTel.
 */
export interface MetricsSnapshot {
  /** Number of model calls in this session. */
  modelCalls: number
  /** Number of tool calls in this session. */
  toolCalls: number
  /** Number of turns in this session. */
  turns: number
  /** Number of errors in this session. */
  errors: number
  /** Token usage in this session. */
  tokens: { input: number; output: number }
  /** Durations in milliseconds. */
  duration: {
    session: number
    turns: number[]
    models: number[]
    tools: number[]
  }
}

// ─── Search & Knowledge ───────────────────────────────

/**
 * Retrieved knowledge fragment from document search.
 * Returned by retriever functions, injected into model context by `search.file()`.
 */
export interface Chunk {
  /** Chunk text content. */
  text: string
  /** Relevance score (0-1). */
  score?: number
  /** Source metadata for citation tracking. */
  source?: {
    /** Document title. */
    title?: string
    /** Source URL or file path. */
    url?: string
    /** Section within the document. */
    section?: string
  }
}

/**
 * Web search result returned by search provider adapters.
 * Passed to model as tool output by `search.web()`.
 */
export interface SearchResult {
  /** Result title. */
  title: string
  /** Result URL. */
  url: string
  /** Text snippet. */
  snippet: string
}

// ─── Events (the canonical session record) ─────────────

/**
 * One observable occurrence in a session — the canonical record format
 * from v0.4 onward. Append-only at the public API.
 *
 * Created by `ctx.emit({ type, payload })`. The framework auto-populates
 * `id` (UUIDv7), `ts` (wall-clock epoch ms), and `schemaVersion`.
 *
 * **Loose typing by design**: at the read site of `session.events`,
 * `type` is `string` and `payload` is `unknown`. Narrowing to a specific
 * event type is opt-in via the `typedEvents()` helper. Middleware authors
 * get compile-time payload safety locally via `z.infer<typeof MySchema>`
 * against their declared Zod schemas.
 */
export interface Event<TType extends string = string, TPayload = unknown> {
  /** UUIDv7 generated by the framework at emit time. Per-session unique. */
  readonly id: string
  /** Wall-clock epoch milliseconds when the event was emitted. */
  readonly ts: number
  /** Discriminator string (`namespace:field`), e.g. "user:input", "channel:slack:inbound". */
  readonly type: TType
  /** Per event-type schema version, ≥ 1. Bumped on breaking payload changes. */
  readonly schemaVersion: number
  /** Payload — `unknown` at the public read site; narrow via `typedEvents()` or Zod parse. */
  readonly payload: TPayload
}

/**
 * On-the-wire / on-disk shape stored by `SessionStore` adapters.
 * Differs from `Event` only by carrying the storage-private `ord` field —
 * a per-session monotonic counter that guarantees deterministic ordering
 * even when two emits land in the same UUIDv7 millisecond.
 */
export interface EventEnvelope {
  readonly sessionId: string
  readonly eventId: string
  readonly ord: number
  readonly ts: number
  readonly type: string
  readonly schemaVersion: number
  readonly payload: unknown
}

/**
 * Declaration of one event type — runtime Zod schema + version.
 * Owned by core (for built-in events) or by a middleware (for custom events).
 *
 * @example
 * ```typescript
 * const InboundSchema = z.object({ channel: z.string(), text: z.string() })
 * const eventDecl: EventTypeSchema = { schema: InboundSchema, schemaVersion: 1 }
 * ```
 */
export interface EventTypeSchema<T = unknown> {
  /** Zod schema validating the payload at emit time. */
  schema: ZodSchema<T>
  /** Schema version (≥ 1). Bumped when the payload shape changes incompatibly. */
  schemaVersion: number
}

/**
 * A record of event-type names → their schemas.
 *
 * Used by `Middleware.events` (per-middleware event-type map slice) and by the
 * framework's merged-event-type-map type after `agent.use()` chaining merges all
 * declarations into one map.
 */
export type EventTypeMap = Record<string, EventTypeSchema>

// ─── Session Persistence ──────────────────────────────

/**
 * Interface for session persistence backends.
 *
 * From v0.4 onward, a `SessionStore` stores the canonical event log per
 * session. The interface keeps `load`/`save`/`delete` for whole-session
 * materialization, and adds `appendEvent`/`listEvents` for the per-event
 * write path. The `(sessionId, eventId)` uniqueness invariant is the
 * load-bearing guarantee — re-writing the same event is a no-op.
 *
 * Built-in adapters: `@agent-express/session-sqlite`, `session-redis`,
 * `session-postgres`.
 */
export interface SessionStore {
  /** Load full session (state + events). Returns null if not found. */
  load(sessionId: string): Promise<SessionData | null>
  /** Save full session (state + events). Used for whole-session writes. */
  save(sessionId: string, data: SessionData): Promise<void>
  /** Delete a whole session and all its events atomically. */
  delete(sessionId: string): Promise<void>
  /**
   * Append a single event. Idempotent on `(sessionId, eventId)` —
   * re-writing the same event is a no-op write that does not error
   * and does not produce a duplicate row.
   */
  appendEvent(sessionId: string, envelope: EventEnvelope): Promise<void>
  /**
   * List events for a session with pagination. Order is by per-session
   * `ord` (monotonic counter), default ascending.
   *
   * Adapters MUST preserve unknown event types verbatim — a session
   * containing events of types unknown to the current reader still loads.
   */
  listEvents(
    sessionId: string,
    opts?: {
      /** Max events to return. */
      limit?: number
      /** Skip first N events. */
      offset?: number
      /** Sort order. Default: "asc" (oldest first). */
      order?: "asc" | "desc"
    },
  ): Promise<EventEnvelope[]>
}

/**
 * Persisted session data.
 * `state` contains both middleware data and developer custom data.
 * `events` is the canonical event log (replaces the v0.3 `history: Message[]` field).
 */
export interface SessionData {
  /** Session state — middleware keys + developer data. */
  state: Record<string, unknown>
  /** Canonical event log for this session. */
  events: EventEnvelope[]
  /** Creation timestamp (epoch ms). */
  createdAt: number
  /** Last update timestamp (epoch ms). */
  updatedAt: number
}

// ─── PII ──────────────────────────────────────────────

/**
 * Per-session PII redaction mapping for restore mechanism.
 * Maintained by `guard.piiRedact()` — tools get original values.
 */
export interface PiiMapping {
  /** Placeholder used in redacted text (e.g., "[EMAIL_1]"). */
  placeholder: string
  /** Original PII value (e.g., "john@example.com"). */
  original: string
  /** PII type — built-in ("email", "phone", etc.) or custom pattern name. */
  type: PiiType | (string & {})
}

/**
 * Built-in PII types supported by `guard.piiRedact()`.
 * Custom patterns can define additional string types.
 */
export type PiiType = "email" | "phone" | "creditCard" | "ssn" | "ip"

// ─── Session ──────────────────────────────────────────

/** Options passed to `agent.session()`. */
export interface SessionOptions {
  /** Custom session ID. Auto-generated UUID if omitted. Enables persistence middleware. */
  id?: string
}

// ─── Run ───────────────────────────────────────────────

/** Options passed to `session.run()` or `agent.run()` as second argument. */
export interface RunOptions {
  /** Zod schema for structured output. When set, RunResult.data contains validated typed object. */
  output?: ZodSchema
}

/**
 * Minimal result of a completed turn.
 *
 * All metadata (usage, tools, duration) lives in `state` under well-known keys
 * written by middleware (e.g., `observe:usage`, `observe:tools`, `observe:duration`).
 *
 * Accessible via `await session.run("msg").result` or `await agent.run("msg").result`.
 */
export interface RunResult {
  /** Assistant text response for this turn. */
  text: string
  /** Session state snapshot at turn end. All metadata accessible via well-known keys. */
  state: Record<string, unknown>
  /** Validated structured data when RunOptions.output was set. Undefined for text-only runs. */
  data?: unknown
}

// ─── Emit input ────────────────────────────────────────

/**
 * Shape passed to `ctx.emit(...)`. The framework auto-populates `id`
 * (UUIDv7), `ts` (wall-clock ms), and `schemaVersion` (from the declared
 * event-type map). Caller supplies only `type` and `payload`.
 *
 * Loose typing by design — `type: string`, `payload: unknown`. Compile-time
 * payload safety is achieved locally by middleware authors via
 * `z.infer<typeof MySchema>` against their declared schemas; runtime
 * safety comes from Zod validation against the merged event-type map
 * at emit time.
 *
 * Streaming consumers of `for await (const event of agent.run(...))`
 * receive full `Event` objects — same shape as `Session.events`, same IDs.
 */
export interface EmitInput {
  /** Discriminator (e.g., "user:input", "channel:slack:inbound"). */
  type: string
  /** Validated against the declared Zod schema for `type`. */
  payload: unknown
}

// ─── State Schema ──────────────────────────────────────

/**
 * Declaration for a single state field in a middleware's `state` property.
 *
 * Type is inferred from the `default` value. If a `reducer` is provided,
 * writes dispatch through it: `state.field = delta` → `reducer(current, delta)`.
 *
 * @example
 * ```typescript
 * state: {
 *   totalCost: { default: 0, reducer: (prev, delta) => prev + delta },
 *   isActive: { default: true },  // type inferred as boolean
 * }
 * ```
 */
export interface StateFieldDef<T = unknown> {
  /** Default value. TypeScript infers the field type from this. */
  default: T
  /** Optional reducer for merge semantics. Without it, writes use last-write-wins. */
  reducer?: (prev: T, delta: T) => T
}

/** State schema: a record of field names to their declarations. */
export type StateSchema = Record<string, StateFieldDef>
