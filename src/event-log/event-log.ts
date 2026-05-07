/**
 * EventLog — the canonical per-session record.
 *
 * Holds the append-only `events: Event[]` array (synchronous,
 * read-your-writes — `Session.events` returns this array). Also notifies
 * subscribers on each append; `AgentRun` and the durable `Writer` both
 * subscribe so the same `Event` objects (same IDs) flow through streaming
 * consumers and adapter persistence.
 */

import type { Event } from "../types.js"

/** Subscriber callback for per-event side effects (e.g., writer queueing). */
export type EventSubscriber = (event: Event) => void

/**
 * Symbol attached to a `Middleware` instance to advertise that it provides
 * a `SessionStore`. The framework reads this at `agent.init()` time to wire
 * the durable-write `Writer` queue. Use the `memory.store()` middleware —
 * which sets this property — rather than setting it directly.
 */
export const SESSION_STORE_PROVIDER = Symbol.for("agent-express.session-store-provider")

/**
 * Per-session canonical event log.
 *
 * Append synchronous, read-your-writes. Multiple subscribers observe
 * each appended event; the framework subscribes the streaming `AgentRun`
 * iterator and (when configured) the durable `Writer` queue.
 */
export class EventLog {
  private readonly _events: Event[] = []
  private readonly subscribers: EventSubscriber[] = []
  private closed = false

  /** Read-only view of all events appended so far. */
  get events(): readonly Event[] {
    return this._events
  }

  /** True after `close()`; further `append` calls are silently dropped. */
  get isClosed(): boolean {
    return this.closed
  }

  /**
   * Replay events from a persisted source (e.g., `SessionStore.load`) into
   * the in-memory log. Skips events whose IDs are already present so this
   * is safe to call after partial writes. Used by `memory.store()` middleware
   * on session start to rehydrate prior history.
   */
  replay(events: Iterable<Event>): void {
    if (this.closed) return
    const known = new Set(this._events.map((e) => e.id))
    for (const event of events) {
      if (known.has(event.id)) continue
      this._events.push(event)
      known.add(event.id)
    }
  }

  /**
   * Append an event. Synchronous — by the time this returns, the event is
   * in `events` (read-your-writes), all subscribers have been notified,
   * and any waiting async-iterator consumer is unblocked.
   *
   * Subscriber exceptions are swallowed so a misbehaving subscriber cannot
   * stall the rest of the framework (other subscribers still fire, the
   * iterator still wakes). Subscribers that need their errors observed
   * should handle them internally.
   */
  append(event: Event): void {
    if (this.closed) return
    this._events.push(event)
    for (const sub of this.subscribers) {
      try {
        sub(event)
      } catch {
        // Defensive: a throwing subscriber must not break the log invariants.
      }
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
   * Mark the log as closed. Further `append` calls are silently dropped.
   * Subscribers are not unregistered — that's the caller's responsibility.
   */
  close(): void {
    this.closed = true
  }
}
