import type { LanguageModelV3 } from "@ai-sdk/provider"
import type { AgentDef, RunOptions, RunResult, ModelResponse, Tool, SessionOptions, EventTypeMap, SessionStore } from "./types.js"
import type {
  Middleware, AgentContext, ModelContext, HookScope,
  AgentHookFn, SessionHookFn, TurnHookFn, ModelHookFn, ToolHookFn,
} from "./middleware.js"
import { SessionState } from "./session-store.js"
import { AgentRun } from "./run.js"
import { composeHooks } from "./executor.js"
import { createAgentContext } from "./context.js"
import { resolveModel } from "./providers/resolve.js"
import { callLanguageModel } from "./providers/adapter.js"
import { Session } from "./session.js"
import type { SessionInternals } from "./session.js"
import { mergeEventTypeMaps } from "./event-log/validate.js"
import { Writer } from "./event-log/writer.js"
import { EventLog, SESSION_STORE_PROVIDER } from "./event-log/event-log.js"
import { defaults } from "./defaults.js"

/** Symbol.asyncDispose polyfill for Node.js 20 */
;(Symbol as { asyncDispose?: symbol }).asyncDispose ??= Symbol.for("Symbol.asyncDispose")

/** Map from scope name to the corresponding hook function type. */
type ScopeHookFn = {
  agent: AgentHookFn
  session: SessionHookFn
  turn: TurnHookFn
  model: ModelHookFn
  tool: ToolHookFn
}

/**
 * The core entry point of Agent Express.
 *
 * An Agent wraps a language model with middleware-based lifecycle hooks.
 * Create an agent, add middleware with `.use()`, and run it with `.run()`.
 *
 * @example
 * ```typescript
 * const agent = new Agent({
 *   name: "assistant",
 *   model: "anthropic/claude-sonnet-4-6",
 *   instructions: "You are a helpful assistant.",
 * })
 *
 * // Multi-turn
 * await agent.init()
 * const session = agent.session()
 * const r = await session.run("Hello!").result
 * await session.close()
 * await agent.dispose()
 *
 * // Convenience one-liner
 * const { text } = await agent.run("Hello!").result
 * ```
 */
export class Agent {
  /** Agent name used for debugging and tracing. */
  readonly name: string

  private readonly def: AgentDef
  private readonly middlewares: Middleware[] = []
  private initialized = false
  private defaultsApplied = false
  private agentCtx: (AgentContext & { _tools: Tool[] }) | null = null
  private resolvedModel: LanguageModelV3 | null = null
  private resolveAgentLifecycle: (() => void) | null = null
  private agentOnionPromise: Promise<void> | null = null
  private readonly openSessions = new Set<Session>()
  private eventTypeMap: EventTypeMap | null = null
  private writer: Writer | null = null

  constructor(def: AgentDef) {
    this.name = def.name
    this.def = def
  }

  /**
   * Register middleware on this agent. Chainable.
   *
   * Accepts a `Middleware` object, an array of middleware, a plain function
   * (treated as a `turn` hook), or a scope + function pair.
   *
   * @returns this agent (for chaining)
   */
  use(middleware: Middleware): this
  use(middlewares: Middleware[]): this
  use(fn: TurnHookFn): this
  use<S extends HookScope>(scope: S, fn: ScopeHookFn[S]): this
  use(first: Middleware | Middleware[] | TurnHookFn | HookScope, second?: ScopeHookFn[HookScope]): this {
    if (Array.isArray(first)) {
      this.middlewares.push(...first)
    } else if (typeof first === "string" && second) {
      this.middlewares.push({ name: "anonymous", [first]: second })
    } else if (typeof first === "function") {
      this.middlewares.push({ name: "anonymous", turn: first })
    } else {
      this.middlewares.push(first as Middleware)
    }
    return this
  }

  /**
   * Explicitly initialize the agent: resolve model, run agent middleware
   * (connect MCP servers, register tools, etc.). Idempotent.
   *
   * @example
   * ```typescript
   * await agent.init()  // MCP servers connect, tools register
   * ```
   */
  async init(): Promise<void> {
    if (this.initialized) return

    // Auto-apply defaults before init
    this.applyDefaults()

    // Merge core + middleware-declared event vocabularies. Throws on collision.
    this.eventTypeMap = mergeEventTypeMaps(this.middlewares)

    // Build the durable-write queue if a SessionStore was provided in defaults
    // or via middleware (memory.store etc.). Resolved lazily — the agent
    // doesn't require a SessionStore.
    const store = this.findSessionStore()
    this.writer = store ? new Writer(store) : null

    const modelId = typeof this.def.model === "string" ? this.def.model : this.def.model.modelId
    this.agentCtx = createAgentContext(
      { name: this.def.name, model: modelId, instructions: this.def.instructions },
      [],
    ) as AgentContext & { _tools: Tool[] }

    this.resolvedModel = await this.doResolveModel()

    let signalReady!: () => void
    const readyPromise = new Promise<void>((r) => (signalReady = r))

    const agentBody = async () => {
      signalReady()
      await new Promise<void>((r) => {
        this.resolveAgentLifecycle = r
      })
    }

    this.agentOnionPromise = composeHooks(this.middlewares, "agent", agentBody)(this.agentCtx)

    try {
      await Promise.race([readyPromise, this.agentOnionPromise])
    } catch (err) {
      this.agentOnionPromise = null
      this.resolveAgentLifecycle = null
      throw err
    }
    this.initialized = true
  }

