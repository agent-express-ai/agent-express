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

// ─── Session Persistence ──────────────────────────────

/**
 * Interface for session persistence backends.
 * Implement this to store sessions in any storage system.
 * Built-in adapters: `@agent-express/session-sqlite`, `session-redis`, `session-postgres`.
 */
export interface SessionStore {
  /** Load full session (state + history). Returns null if not found. */
  load(sessionId: string): Promise<SessionData | null>
  /** Save full session (state + history). */
  save(sessionId: string, data: SessionData): Promise<void>
  /** Delete session. */
  delete(sessionId: string): Promise<void>
  /** Append a single message without rewriting the full history. */
  add(sessionId: string, message: Message): Promise<void>
  /** Get messages with pagination. */
  list(sessionId: string, opts?: {
    /** Max messages to return. */
    limit?: number
    /** Skip first N messages. */
    offset?: number
    /** Sort order. Default: "desc" (newest first). */
    order?: "asc" | "desc"
  }): Promise<Message[]>
}

/**
 * Persisted session data.
 * `state` contains both middleware data and developer custom data.
 */
export interface SessionData {
  /** Session state — middleware keys + developer data. */
  state: Record<string, unknown>
  /** Conversation message history. */
  history: Message[]
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

// ─── Stream Events ─────────────────────────────────────

/**
 * Discriminated union of all events emitted during agent execution.
 *
 * Events follow the lifecycle nesting: session → turn → model/tool.
 * Consumers iterate over these via `for await (const event of agent.run(...))`.
 */
export type StreamEvent =
  | { type: "session:start"; sessionId: string }
  | { type: "session:end"; sessionId: string; result: RunResult }
  | { type: "turn:start"; turnIndex: number; turnId: string }
  | { type: "turn:end"; turnIndex: number; turnId: string; text: string }
  | { type: "model:start"; model: string; callIndex: number }
  | { type: "model:chunk"; callIndex: number; text: string }
  | { type: "model:end"; callIndex: number; finishReason: string }
  | { type: "tool:start"; tool: string; args: Record<string, unknown>; callId: string }
  | { type: "tool:end"; tool: string; callId: string; result: unknown }
  | { type: "error"; error: Error }

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
