/**
 * @agent-express/session-sqlite
 *
 * SQLite session store adapter for agent-express.
 * Zero external infrastructure — stores sessions in a local file.
 * Recommended for development and single-instance deployments.
 *
 * @module session-sqlite
 */

import type { SessionStore, SessionData, Message } from "agent-express"
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

  // Lazy init — don't import better-sqlite3 until first use
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any = null

  function getDb(): any {
    if (!db) {
      const req = createRequire(import.meta.url)
      const Database = req("better-sqlite3")
      db = new Database(dbPath)
      db.pragma("journal_mode = WAL")
      db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          state TEXT NOT NULL DEFAULT '{}',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
      `)
    }
    return db
  }

  return {
    async load(sessionId: string): Promise<SessionData | null> {
      const d = getDb()
      const row = d.prepare("SELECT state, created_at, updated_at FROM sessions WHERE id = ?").get(sessionId) as
        | { state: string; created_at: number; updated_at: number }
        | undefined

      if (!row) return null

      const messages = d
        .prepare("SELECT role, content FROM messages WHERE session_id = ? ORDER BY id ASC")
        .all(sessionId) as Array<{ role: string; content: string }>

      const history: Message[] = messages.map((m) => ({
        role: m.role as Message["role"],
        content: m.content,
      }))

      return {
        state: JSON.parse(row.state) as Record<string, unknown>,
        history,
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

        // Replace all messages
        d.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId)
        const insert = d.prepare("INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)")
        for (const msg of data.history) {
          insert.run(sessionId, msg.role, typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content))
        }
      })
      tx()
    },

    async delete(sessionId: string): Promise<void> {
      const d = getDb()
      d.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId)
      d.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId)
    },

    async add(sessionId: string, message: Message): Promise<void> {
      const d = getDb()
      // Ensure session exists
      const now = Date.now()
      d.prepare(
        `INSERT INTO sessions (id, created_at, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET updated_at = ?`,
      ).run(sessionId, now, now, now)
      d.prepare("INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)").run(
        sessionId,
        message.role,
        typeof message.content === "string" ? message.content : JSON.stringify(message.content),
      )
    },

    async list(sessionId: string, opts?: { limit?: number; offset?: number; order?: "asc" | "desc" }): Promise<Message[]> {
      const d = getDb()
      const order = opts?.order === "asc" ? "ASC" : "DESC"
      const limit = opts?.limit ?? 1000
      const offset = opts?.offset ?? 0

      const rows = d
        .prepare(`SELECT role, content FROM messages WHERE session_id = ? ORDER BY id ${order} LIMIT ? OFFSET ?`)
        .all(sessionId, limit, offset) as Array<{ role: string; content: string }>

      return rows.map((m) => ({
        role: m.role as Message["role"],
        content: m.content,
      }))
    },
  }
}
