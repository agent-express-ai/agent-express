/**
 * @agent-express/session-postgres — PostgreSQL session store adapter.
 * For long-term persistence and audit trails.
 * @module session-postgres
 */
import type { SessionStore, SessionData, Message } from "agent-express"

export interface PostgresStoreConfig {
  /** PostgreSQL connection string. */
  connectionString: string
}

export function postgresStore(config: PostgresStoreConfig): SessionStore {
  const { connectionString } = config

  async function getClient() {
    const { default: pg } = await import("pg")
    const client = new pg.Client({ connectionString })
    await client.connect()
    return client
  }

  return {
    async load(sessionId) {
      const client = await getClient()
      try {
        const res = await client.query("SELECT state, created_at, updated_at FROM agent_sessions WHERE id = $1", [sessionId])
        if (res.rows.length === 0) return null
        const row = res.rows[0] as { state: string; created_at: string; updated_at: string }
        const msgs = await client.query("SELECT role, content FROM agent_messages WHERE session_id = $1 ORDER BY id ASC", [sessionId])
        const history = (msgs.rows as Array<{ role: string; content: string }>).map(m => ({ role: m.role as Message["role"], content: m.content }))
        return { state: JSON.parse(row.state), history, createdAt: row.created_at, updatedAt: row.updated_at }
      } finally { await client.end() }
    },

    async save(sessionId, data) {
      const client = await getClient()
      try {
        await client.query(
          `INSERT INTO agent_sessions (id, state, created_at, updated_at) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET state = $2, updated_at = $4`,
          [sessionId, JSON.stringify(data.state), data.createdAt, data.updatedAt],
        )
        await client.query("DELETE FROM agent_messages WHERE session_id = $1", [sessionId])
        for (const msg of data.history) {
          await client.query("INSERT INTO agent_messages (session_id, role, content) VALUES ($1, $2, $3)", [sessionId, msg.role, typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)])
        }
      } finally { await client.end() }
    },

    async delete(sessionId) {
      const client = await getClient()
      try {
        await client.query("DELETE FROM agent_messages WHERE session_id = $1", [sessionId])
        await client.query("DELETE FROM agent_sessions WHERE id = $1", [sessionId])
      } finally { await client.end() }
    },

    async add(sessionId, message) {
      const client = await getClient()
      try {
        await client.query("INSERT INTO agent_messages (session_id, role, content) VALUES ($1, $2, $3)", [sessionId, message.role, typeof message.content === "string" ? message.content : JSON.stringify(message.content)])
      } finally { await client.end() }
    },

    async list(sessionId, opts) {
      const client = await getClient()
      try {
        const order = opts?.order === "asc" ? "ASC" : "DESC"
        const limit = opts?.limit ?? 1000
        const offset = opts?.offset ?? 0
        const res = await client.query(`SELECT role, content FROM agent_messages WHERE session_id = $1 ORDER BY id ${order} LIMIT $2 OFFSET $3`, [sessionId, limit, offset])
        return (res.rows as Array<{ role: string; content: string }>).map(m => ({ role: m.role as Message["role"], content: m.content }))
      } finally { await client.end() }
    },
  }
}
