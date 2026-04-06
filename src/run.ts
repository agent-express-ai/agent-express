import type { StreamEvent, RunResult } from "./types.js"
import { EventBus } from "./events.js"

/**
 * The return value of `agent.run()`. Dual interface inspired by `fetch()`:
 *
 * - **Streaming**: iterate with `for await (const event of run) { ... }`
 * - **Await result**: `const result = await run.result`
 *
 * Both can be used on the same `AgentRun` instance. The `.result` promise
 * resolves when the session completes (after all events have been emitted).
 *
 * @example
 * ```typescript
 * // Streaming
 * for await (const event of agent.run({ input: "Hello" })) {
 *   if (event.type === "model:chunk") process.stdout.write(event.text)
 * }
 *
 * // Await result
 * const { output, cost } = await agent.run({ input: "Hello" }).result
 * ```
 */
export class AgentRun implements AsyncIterable<StreamEvent> {
  private bus: EventBus

  /**
   * Promise that resolves to the final `RunResult` when the session completes.
   * Rejects if the session fails with an unhandled error.
   */
  readonly result: Promise<RunResult>

  private _resolveResult!: (result: RunResult) => void
  private _rejectResult!: (error: Error) => void

  constructor() {
    this.bus = new EventBus()
    this.result = new Promise<RunResult>((resolve, reject) => {
      this._resolveResult = resolve
      this._rejectResult = reject
    })
  }

  /** Emit a stream event to all iterating consumers. Called by the agent loop. */
  emit(event: StreamEvent): void {
    this.bus.emit(event)
  }

  /**
   * Signal successful completion. Emits `session:end`, closes the stream,
   * and resolves the `.result` promise.
   */
  complete(result: RunResult): void {
    this.bus.emit({ type: "session:end", result })
    this.bus.close()
    this._resolveResult(result)
  }

  /**
   * Signal failure. Emits an `error` event, closes the stream,
   * and rejects the `.result` promise.
   */
  fail(error: Error): void {
    this.bus.emit({ type: "error", error })
    this.bus.close()
    this._rejectResult(error)
  }

  /** Async iterator — yields `StreamEvent`s as they arrive during execution. */
  [Symbol.asyncIterator](): AsyncIterator<StreamEvent> {
    return this.bus[Symbol.asyncIterator]()
  }
}
