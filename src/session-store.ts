import type { Message, StateSchema, Event } from "./types.js"
import { createSessionState, snapshotState } from "./state.js"
import { EventLog } from "./event-log/event-log.js"
import { deriveHistory } from "./event-log/derive-history.js"

/** Possible lifecycle states for a session. */
export type SessionStatus = "created" | "running" | "completed" | "failed"

/**
 * Internal runtime state of one session.
 *
 * Owns the canonical {@link EventLog} for the session and exposes a
 * derived `Message[]` view via {@link history}. State (middleware data
 * + developer keys) lives on a separate object — events are the
 * canonical record of what happened, state is the projection of
 * accumulated effects.
 *
 * Public consumers should not touch this class directly — use the public
 * `Session` surface (`session.events`, `session.history`, `session.state`).
 */
export class SessionState {
  /** Unique session identifier (auto-generated UUID or user-provided). */
  readonly id: string

  /** Current lifecycle state. Transitions: created → running → completed | failed. */
  status: SessionStatus = "created"

  /**
   * Session state shared across all turns and middleware.
   * Created from merged middleware `state` declarations.
   */
  readonly state: Record<string, unknown>

  /** Canonical append-only event log for this session. */
  readonly eventLog: EventLog = new EventLog()

  /** Timestamp when the session was created. */
  readonly startedAt: number

  /**
   * Optional maximum number of derived history entries to keep visible.
   * The events themselves are never trimmed (append-only log) — `maxHistory`
   * only bounds the {@link history} view used for context windowing.
   */
  readonly maxHistory: number | undefined

  /**
   * @param sessionId - Optional custom session ID. Auto-generated UUID if omitted.
   * @param stateSchemas - State declarations from all middleware that declare `state`.
   * @param maxHistory - Optional bound on the derived history view.
   */
  constructor(sessionId: string | undefined, stateSchemas: StateSchema[], maxHistory?: number) {
    this.id = sessionId ?? crypto.randomUUID()
    this.state = createSessionState(stateSchemas)
    this.startedAt = Date.now()
    this.maxHistory = maxHistory
  }

  /** All events emitted in this session so far. */
  get events(): readonly Event[] {
    return this.eventLog.events
  }

  /**
   * Derived `Message[]` view computed from {@link events} on read.
   *
   * Replaces v0.3's mutable `history` array. The events are the canonical
   * record; the `Message[]` view is recomputed each call. For typical
   * sessions (10–100 events) the cost is microseconds.
   */
  get history(): Message[] {
    return deriveHistory(this.eventLog.events, this.maxHistory)
  }

  /** Transition from `created` to `running`. Throws if not in `created` state. */
  start(): void {
    if (this.status !== "created") {
      throw new Error(`Cannot start session in state: ${this.status}`)
    }
    this.status = "running"
  }

  /** Transition to `completed` state. */
  complete(): void {
    this.status = "completed"
    this.eventLog.close()
  }

  /** Transition to `failed` state. */
  fail(): void {
    this.status = "failed"
    this.eventLog.close()
  }

  /**
   * Returns a deep copy of the current session state.
   * Safe to include in `RunResult` — mutations to the snapshot don't affect the session.
   */
  snapshotState(): Record<string, unknown> {
    return snapshotState(this.state)
  }
}
