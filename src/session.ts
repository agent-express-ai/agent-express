import type { Message, RunOptions, RunResult, Tool, ModelResponse, StreamEvent } from "./types.js"
import type { Middleware, AgentContext, SessionContext, ModelContext } from "./middleware.js"
import { SessionStore } from "./session-store.js"
import { AgentRun } from "./run.js"
import { composeHooks } from "./executor.js"
import { createSessionContext, createTurnContext } from "./context.js"
import { runAgentLoop } from "./loop.js"
import { SessionClosedError, SessionBusyError } from "./errors.js"
import type { EventBus } from "./events.js"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { snapshotState } from "./state.js"

/** Symbol.asyncDispose polyfill for Node.js 20 */
(Symbol as any).asyncDispose ??= Symbol.for("Symbol.asyncDispose")

/** Internal context passed from Agent to Session constructor. */
export interface SessionInternals {
  agentCtx: AgentContext & { _tools: Tool[] }
  middlewares: Middleware[]
  resolvedModel: LanguageModelV3 | null
  modelId: string
  callModel: (ctx: ModelContext) => Promise<ModelResponse>
  responseFormat?: { type: "json"; schema: Record<string, unknown>; name?: string }
  onClose: (session: Session) => void
}

/**
 * A first-class conversation session.
 *
 * Created by `agent.session()`. Holds conversation history and state
 * that persist across multiple turns. Turns execute sequentially.
 *
 * @example
 * ```typescript
 * const session = agent.session()
 * const r1 = await session.run("Hello").result
 * const r2 = await session.run("Follow up").result
 * await session.close()
 * ```
 */
export class Session {
  /** Unique session identifier. */
  readonly id: string
  /** Flat chronological conversation history, auto-accumulates across turns. */
  readonly history: Message[]
  /** Session state — read-only for client code. Middleware writes via ctx.state. */
  readonly state: Record<string, unknown>

  private readonly store: SessionStore
  private readonly internals: SessionInternals
  private closed = false
  private turnInProgress = false
  private turnIndex = 0
  private resolveSessionLifecycle: (() => void) | null = null
  private sessionOnionPromise: Promise<void> | null = null
  private sessionCtx: SessionContext | null = null
  private initPromise: Promise<void> | null = null

  /** @internal — use `agent.session()` to create sessions. */
  constructor(store: SessionStore, internals: SessionInternals) {
    this.store = store
    this.internals = internals
    this.id = store.id
    this.history = store.history
    this.state = store.state
  }

  /**
   * Initialize the session onion lifecycle.
   * Called by Agent.session() after construction.
   * @internal
   */
  async _initOnion(emitBus: EventBus): Promise<void> {
    this.store.start()

    const emitter = { emit: (event: StreamEvent) => emitBus.emit(event) }
    this.sessionCtx = createSessionContext(this.internals.agentCtx, this.store, emitter as any)

    let signalReady!: () => void
    const readyPromise = new Promise<void>((r) => (signalReady = r))

    const sessionBody = async () => {
      signalReady()
      await new Promise<void>((r) => {
        this.resolveSessionLifecycle = r
      })
    }

    this.sessionOnionPromise = composeHooks(this.internals.middlewares, "session", sessionBody)(this.sessionCtx)

    try {
      await Promise.race([readyPromise, this.sessionOnionPromise])
    } catch (err) {
      this.sessionOnionPromise = null
      this.resolveSessionLifecycle = null
      throw err
    }
  }

  /**
   * Execute a single conversational turn.
   *
   * Returns an `AgentRun` with dual interface: async iterable for streaming,
   * `.result` Promise for the final `RunResult`.
   *
   * @param input - User message text
   * @param opts - Optional run options (e.g., output schema)
   * @throws {SessionClosedError} If the session has been closed
   * @throws {SessionBusyError} If a turn is already in progress
   */
  run(input: string, opts?: RunOptions): AgentRun {
    if (this.closed) throw new SessionClosedError(this.id)
    if (this.turnInProgress) throw new SessionBusyError(this.id)

    const agentRun = new AgentRun()
    this.turnInProgress = true

    this.executeTurn(input, opts, agentRun)
      .catch((err) => {
        this.turnInProgress = false
        agentRun.fail(err instanceof Error ? err : new Error(String(err)))
      })

    return agentRun
  }

  /**
   * Close the session, triggering session-level middleware cleanup.
   * Idempotent — safe to call multiple times.
   */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true

    if (this.resolveSessionLifecycle) {
      this.resolveSessionLifecycle()
      await this.sessionOnionPromise
    }

    this.store.complete()
    this.internals.onClose(this)
  }

  /** Alias for close() — enables `await using session = agent.session()`. */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.close()
  }

  private async executeTurn(input: string, opts: RunOptions | undefined, agentRun: AgentRun): Promise<void> {
    // Wait for session onion init to complete
    if (this.initPromise) await this.initPromise
    if (!this.sessionCtx) throw new Error("Session not initialized")

    const inputMsg: Message = { role: "user", content: input }
    this.store.addMessage(inputMsg)

    const turnId = crypto.randomUUID()
    const currentTurnIndex = this.turnIndex++
    const turnCtx = createTurnContext(this.sessionCtx, [inputMsg], turnId, currentTurnIndex)

    // Wire events through to AgentRun via a wrapper that calls both
    const originalEmit = turnCtx.emit.bind(turnCtx)
    const wrappedEmit = (event: StreamEvent) => {
      originalEmit(event)
      agentRun.emit(event)
    }
    // Override emit on this context object (not via (as any) — turnCtx is a plain object)
    Object.defineProperty(turnCtx, "emit", { value: wrappedEmit, configurable: true })

    agentRun.emit({ type: "turn:start", turnIndex: currentTurnIndex, turnId })

    let turnText = ""
    let turnData: unknown = undefined

    const turnBody = async () => {
      const uniqueTools = (this.internals.agentCtx._tools ?? []).filter(
        (t, i, arr) => arr.findIndex((x) => x.name === t.name) === i,
      )

      const loopResult = await runAgentLoop(
        turnCtx,
        this.internals.resolvedModel,
        this.internals.modelId,
        uniqueTools,
        this.internals.middlewares,
        this.internals.callModel,
      )

      turnText = loopResult.text
      ;(turnCtx as { output: string | null }).output = loopResult.text
      this.store.addMessage({ role: "assistant", content: loopResult.text })

      // Parse structured output if schema provided
      if (opts?.output && loopResult.text) {
        let parsed: unknown
        try {
          parsed = JSON.parse(loopResult.text)
        } catch {
          throw new Error(`Structured output: model returned invalid JSON. Text: "${loopResult.text.slice(0, 200)}"`)
        }
        const validation = opts.output.safeParse(parsed)
        if (validation.success) {
          turnData = validation.data
        } else {
          throw new Error(`Structured output validation failed: ${JSON.stringify(validation.error.issues)}`)
        }
      }
    }

    const turnOnion = composeHooks(this.internals.middlewares, "turn", turnBody)
    await turnOnion(turnCtx)

    // After onion completes (all middleware after-next has run), snapshot state and complete
    this.turnInProgress = false
    agentRun.emit({ type: "turn:end", text: turnText })

    const result: RunResult = {
      text: turnText,
      state: snapshotState(this.store.state),
      data: turnData,
    }

    agentRun.complete(result)
  }
}
