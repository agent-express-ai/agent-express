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
  /** Event type: "model:call", "model:response", "tool:call", "tool:result", "retry", "error", etc. */
  type: string
  /** Session identifier. */
  sessionId: string
  /** Turn number within this session. */
  turnIndex: number
  /** Event-specific data (model, tokens, cost, tool name, duration, error). */
  data: Record<string, unknown>
}

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
