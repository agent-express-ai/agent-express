import type { Message, StateSchema } from "./types.js"
import { createSessionState, snapshotState } from "./state.js"

/** Possible lifecycle states for a session. */
export type SessionStatus = "created" | "running" | "completed" | "failed"

/**
 * Represents a single conversation session.
 *
 * A session is created for each `agent.run()` call. It holds the conversation
 * history (append-only), session state (from middleware declarations), and
 * tracks lifecycle transitions.
 *
 * Sessions are in-memory for now — no persistence across process restarts.
 * Durable sessions (checkpoint/resume) are planned for Phase 6.
 */
export class SessionStore {
  /** Unique session identifier (auto-generated UUID or user-provided). */
  readonly id: string

  /** Current lifecycle state. Transitions: created → running → completed | failed. */
  status: SessionStatus = "created"

  /**
   * Session state shared across all turns and middleware.
   * Created from merged middleware `state` declarations.
   * Supports typed defaults and optional reducers.
   */
  readonly state: Record<string, unknown>

  /** Append-only conversation history. Contains all user, assistant, and tool messages. */
  readonly history: Message[] = []

  /** Timestamp when the session was created. */
  readonly startedAt: number

  /**
   * Optional maximum number of messages to keep in history.
   * When exceeded, oldest messages are dropped (FIFO).
   * Prevents unbounded memory growth in long-running sessions.
   * Default: undefined (no limit).
   */
  readonly maxHistory: number | undefined

  /**
   * @param sessionId - Optional custom session ID. Auto-generated UUID if omitted.
   * @param stateSchemas - State declarations from all middleware that declare `state`.
   * @param maxHistory - Optional maximum history length. Oldest messages are dropped when exceeded.
   */
  constructor(sessionId: string | undefined, stateSchemas: StateSchema[], maxHistory?: number) {
    this.id = sessionId ?? crypto.randomUUID()
    this.state = createSessionState(stateSchemas)
    this.startedAt = Date.now()
    this.maxHistory = maxHistory
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
  }

  /** Transition to `failed` state. */
  fail(): void {
    this.status = "failed"
  }

  /** Append a message to the conversation history. Trims oldest if maxHistory is set. */
  addMessage(msg: Message): void {
    this.history.push(msg)
    if (this.maxHistory && this.history.length > this.maxHistory) {
      this.history.splice(0, this.history.length - this.maxHistory)
    }
  }

  /**
   * Returns a deep copy of the current session state.
   * Safe to include in `RunResult` — mutations to the snapshot don't affect the session.
   */
  snapshotState(): Record<string, unknown> {
    return snapshotState(this.state)
  }
}
