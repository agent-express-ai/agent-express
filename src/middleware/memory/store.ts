import type { Middleware, SessionContext } from "../../middleware.js"
import type { SessionStore, SessionData, Message } from "../../types.js"

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
  const { backend, ttl } = config

  return {
    name: "memory:store",

    async session(ctx: SessionContext, next: () => Promise<void>): Promise<void> {
      let backendAvailable = true

      // Load session if it exists
      try {
        const data = await backend.load(ctx.sessionId)
        if (data) {
          // Restore state
          for (const [key, value] of Object.entries(data.state)) {
            ctx.state[key] = value
          }
          // Restore history
          for (const msg of data.history) {
            ctx.history.push(msg)
          }
        }
      } catch {
        // Fallback to in-memory — log warning but don't block
        backendAvailable = false
      }

      try {
        await next()
      } finally {
        // Save session after all turns complete
        if (backendAvailable) {
          try {
            const sessionData: SessionData = {
              state: { ...ctx.state },
              history: [...ctx.history],
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
