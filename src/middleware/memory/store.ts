import type { Middleware, SessionContext } from "../../middleware.js"
import type { SessionStore, SessionData, EventEnvelope } from "../../types.js"

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
 * Loads session on creation, saves after each turn. Falls back to in-memory
 * on backend failure — user-facing functionality is never blocked.
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

    async session(ctx: SessionContext, next: () => Promise<void>): Promise<void> {
      let backendAvailable = true

      // TODO: replay events into Session.events when SessionContext exposes the event log.
      // For now, load restores state only; per-event writes go through SessionStore.appendEvent.
      try {
        const data = await backend.load(ctx.sessionId)
        if (data) {
          for (const [key, value] of Object.entries(data.state)) {
            ctx.state[key] = value
          }
        }
      } catch {
        backendAvailable = false
      }

      try {
        await next()
      } finally {
        if (backendAvailable) {
          try {
            // TODO: source events from Session.events once exposed; per-event persistence
            // goes through SessionStore.appendEvent during the turn.
            const events: EventEnvelope[] = []
            const sessionData: SessionData = {
              state: { ...ctx.state },
              events,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            }
            await backend.save(ctx.sessionId, sessionData)
          } catch {
            // Save failed — data stays in-memory only
          }
        }
      }
    },
  }
}