  /**
   * Dispose the agent: auto-closes open sessions, then unwinds the agent
   * onion triggering cleanup in all middleware (reverse registration order).
   * Idempotent — safe to call on an uninitialized agent.
   */
  async dispose(): Promise<void> {
    // Auto-close open sessions
    for (const session of this.openSessions) {
      await session.close()
    }
    this.openSessions.clear()

    if (this.resolveAgentLifecycle) {
      this.resolveAgentLifecycle()
      await this.agentOnionPromise
    }
    this.initialized = false
    this.agentCtx = null
    this.resolveAgentLifecycle = null
    this.agentOnionPromise = null
  }

  /** Alias for dispose() — enables `await using agent = new Agent(...)`. */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.dispose()
  }

  /**
   * Create a new session for multi-turn conversation.
   * Auto-initializes the agent if not already initialized.
   *
   * @param opts - Optional session configuration (custom ID for persistence)
   * @returns A Session object for executing turns
   */
  session(opts?: SessionOptions): Session {
    const stateSchemas = this.middlewares.filter((m) => m.state).map((m) => m.state!)
    const store = new SessionState(opts?.id, stateSchemas)
    const modelId = typeof this.def.model === "string" ? this.def.model : this.def.model.modelId

    if (!this.agentCtx) {
      throw new Error("Agent not initialized. Call agent.init() before creating sessions.")
    }
    if (!this.eventTypeMap) {
      throw new Error("Agent event-type map not built. Call agent.init() before creating sessions.")
    }

    const internals: SessionInternals = {
      agentCtx: this.agentCtx,
      middlewares: this.middlewares,
      resolvedModel: this.resolvedModel,
      modelId,
      callModel: (ctx) => this.callModel(ctx),
      eventTypeMap: this.eventTypeMap,
      writer: this.writer,
      onClose: (s) => this.openSessions.delete(s),
    }

    const session = new Session(store, internals)
    this.openSessions.add(session)

    ;(session as unknown as { initPromise?: Promise<void> }).initPromise = session
      ._initOnion()
      .catch((err: Error) => {
        ;(session as unknown as { _initError?: Error })._initError = err
      })

    return session
  }

  /**
   * Convenience: auto-init + create session + single turn + close session.
   *
   * @param input - User message text
   * @param opts - Optional run options (output schema)
   * @returns AgentRun (dual interface: streaming + result promise)
   *
   * @example
   * ```typescript
   * const { text } = await agent.run("Hello!").result
   * ```
   */
  run(input: string, opts?: RunOptions): AgentRun {
    // Need to return synchronously, but the inner session is created lazily
    // inside the async path (init may not have run yet). Build a proxy log
    // that the outer AgentRun iterates; pump events from the inner session's
    // log into the proxy via a subscription. Result is forwarded directly.
    const proxyLog = new EventLog()
    const outer = new AgentRun(proxyLog)

    this.executeConvenienceRun(input, opts, proxyLog).then(
      (result) => outer.complete(result),
      (err) => outer.fail(err instanceof Error ? err : new Error(String(err))),
    )

    return outer
  }

  private async executeConvenienceRun(
    input: string,
    opts: RunOptions | undefined,
    proxyLog: EventLog,
  ): Promise<RunResult> {
    await this.init()

    const session = this.session()
    // Forward inner session events to the outer proxy log so streaming
    // consumers of agent.run() see the same Event objects (same IDs).
    const unsubscribe = session._eventLog.subscribe((event) => proxyLog.append(event))
    try {
      const innerRun = session.run(input, opts)
      const result = await innerRun.result
      return result
    } finally {
      unsubscribe()
      proxyLog.close()
      await session.close()
    }
  }

  private findSessionStore(): SessionStore | null {
    // Walk middleware for one that advertises a SessionStore via the
    // SESSION_STORE_PROVIDER symbol (set by `memory.store()` and any other
    // middleware that wants to provide durable persistence). First match wins.
    for (const mw of this.middlewares) {
      const candidate = (mw as { [SESSION_STORE_PROVIDER]?: SessionStore })[SESSION_STORE_PROVIDER]
      if (candidate) return candidate
    }
    return null
  }

  private applyDefaults(): void {
    if (this.defaultsApplied) return
    this.defaultsApplied = true

    if (this.def.defaults === false) return

    const opts = typeof this.def.defaults === "object" ? this.def.defaults : undefined
    const defaultMiddlewares = defaults(opts)
    // Prepend defaults before user middleware
    this.middlewares.unshift(...defaultMiddlewares)
  }

  private async doResolveModel(): Promise<LanguageModelV3> {
    if (typeof this.def.model !== "string") {
      return this.def.model
    }
    return resolveModel(this.def.model)
  }

  private async callModel(ctx: ModelContext): Promise<ModelResponse> {
    if (!this.resolvedModel) {
      throw new Error("Model not resolved. Cannot make LLM call.")
    }
    return callLanguageModel(this.resolvedModel, ctx)
  }
}
