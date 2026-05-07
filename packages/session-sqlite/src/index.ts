/**
 * @agent-express/session-sqlite
 *
 * SQLite-backed event-log session store. Stores per-session events with
 * `(session_id, event_id)` uniqueness for idempotent re-emit. Best-effort
 * durability — WAL=NORMAL, no per-event fsync.
 *
 * Recommended for development and single-process deployments.
 *
 * @module session-sqlite
 */

import type { SessionStore, SessionData, EventEnvelope } from "agent-express"
import { createRequire } from "module"

/**
 * Configuration for the SQLite session store.
 */
export interface SqliteStoreConfig {
  /** Path to SQLite database file. Default: "./sessions.db". */
  path?: string
}

/**
 * Creates a SQLite-backed SessionStore.
 *
 * @param config - Database path
 * @returns SessionStore implementation
 *
 * @example
 * ```typescript
 * import { memory } from "agent-express"
 * import { sqliteStore } from "@agent-express/session-sqlite"
 *
 * agent.use(memory.store({ backend: sqliteStore({ path: "./sessions.db" }) }))
 * ```
 */
export function sqliteStore(config?: SqliteStoreConfig): SessionStore {
  const dbPath = config?.path ?? "./sessions.db"

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any = null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function getDb(): any {
    if (!db) {
      const req = createRequire(import.meta.url)
      const Database = req("better-sqlite3")
      db = new Database(dbPath)
      db.pragma("journal_mode = WAL")
      db.pragma("synchronous = NORMAL")
      db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          state TEXT NOT NULL DEFAULT '{}',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS events (
          session_id TEXT NOT NULL,
          event_id TEXT NOT NULL,
          ord INTEGER NOT NULL,
          ts INTEGER NOT NULL,
          type TEXT NOT NULL,
          schema_ver INTEGER NOT NULL,
          payload TEXT NOT NULL,
          PRIMARY KEY (session_id, event_id),
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_events_session_ord ON events(session_id, ord);
      `)
    }
    return db
  }

  function ensureSession(sessionId: string): void {
    const d = getDb()
    const now = Date.now()
    d.prepare(
      `INSERT INTO sessions (id, state, created_at, updated_at) VALUES (?, '{}', ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    ).run(sessionId, now, now)
  }

  return {
    async load(sessionId: string): Promise<SessionData | null> {
      const d = getDb()
      const row = d
        .prepare("SELECT state, created_at, updated_at FROM sessions WHERE id = ?")
        .get(sessionId) as { state: string; created_at: number; updated_at: number } | undefined
      if (!row) return null

      const rows = d
        .prepare(
          "SELECT event_id, ord, ts, type, schema_ver, payload FROM events WHERE session_id = ? ORDER BY ord ASC",
        )
        .all(sessionId) as Array<{
        event_id: string
        ord: number
        ts: number
        type: string
        schema_ver: number
        payload: string
      }>

      const events: EventEnvelope[] = rows.map((r) => ({
        sessionId,
        eventId: r.event_id,
        ord: r.ord,
        ts: r.ts,
        type: r.type,
        schemaVersion: r.schema_ver,
        payload: JSON.parse(r.payload) as unknown,
      }))

      return {
        state: JSON.parse(row.state) as Record<string, unknown>,
        events,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    },

    async save(sessionId: string, data: SessionData): Promise<void> {
      const d = getDb()
      const tx = d.transaction(() => {
        d.prepare(
          `INSERT INTO sessions (id, state, created_at, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
        ).run(sessionId, JSON.stringify(data.state), data.createdAt, data.updatedAt)

        const insert = d.prepare(
          `INSERT INTO events (session_id, event_id, ord, ts, type, schema_ver, payload)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(session_id, event_id) DO NOTHING`,
        )
        for (const e of data.events) {
          insert.run(sessionId, e.eventId, e.ord, e.ts, e.type, e.schemaVersion, JSON.stringify(e.payload))
        }
      })
      tx()
    },

    async delete(sessionId: string): Promise<void> {
      const d = getDb()
      // FK cascade deletes events.
      d.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId)
      // Defensive: also clean events orphaned by older schemas without FK enforcement.
      d.prepare("DELETE FROM events WHERE session_id = ?").run(sessionId)
    },

    async appendEvent(sessionId: string, envelope: EventEnvelope): Promise<void> {
      const d = getDb()
      ensureSession(sessionId)
      d.prepare(
        `INSERT INTO events (session_id, event_id, ord, ts, type, schema_ver, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, event_id) DO NOTHING`,
      ).run(
        sessionId,
        envelope.eventId,
        envelope.ord,
        envelope.ts,
        envelope.type,
        envelope.schemaVersion,
        JSON.stringify(envelope.payload),
      )
      d.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(Date.now(), sessionId)
    },

    async listEvents(
      sessionId: string,
      opts?: { limit?: number; offset?: number; order?: "asc" | "desc" },
    ): Promise<EventEnvelope[]> {
      const d = getDb()
      // ORDER BY ${order} interpolation is safe — `order` is constrained
      // to "ASC"/"DESC" by the explicit ternary, never a user-supplied string.
      const order = opts?.order === "desc" ? "DESC" : "ASC"
      const limit = opts?.limit ?? 1000
      const offset = opts?.offset ?? 0

      const rows = d
        .prepare(
          `SELECT event_id, ord, ts, type, schema_ver, payload
             FROM events WHERE session_id = ? ORDER BY ord ${order} LIMIT ? OFFSET ?`,
        )
        .all(sessionId, limit, offset) as Array<{
        event_id: string
        ord: number
        ts: number
        type: string
        schema_ver: number
        payload: string
      }>

      return rows.map((r) => ({
        sessionId,
        eventId: r.event_id,
        ord: r.ord,
        ts: r.ts,
        type: r.type,
        schemaVersion: r.schema_ver,
        payload: JSON.parse(r.payload) as unknown,
      }))
    },
  }
}
