import type { LanguageModelV3 } from "@ai-sdk/provider"
import type { AgentDef, RunOptions, ModelResponse, Tool, SessionOptions } from "./types.js"
import type {
  Middleware, AgentContext, ModelContext, HookScope,
  AgentHookFn, SessionHookFn, TurnHookFn, ModelHookFn, ToolHookFn,
} from "./middleware.js"
import { SessionStore } from "./session-store.js"
import { AgentRun } from "./run.js"
import { composeHooks } from "./executor.js"
import { createAgentContext } from "./context.js"
import { resolveModel } from "./providers/resolve.js"
import { callLanguageModel } from "./providers/adapter.js"
import { Session } from "./session.js"
import type { SessionInternals } from "./session.js"
import { EventBus } from "./events.js"
import { defaults } from "./defaults.js"

/** Symbol.asyncDispose polyfill for Node.js 20 */
(Symbol as any).asyncDispose ??= Symbol.for("Symbol.asyncDispose")

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
    // Session creation is synchronous for DX, but we need init.
    // If not initialized, we start init and the first run() will await it.
    // For truly async init, call agent.init() first.
    const stateSchemas = this.middlewares.filter((m) => m.state).map((m) => m.state!)
    const store = new SessionStore(opts?.id, stateSchemas)
    const modelId = typeof this.def.model === "string" ? this.def.model : this.def.model.modelId

    // Explicit check instead of null assertion
    if (!this.agentCtx) {
      throw new Error("Agent not initialized. Call agent.init() before creating sessions.")
    }

    const internals: SessionInternals = {
      agentCtx: this.agentCtx,
      middlewares: this.middlewares,
      resolvedModel: this.resolvedModel,
      modelId,
      callModel: (ctx) => this.callModel(ctx),
      onClose: (s) => this.openSessions.delete(s),
    }

    const session = new Session(store, internals)
    this.openSessions.add(session)

    // Start session onion — run() awaits this internally
    const bus = new EventBus()
    ;(session as any).initPromise = session._initOnion(bus).catch((err: Error) => {
      // Store error — will surface when session.run() is called
      ;(session as any)._initError = err
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
    const agentRun = new AgentRun()

    this.executeConvenienceRun(input, opts, agentRun).catch((err) => {
      agentRun.fail(err instanceof Error ? err : new Error(String(err)))
    })

    return agentRun
  }

  private async executeConvenienceRun(input: string, opts: RunOptions | undefined, agentRun: AgentRun): Promise<void> {
    await this.init()

    const stateSchemas = this.middlewares.filter((m) => m.state).map((m) => m.state!)
    const store = new SessionStore(undefined, stateSchemas)
    const modelId = typeof this.def.model === "string" ? this.def.model : this.def.model.modelId

    if (!this.agentCtx) {
      throw new Error("Agent not initialized. Call agent.init() before running.")
    }

    const internals: SessionInternals = {
      agentCtx: this.agentCtx,
      middlewares: this.middlewares,
      resolvedModel: this.resolvedModel,
      modelId,
      callModel: (ctx) => this.callModel(ctx),
      onClose: () => {},
    }

    const session = new Session(store, internals)
    const bus = new EventBus()

    // Wire bus events to agentRun
    void (async () => {
      for await (const event of bus) {
        agentRun.emit(event)
      }
    })()

    await session._initOnion(bus)

    const innerRun = session.run(input, opts)

    // Forward the result
    try {
      const result = await innerRun.result
      await session.close()
      bus.close()
      agentRun.complete(result)
    } catch (err) {
      await session.close()
      bus.close()
      throw err
    }
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
