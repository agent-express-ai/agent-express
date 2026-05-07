import type { Message, RunOptions, RunResult, Tool, ModelResponse, Event, EventTypeMap } from "./types.js"
import type { Middleware, AgentContext, SessionContext, ModelContext } from "./middleware.js"
import { SessionState } from "./session-store.js"
import { AgentRun } from "./run.js"
import { composeHooks } from "./executor.js"
import { createSessionContext, createTurnContext } from "./context.js"
import { runAgentLoop } from "./loop.js"
import {
  AbortError,
  SessionClosedError,
  SessionBusyError,
  StructuredOutputParseError,
  StructuredOutputValidationError,
} from "./errors.js"
import type { Writer } from "./event-log/writer.js"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { zodToJsonSchema } from "./tools/zod-to-json.js"
import { callLanguageModel } from "./providers/adapter.js"
import { snapshotState } from "./state.js"

/** Symbol.asyncDispose polyfill for Node.js 20 */
;(Symbol as { asyncDispose?: symbol }).asyncDispose ??= Symbol.for("Symbol.asyncDispose")

/** Internal context passed from Agent to Session constructor. */
export interface SessionInternals {
  agentCtx: AgentContext & { _tools: Tool[] }
  middlewares: Middleware[]
  resolvedModel: LanguageModelV3 | null
  modelId: string
  callModel: (ctx: ModelContext) => Promise<ModelResponse>
  responseFormat?: { type: "json"; schema: Record<string, unknown>; name?: string }
  eventTypeMap: EventTypeMap
  writer: Writer | null
  onClose: (session: Session) => void
}

/**
 * A first-class conversation session.
 *
 * Created by `agent.session()`. Holds the canonical event log, derived
 * conversation history, and shared state across multiple turns. Turns
 * execute sequentially.
 *
 * @example
 * ```typescript
 * const session = agent.session()
 * const r1 = await session.run("Hello").result
 * const r2 = await session.run("Follow up").result
 * for (const event of session.events) {
 *   console.log(event.type, event.ts)
 * }
 * await session.close()
 * ```
 */
export class Session {
  /** Unique session identifier. */
  readonly id: string
  /** Session state — read-only for client code. Middleware writes via ctx.state. */
  readonly state: Record<string, unknown>

  private readonly store: SessionState
  private readonly internals: SessionInternals
  private closed = false
  private turnInProgress = false
  private turnIndex = 0
  private resolveSessionLifecycle: (() => void) | null = null
  private sessionOnionPromise: Promise<void> | null = null
  private sessionCtx: SessionContext | null = null
  private initPromise: Promise<void> | null = null

  /** @internal — use `agent.session()` to create sessions. */
  constructor(store: SessionState, internals: SessionInternals) {
    this.store = store
    this.internals = internals
    this.id = store.id
    this.state = store.state
  }

  /** Canonical append-only event log for this session. */
  get events(): readonly Event[] {
    return this.store.events
  }

  /** @internal — direct access to the underlying EventLog for framework wiring. */
  get _eventLog() {
    return this.store.eventLog
  }

  /**
   * Derived `Message[]` view of the conversation, computed from events
   * on read. Same shape as v0.3 `history` (`{ role, content }[]`).
   */
  get history(): Message[] {
    return this.store.history
  }

