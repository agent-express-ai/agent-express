import type { Middleware, SessionContext } from "../../middleware.js"
import type { SessionStore } from "../../types.js"
import { SESSION_STORE_PROVIDER } from "../../event-log/event-log.js"

/**
 * Configuration for the `memory.store()` middleware.
 */
export interface MemoryStoreConfig {
  /** Session store backend implementing SessionStore interface. */
  backend: SessionStore
  /** Session TTL in seconds. Backends that support expiration will auto-cleanup. */
  ttl?: number
}

/**
 * Creates a `memory.store()` middleware for session persistence.
 *
 * On session start, restores `state` and replays any prior events from the
 * backend into the session's event log so multi-turn conversations resume
 * cleanly. Per-event durable writes go through `SessionStore.appendEvent`
 * automatically — the framework's `Writer` queue picks up the backend
 * advertised by this middleware via the `SESSION_STORE_PROVIDER` symbol.
 *
 * @param config - SessionStore backend and options
 * @returns Middleware
 *
 * @example
 * ```typescript
 * import { memory } from "agent-express"
 * import { sqliteStore } from "@agent-express/session-sqlite"
 *
 * agent.use(memory.store({ backend: sqliteStore({ path: "./sessions.db" }) }))
 * ```
 */
export function memoryStore(config: MemoryStoreConfig): Middleware {
  const { backend } = config

  return {
    name: "memory:store",
    [SESSION_STORE_PROVIDER]: backend,

    async session(ctx: SessionContext, next: () => Promise<void>): Promise<void> {
      // Restore state and replay prior events. Per-event durable writes during
      // the session are handled by the framework's Writer queue (wired up at
      // agent.init via the SESSION_STORE_PROVIDER symbol on this middleware).
      try {
        const data = await backend.load(ctx.sessionId)
        if (data) {
          for (const [key, value] of Object.entries(data.state)) {
            ctx.state[key] = value
          }
          const session = (ctx as SessionContext & { _session?: { eventLog?: { replay?: (events: unknown[]) => void } } })._session
          const replay = session?.eventLog?.replay
          if (replay && data.events.length > 0) {
            replay.call(session.eventLog, data.events.map((e) => ({
              id: e.eventId,
              ts: e.ts,
              type: e.type,
              schemaVersion: e.schemaVersion,
              payload: e.payload,
            })))
          }
        }
      } catch {
        // Backend unavailable — fall back to in-memory only.
      }

      await next()

      // No end-of-session save: events are persisted per-emit through the
      // framework's Writer queue. The state snapshot doesn't need a separate
      // round-trip — it's recoverable from the events on next load.
    },
  } as Middleware
}
