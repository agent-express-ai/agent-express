import type { Event, RunResult } from "./types.js"
import type { EventLog } from "./event-log/event-log.js"

/**
 * The return value of `agent.run()` and `session.run()`. Dual interface
 * inspired by `fetch()`:
 *
 * - **Streaming**: iterate with `for await (const event of run) { ... }` —
 *   yields the same `Event` objects (same IDs) that appear in
 *   `session.events`.
 * - **Await result**: `const result = await run.result`.
 *
 * Per-run iteration scope: an `AgentRun` yields only the events emitted
 * during its turn. The cursor is captured at construction; the iterator
 * stops once `complete()` or `fail()` is called.
 *
 * @example
 * ```typescript
 * for await (const event of agent.run({ input: "Hello" })) {
 *   if (event.type === "model:chunk") {
 *     const { text } = event.payload as { text: string }
 *     process.stdout.write(text)
 *   }
 * }
 *
 * const { text } = await agent.run({ input: "Hello" }).result
 * ```
 */
export class AgentRun implements AsyncIterable<Event> {
  /**
   * Promise that resolves to the final `RunResult` when the turn completes.
   * Rejects if the turn fails with an unhandled error.
   */
  readonly result: Promise<RunResult>

  private readonly eventLog: EventLog
  private readonly cursor: number
  private readonly unsubscribe: () => void
  private wakeup: (() => void) | null = null
  /** Set by the subscriber to bridge events that land between yields. */
  private pending = false
  private stopped = false
  /** Frozen log length at completion — events appended later belong to the next run. */
  private stopAt: number | null = null
  private _resolveResult!: (result: RunResult) => void
  private _rejectResult!: (error: Error) => void

  constructor(eventLog: EventLog) {
    this.eventLog = eventLog
    this.cursor = eventLog.events.length
    this.result = new Promise<RunResult>((resolve, reject) => {
      this._resolveResult = resolve
      this._rejectResult = reject
    })
    this.unsubscribe = eventLog.subscribe(() => {
      this.pending = true
      if (this.wakeup) {
        this.wakeup()
        this.wakeup = null
      }
    })
  }

  /** Resolve the result promise and stop the iterator at the current log position. */
  complete(result: RunResult): void {
    this.freezeAndStop()
    this._resolveResult(result)
  }

  /**
   * Reject the result promise and stop the iterator at the current log position.
   * Any preceding `error` event is appended via `ctx.emit` before this is called.
   */
  fail(error: Error): void {
    this.freezeAndStop()
    this._rejectResult(error)
  }

  /**
   * Async iterator over events from the run's cursor up to where the run
   * was completed/failed. If iterated before completion, awaits new events
   * as they arrive.
   */
  async *[Symbol.asyncIterator](): AsyncIterator<Event> {
    let i = this.cursor
    while (true) {
      const limit = this.stopAt ?? this.eventLog.events.length
      while (i < limit) {
        yield this.eventLog.events[i]!
        i++
      }
      // After yielding, the log may have grown (events emitted during the
      // yield) and stopAt may have been frozen at a higher index. Re-loop to
      // pick up any events we owe before considering the run finished.
      if (i < (this.stopAt ?? this.eventLog.events.length)) continue
      if (this.stopped) return
      if (this.pending) {
        this.pending = false
        continue
      }
      await new Promise<void>((r) => {
        this.wakeup = r
      })
      this.pending = false
    }
  }

  private freezeAndStop(): void {
    if (this.stopped) return
    this.stopAt = this.eventLog.events.length
    this.stopped = true
    this.unsubscribe()
    if (this.wakeup) {
      this.wakeup()
      this.wakeup = null
    }
  }
}
