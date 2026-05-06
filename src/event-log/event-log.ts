/**
 * EventLog — the canonical per-session record.
 *
 * Replaces the v0.3 `EventBus` (single-purpose async iterator buffer for
 * streaming) with a unified primitive that:
 *
 * 1. Holds the canonical, append-only `events: Event[]` array (synchronous,
 *    read-your-writes — `Session.events` returns this array).
 * 2. Exposes a single-consumer async iterator (live tail) for `AgentRun`
 *    streaming consumers. Same events surface through both paths.
 * 3. Emits durable-write requests to a `Writer` (queues to
 *    `SessionStore.appendEvent`) — best-effort durability within the
 *    `turn:end` boundary.
 *
 * All three surfaces — `events`, the async iterator, and the durable writer
 * — see exactly the same event objects with the same IDs.
 */

import type { Event } from "../types.js"

/** Subscriber callback for per-event side effects (e.g., writer queueing). */
export type EventSubscriber = (event: Event) => void

/**
 * Per-session canonical event log.
 *
 * Append synchronous, read-your-writes. Multiple subscribers may observe
 * each appended event; one async iterator consumer per log (designed for
 * the AgentRun consumer pattern — adding more would lose events).
 */
export class EventLog {
  private readonly _events: Event[] = []
  private readonly subscribers: EventSubscriber[] = []
  private resolveWaiter: (() => void) | null = null
  private closed = false
  private iterCursor = 0

  /** Read-only view of all events appended so far. */
  get events(): readonly Event[] {
    return this._events
  }

  /** True after `close()`; further `append` calls are silently dropped. */
  get isClosed(): boolean {
    return this.closed
  }

  /**
   * Append an event. Synchronous — by the time this returns, the event is
   * in `events` (FR-012 read-your-writes), all subscribers have been
   * notified, and any waiting async-iterator consumer is unblocked.
   */
  append(event: Event): void {
    if (this.closed) return
    this._events.push(event)
    for (const sub of this.subscribers) sub(event)
    if (this.resolveWaiter) {
      this.resolveWaiter()
      this.resolveWaiter = null
    }
  }

  /**
   * Subscribe to per-event side effects. Returns an unsubscribe function.
   * Used by the durable writer to queue each event for adapter persistence.
   */
  subscribe(sub: EventSubscriber): () => void {
    this.subscribers.push(sub)
    return () => {
      const idx = this.subscribers.indexOf(sub)
      if (idx >= 0) this.subscribers.splice(idx, 1)
    }
  }

  /**
   * Signal that no more events will be emitted. The async iterator drains
   * the remaining buffer then returns.
   */
  close(): void {
    this.closed = true
    if (this.resolveWaiter) {
      this.resolveWaiter()
      this.resolveWaiter = null
    }
  }

  /**
   * Async iterator for streaming consumers. Yields events in order as they
   * are appended; awaits when caught up to the tail. Returns when `close()`
   * has been called and the buffer is fully drained.
   *
   * Single-consumer by design (matches the AgentRun streaming pattern).
   * Multiple iterators on the same log compete for the same cursor and
   * will each see only a subset of events.
   */
  async *[Symbol.asyncIterator](): AsyncIterator<Event> {
    while (true) {
      if (this.iterCursor < this._events.length) {
        const event = this._events[this.iterCursor]!
        this.iterCursor++
        yield event
      } else if (this.closed) {
        return
      } else {
        await new Promise<void>((r) => {
          this.resolveWaiter = r
        })
      }
    }
  }
}
