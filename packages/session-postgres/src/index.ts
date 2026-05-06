/**
 * @agent-express/session-postgres — PostgreSQL-backed event-log session store.
 *
 * Per-session events stored in `agent_events` with `(session_id, event_id)`
 * primary key for idempotent re-emit and `jsonb` payload for query-friendly
 * storage. Best-effort durability via default `synchronous_commit`.
 *
 * @module session-postgres
 */
import type { SessionStore, SessionData, EventEnvelope } from "agent-express"

export interface PostgresStoreConfig {
  /** PostgreSQL connection string. Default: process.env.DATABASE_URL. */
  connectionString?: string
}

export function postgresStore(config?: PostgresStoreConfig): SessionStore {
  const connectionString = config?.connectionString ?? process.env["DATABASE_URL"]
  if (!connectionString) {
    throw new Error("PostgreSQL connection string required. Set DATABASE_URL or pass connectionString.")
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pool: any = null
  let initialized = false

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function getPool(): Promise<any> {
    if (!pool) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pg = (await import("pg")) as any
      const Pg = pg.default ?? pg
      pool = new Pg.Pool({ connectionString })
    }
    if (!initialized) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS agent_sessions (
          id TEXT PRIMARY KEY,
          state JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS agent_events (
          session_id TEXT NOT NULL,
          event_id UUID NOT NULL,
          ord BIGINT NOT NULL,
          ts BIGINT NOT NULL,
          type TEXT NOT NULL,
          schema_ver INTEGER NOT NULL,
          payload JSONB NOT NULL,
          PRIMARY KEY (session_id, event_id)
        );
        CREATE INDEX IF NOT EXISTS idx_agent_events_session_ord ON agent_events(session_id, ord);
      `)
      initialized = true
    }
    return pool
  }

  async function ensureSession(sessionId: string): Promise<void> {
    const p = await getPool()
    const now = Date.now()
    await p.query(
      `INSERT INTO agent_sessions (id, state, created_at, updated_at)
       VALUES ($1, '{}'::jsonb, $2, $2)
       ON CONFLICT (id) DO NOTHING`,
      [sessionId, now],
    )
  }

  return {
    async load(sessionId: string): Promise<SessionData | null> {
      const p = await getPool()
      const res = await p.query(
        "SELECT state, created_at, updated_at FROM agent_sessions WHERE id = $1",
        [sessionId],
      )
      if (res.rows.length === 0) return null
      const row = res.rows[0] as { state: unknown; created_at: number; updated_at: number }

      const eventsRes = await p.query(
        `SELECT event_id, ord, ts, type, schema_ver, payload
           FROM agent_events WHERE session_id = $1 ORDER BY ord ASC`,
        [sessionId],
      )
      const events: EventEnvelope[] = (
        eventsRes.rows as Array<{
          event_id: string
          ord: number
          ts: number
          type: string
          schema_ver: number
          payload: unknown
        }>
      ).map((r) => ({
        sessionId,
        eventId: r.event_id,
        ord: Number(r.ord),
        ts: Number(r.ts),
        type: r.type,
        schemaVersion: r.schema_ver,
        payload: r.payload,
      }))

      const stateValue = typeof row.state === "string" ? (JSON.parse(row.state) as Record<string, unknown>) : (row.state as Record<string, unknown>)

      return {
        state: stateValue ?? {},
        events,
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
      }
    },

    async save(sessionId: string, data: SessionData): Promise<void> {
      const p = await getPool()
      const client = await p.connect()
      try {
        await client.query("BEGIN")
        await client.query(
          `INSERT INTO agent_sessions (id, state, created_at, updated_at)
             VALUES ($1, $2::jsonb, $3, $4)
             ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, updated_at = EXCLUDED.updated_at`,
          [sessionId, JSON.stringify(data.state), data.createdAt, data.updatedAt],
        )
        for (const e of data.events) {
          await client.query(
            `INSERT INTO agent_events (session_id, event_id, ord, ts, type, schema_ver, payload)
               VALUES ($1, $2::uuid, $3, $4, $5, $6, $7::jsonb)
               ON CONFLICT (session_id, event_id) DO NOTHING`,
            [sessionId, e.eventId, e.ord, e.ts, e.type, e.schemaVersion, JSON.stringify(e.payload)],
          )
        }
        await client.query("COMMIT")
      } catch (err) {
        await client.query("ROLLBACK")
        throw err
      } finally {
        client.release()
      }
    },

    async delete(sessionId: string): Promise<void> {
      const p = await getPool()
      await p.query("DELETE FROM agent_events WHERE session_id = $1", [sessionId])
      await p.query("DELETE FROM agent_sessions WHERE id = $1", [sessionId])
    },

    async appendEvent(sessionId: string, envelope: EventEnvelope): Promise<void> {
      await ensureSession(sessionId)
      const p = await getPool()
      await p.query(
        `INSERT INTO agent_events (session_id, event_id, ord, ts, type, schema_ver, payload)
           VALUES ($1, $2::uuid, $3, $4, $5, $6, $7::jsonb)
           ON CONFLICT (session_id, event_id) DO NOTHING`,
        [
          sessionId,
          envelope.eventId,
          envelope.ord,
          envelope.ts,
          envelope.type,
          envelope.schemaVersion,
          JSON.stringify(envelope.payload),
        ],
      )
      await p.query("UPDATE agent_sessions SET updated_at = $1 WHERE id = $2", [Date.now(), sessionId])
    },

    async listEvents(
      sessionId: string,
      opts?: { limit?: number; offset?: number; order?: "asc" | "desc" },
    ): Promise<EventEnvelope[]> {
      const p = await getPool()
      const order = opts?.order === "desc" ? "DESC" : "ASC"
      const limit = opts?.limit ?? 1000
      const offset = opts?.offset ?? 0
      const res = await p.query(
        `SELECT event_id, ord, ts, type, schema_ver, payload
           FROM agent_events WHERE session_id = $1 ORDER BY ord ${order} LIMIT $2 OFFSET $3`,
        [sessionId, limit, offset],
      )
      return (
        res.rows as Array<{
          event_id: string
          ord: number
          ts: number
          type: string
          schema_ver: number
          payload: unknown
        }>
      ).map((r) => ({
        sessionId,
        eventId: r.event_id,
        ord: Number(r.ord),
        ts: Number(r.ts),
        type: r.type,
        schemaVersion: r.schema_ver,
        payload: r.payload,
      }))
    },
  }
}
