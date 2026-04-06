import type { StateSchema, Tool, Message, StreamEvent, ModelResponse, ToolResult } from "./types.js"

/**
 * Context available during the `agent` onion hook.
 *
 * Provides access to the agent definition and tool registration.
 * This is the shallowest context — all deeper contexts inherit from it.
 */
export interface AgentContext {
  /** Agent definition: name, model, instructions. */
  agent: {
    name: string
    model: string
    instructions: string
  }
  /** Register a tool on the agent. Call in the `agent` hook before `next()`. */
  registerTool(tool: Tool): void
  /** Middleware-specific configuration from the agent definition. */
  config: Record<string, unknown>
}

/**
 * Context available during the `session` hook.
 *
 * Extends `AgentContext` with session-level data: session ID, state,
 * conversation history, and event emission.
 */
export interface SessionContext extends AgentContext {
  /** Unique session identifier. */
  sessionId: string
  /** Session state — typed fields with optional reducers, shared across all turns. */
  state: Record<string, unknown>
  /** Canonical conversation history (append-only). */
  history: Message[]
  /** Emit a stream event to the consumer. */
  emit(event: StreamEvent): void
}

/**
 * Context available during the `turn` hook.
 *
 * Extends `SessionContext` with turn-specific data: input messages,
 * output, turn ID, and the `abort()` method for hard-stopping.
 */
export interface TurnContext extends SessionContext {
  /** Input messages for this turn. */
  input: Message[]
  /** Assistant's final text output for this turn. `null` until the turn completes. */
  output: string | null
  /** Unique turn identifier. */
  turnId: string
  /** Turn number within this session (0-based). */
  turnIndex: number
  /** Timestamp when this turn started. */
  startedAt: number
  /**
   * Hard-stop the turn. Throws `AbortError` that unwinds the entire onion stack.
   * @throws {AbortError}
   */
  abort(reason: string): never
}

/**
 * Context available during the `model` hook (wraps one LLM call).
 *
 * Extends `TurnContext` with mutable messages, model selection,
 * tool definitions, and short-circuit methods.
 *
 * `messages` is a **mutable copy** prepared for this specific LLM call —
 * middleware can truncate, inject, or reorder without affecting `SessionContext.history`.
 */
export interface ModelContext extends TurnContext {
  /** Mutable message array for this LLM call. Middleware can modify freely. */
  messages: Message[]
  /** Model identifier. Middleware can override via `setModel()`. */
  model: string
  /** Tool schemas sent to the LLM. Middleware can filter via `removeTools()`. */
  toolDefs: Array<{ name: string; description: string; jsonSchema: Record<string, unknown> }>
  /** Which model call in this turn (0-based). */
  callIndex: number
  /** Override the model for this call only. */
  setModel(model: string): void
  /** Prepend a system message to the messages array. */
  addSystemMessage(text: string): void
  /** Append a message to the messages array. */
  addMessage(msg: Message): void
  /** Remove tools by name from this call's tool definitions. */
  removeTools(...names: string[]): void
  /**
   * Skip the LLM call entirely and return a synthetic response.
   * Used for caching — the cached response is returned without calling the provider.
   */
  skipCall(response: ModelResponse): void
}

/**
 * Context available during the `tool` hook (wraps one tool execution).
 *
 * Extends `TurnContext` with tool-specific data and control flow methods:
 * `deny()` for soft-blocking, `skipCall()` for mocking, `modifyArgs()` for
 * argument transformation.
 */
export interface ToolContext extends TurnContext {
  /** Tool definition (name, description, schema, approval flag). */
  tool: { name: string; description: string; jsonSchema: Record<string, unknown>; requireApproval?: boolean | ((args: Record<string, unknown>) => boolean | Promise<boolean>) }
  /** Arguments from the LLM. Middleware can modify via `modifyArgs()`. */
  args: Record<string, unknown>
  /** Tool call ID from the model response. */
  callId: string
  /** Which tool call within this model response (0-based). */
  callIndex: number
  /** Replace or merge tool call arguments. */
  modifyArgs(newArgs: Record<string, unknown>): void
  /** Explicitly approve the tool call (reserved for future HITL flows). */
  approve(): void
  /**
   * Deny the tool call. Returns an error message to the LLM so it can adapt.
   * Does NOT throw — this is a soft failure.
   */
  deny(reason: string): void
  /** Skip tool execution and return a synthetic result (for mocking/testing). */
  skipCall(result: ToolResult): void
}

/**
 * The middleware interface — the single extension mechanism for Agent Express.
 *
 * A middleware can implement any subset of 5 onion hooks, all with the same
 * `(ctx, next)` pattern. Code before `await next()` runs on the way in;
 * code after runs on the way out.
 *
 * - **`agent`**: wraps the agent lifetime (init → ... → dispose)
 * - **`session`**: wraps one `run()` call
 * - **`turn`**: wraps one user → assistant cycle
 * - **`model`**: wraps one LLM call
 * - **`tool`**: wraps one tool execution
 *
 * Plus 1 declarative property:
 * - `state`: session state field declarations with defaults and optional reducers
 *
 * @example
 * ```typescript
 * const costTracker: Middleware = {
 *   name: "cost-tracker",
 *   state: { totalCost: { default: 0, reducer: (prev, delta) => prev + delta } },
 *   model: async (ctx, next) => {
 *     const response = await next()
 *     ctx.state.totalCost = response.usage.inputTokens * 0.001
 *     return response
 *   },
 * }
 * ```
 */
export interface Middleware {
  /** Middleware name for debugging and tracing. */
  name: string
  /** Session state field declarations with defaults and optional reducers. */
  state?: StateSchema

  /**
   * Wraps the agent lifetime. Code before `next()` = init; code after = dispose.
   * Register tools via `ctx.registerTool()` before calling `next()`.
   * Use `try { await next() } finally { cleanup }` for guaranteed resource cleanup.
   */
  agent?(ctx: AgentContext, next: () => Promise<void>): Promise<void>
  /** Wraps a session (one `run()` call). Code before `next()` = session start; after = session end. */
  session?(ctx: SessionContext, next: () => Promise<void>): Promise<void>
  /** Wraps a turn (one user message → assistant response cycle). */
  turn?(ctx: TurnContext, next: () => Promise<void>): Promise<void>
  /** Wraps a single LLM call. Can modify messages, change model, skip call, or transform response. */
  model?(ctx: ModelContext, next: () => Promise<ModelResponse>): Promise<ModelResponse>
  /** Wraps a single tool execution. Can modify args, deny, skip, or transform result. */
  tool?(ctx: ToolContext, next: () => Promise<ToolResult>): Promise<ToolResult>
}

/** Scope names for the 5 onion hooks. */
export type HookScope = "agent" | "session" | "turn" | "model" | "tool"

/** Function type for the `agent` hook. */
export type AgentHookFn = (ctx: AgentContext, next: () => Promise<void>) => Promise<void>
/** Function type for the `session` hook. */
export type SessionHookFn = (ctx: SessionContext, next: () => Promise<void>) => Promise<void>
/** Function type for the `turn` hook. */
export type TurnHookFn = (ctx: TurnContext, next: () => Promise<void>) => Promise<void>
/** Function type for the `model` hook. */
export type ModelHookFn = (ctx: ModelContext, next: () => Promise<ModelResponse>) => Promise<ModelResponse>
/** Function type for the `tool` hook. */
export type ToolHookFn = (ctx: ToolContext, next: () => Promise<ToolResult>) => Promise<ToolResult>