  /**
   * Initialize the session onion lifecycle.
   * Called by Agent.session() after construction.
   * @internal
   */
  async _initOnion(): Promise<void> {
    this.store.start()

    this.sessionCtx = createSessionContext(
      this.internals.agentCtx,
      this.store,
      this.internals.eventTypeMap,
      this.internals.writer,
    )

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
   * Returns an `AgentRun` with dual interface: async iterable for streaming
   * the events emitted during this turn, `.result` Promise for the final
   * `RunResult`.
   *
   * @param input - User message text
   * @param opts - Optional run options (e.g., output schema)
   * @throws {SessionClosedError} If the session has been closed
   * @throws {SessionBusyError} If a turn is already in progress
   */
  run(input: string, opts?: RunOptions): AgentRun {
    if (this.closed) throw new SessionClosedError(this.id)
    if (this.turnInProgress) throw new SessionBusyError(this.id)

    const agentRun = new AgentRun(this.store.eventLog)
    this.turnInProgress = true

    this.executeTurn(input, opts, agentRun).catch((err) => {
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
    this.internals.writer?.forget(this.id)
    this.internals.onClose(this)
  }

  /** Alias for close() — enables `await using session = agent.session()`. */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.close()
  }

  private async executeTurn(input: string, opts: RunOptions | undefined, agentRun: AgentRun): Promise<void> {
    if (this.initPromise) await this.initPromise
    const initError = (this as { _initError?: Error })._initError
    if (initError) throw initError
    if (!this.sessionCtx) throw new Error("Session not initialized")

    const turnId = crypto.randomUUID()
    const currentTurnIndex = this.turnIndex++
    const inputMsg: Message = { role: "user", content: input }
    const turnCtx = createTurnContext(this.sessionCtx, [inputMsg], turnId, currentTurnIndex)

    // Emit core lifecycle markers via the unified event log surface.
    turnCtx.emit({ type: "turn:start", payload: { turnIndex: currentTurnIndex, turnId } })
    turnCtx.emit({ type: "user:input", payload: { text: input } })

    let turnText = ""
    let turnData: unknown = undefined
    let turnStatus: "completed" | "interrupted" | "failed" = "completed"
    let caughtError: Error | null = null

    const turnBody = async () => {
      const uniqueTools = (this.internals.agentCtx._tools ?? []).filter(
        (t, i, arr) => arr.findIndex((x) => x.name === t.name) === i,
      )

      let callModel = this.internals.callModel
      if (opts?.output) {
        const jsonSchema = zodToJsonSchema(opts.output)
        const responseFormat = { type: "json" as const, schema: jsonSchema, name: "response" }
        callModel = async (ctx: ModelContext) => {
          ctx.addSystemMessage(
            `Respond with valid JSON matching this schema: ${JSON.stringify(jsonSchema)}. Do not include markdown code fences or any text outside the JSON object.`,
          )
          return callLanguageModel(this.internals.resolvedModel!, ctx, responseFormat)
        }
      }

      const loopResult = await runAgentLoop(
        turnCtx,
        this.internals.resolvedModel,
        this.internals.modelId,
        uniqueTools,
        this.internals.middlewares,
        callModel,
      )

      turnText = loopResult.text
      ;(turnCtx as { output: string | null }).output = loopResult.text

      if (opts?.output && loopResult.text) {
        let parsed: unknown
        try {
          parsed = JSON.parse(loopResult.text)
        } catch {
          throw new StructuredOutputParseError(loopResult.text)
        }
        const validation = opts.output.safeParse(parsed)
        if (validation.success) {
          turnData = validation.data
        } else {
          throw new StructuredOutputValidationError(validation.error.issues)
        }
      }
    }

    try {
      const turnOnion = composeHooks(this.internals.middlewares, "turn", turnBody)
      await turnOnion(turnCtx)
    } catch (err) {
      caughtError = err instanceof Error ? err : new Error(String(err))
      turnStatus = caughtError instanceof AbortError ? "interrupted" : "failed"
      turnCtx.emit({
        type: "error",
        payload: { kind: caughtError.name ?? "Error", message: caughtError.message },
      })
    }

    // Middleware may short-circuit (e.g., guard.rateLimit) by setting ctx.output
    // without calling next(). Prefer ctx.output over the loop result.
    const finalText = turnCtx.output ?? turnText

    // Emit the rolled-up assistant text + turn-end durability boundary.
    if (caughtError === null) {
      turnCtx.emit({ type: "model:response", payload: { text: finalText } })
    }
    turnCtx.emit({
      type: "turn:end",
      payload: { turnIndex: currentTurnIndex, turnId, text: finalText, status: turnStatus },
    })

    // Drain pending durable writes before reporting the turn done.
    if (this.internals.writer) {
      try {
        await this.internals.writer.drain(this.id)
      } catch (drainErr) {
        const err = drainErr instanceof Error ? drainErr : new Error(String(drainErr))
        this.turnInProgress = false
        agentRun.fail(err)
        return
      }
    }

    this.turnInProgress = false

    if (caughtError) {
      agentRun.fail(caughtError)
      return
    }

    const result: RunResult = {
      text: finalText,
      state: snapshotState(this.store.state),
      data: turnData,
    }
    agentRun.complete(result)
  }
}
