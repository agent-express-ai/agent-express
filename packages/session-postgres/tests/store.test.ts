import { describe, it, expect, beforeEach, vi } from "vitest"
import type { EventEnvelope, SessionStore } from "agent-express"

vi.mock("pg", () => {
  const sessions = new Map<string, { state: unknown; created_at: number; updated_at: number }>()
  const events = new Map<string, Map<string, EventEnvelope>>() // sessionId -> Map<eventId, envelope>

  function eventsFor(sessionId: string): Map<string, EventEnvelope> {
    let m = events.get(sessionId)
    if (!m) { m = new Map(); events.set(sessionId, m) }
    return m
  }

  // Naive query parser supporting the SQL the postgres adapter issues.
  async function query(sql: string, params: unknown[] = []): Promise<{ rows: unknown[] }> {
    if (sql.includes("CREATE TABLE")) return { rows: [] }
    if (sql.includes("INSERT INTO agent_sessions")) {
      const id = String(params[0])
      const state = sql.includes("'{}'::jsonb") ? {} : (typeof params[1] === "string" ? JSON.parse(params[1]) : params[1])
      const created = Number(params.length === 4 ? params[2] : params[1])
      const updated = Number(params.length === 4 ? params[3] : params[1])
      const onConflict = sql.includes("DO UPDATE")
      const existing = sessions.get(id)
      if (!existing) {
        sessions.set(id, { state, created_at: created, updated_at: updated })
      } else if (onConflict) {
        sessions.set(id, { ...existing, state, updated_at: updated })
      }
      return { rows: [] }
    }
    if (sql.includes("INSERT INTO agent_events")) {
      const sessionId = String(params[0])
      const eventId = String(params[1])
      const map = eventsFor(sessionId)
      if (!map.has(eventId)) {
        const payload = typeof params[6] === "string" ? JSON.parse(params[6] as string) : params[6]
        map.set(eventId, {
          sessionId,
          eventId,
          ord: Number(params[2]),
          ts: Number(params[3]),
          type: String(params[4]),
          schemaVersion: Number(params[5]),
          payload,
        })
      }
      return { rows: [] }
    }
    if (sql.includes("UPDATE agent_sessions")) {
      const updated = Number(params[0])
      const id = String(params[1])
      const existing = sessions.get(id)
      if (existing) sessions.set(id, { ...existing, updated_at: updated })
      return { rows: [] }
    }
    if (sql.includes("SELECT state, created_at, updated_at FROM agent_sessions")) {
      const id = String(params[0])
      const s = sessions.get(id)
      if (!s) return { rows: [] }
      return { rows: [{ state: s.state, created_at: s.created_at, updated_at: s.updated_at }] }
    }
    if (sql.includes("SELECT event_id, ord, ts, type, schema_ver, payload")) {
      const id = String(params[0])
      const list = [...(eventsFor(id).values())].sort((a, b) => a.ord - b.ord)
      const order = sql.includes("DESC") ? -1 : 1
      const sorted = order === -1 ? [...list].reverse() : list
      const limit = params[1] !== undefined ? Number(params[1]) : sorted.length
      const offset = params[2] !== undefined ? Number(params[2]) : 0
      return {
        rows: sorted.slice(offset, offset + limit).map((e) => ({
          event_id: e.eventId,
          ord: e.ord,
          ts: e.ts,
          type: e.type,
          schema_ver: e.schemaVersion,
          payload: e.payload,
        })),
      }
    }
    if (sql.includes("DELETE FROM agent_events")) {
      const id = String(params[0])
      events.delete(id)
      return { rows: [] }
    }
    if (sql.includes("DELETE FROM agent_sessions")) {
      const id = String(params[0])
      sessions.delete(id)
      return { rows: [] }
    }
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] }
    return { rows: [] }
  }

  function makeClient(): { query: typeof query; release: () => void } {
    return { query, release: () => {} }
  }
  class Pool {
    async query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }> { return query(sql, params ?? []) }
    async connect(): Promise<{ query: typeof query; release: () => void }> { return makeClient() }
  }

  return { default: { Pool }, Pool }
})

import { postgresStore } from "../src/index.js"

function envelope(sessionId: string, eventId: string, ord: number, type = "user:input", payload: unknown = { text: "x" }): EventEnvelope {
  return { sessionId, eventId, ord, ts: Date.now(), type, schemaVersion: 1, payload }
}

describe("postgresStore", () => {
  let store: SessionStore

  beforeEach(() => {
    store = postgresStore({ connectionString: "postgres://test/test" })
  })

  it("returns null for nonexistent session", async () => {
    expect(await store.load("missing")).toBeNull()
  })

  it("appendEvent persists with idempotent re-emit", async () => {
    await store.appendEvent("s1", envelope("s1", "e1", 0, "user:input", { text: "hi" }))
    await store.appendEvent("s1", envelope("s1", "e1", 0)) // duplicate
    const loaded = await store.load("s1")
    expect(loaded!.events).toHaveLength(1)
    expect(loaded!.events[0]!.payload).toEqual({ text: "hi" })
  })

  it("listEvents respects limit/offset/order", async () => {
    for (let i = 0; i < 4; i++) {
      await store.appendEvent("s2", envelope("s2", `e${i}`, i))
    }
    const asc = await store.listEvents("s2", { order: "asc", limit: 2 })
    expect(asc.map((e) => e.eventId)).toEqual(["e0", "e1"])
    const desc = await store.listEvents("s2", { order: "desc", limit: 2 })
    expect(desc.map((e) => e.eventId)).toEqual(["e3", "e2"])
  })

  it("save persists state + events transactionally", async () => {
    await store.save("s3", {
      state: { c: 1 },
      events: [envelope("s3", "e1", 0), envelope("s3", "e2", 1)],
      createdAt: 100,
      updatedAt: 200,
    })
    const loaded = await store.load("s3")
    expect(loaded!.state).toEqual({ c: 1 })
    expect(loaded!.events).toHaveLength(2)
  })

  it("delete removes session and its events", async () => {
    await store.appendEvent("s4", envelope("s4", "e1", 0))
    await store.delete("s4")
    expect(await store.load("s4")).toBeNull()
    expect(await store.listEvents("s4")).toEqual([])
  })

  it("preserves unknown event types verbatim", async () => {
    await store.appendEvent("s5", envelope("s5", "e1", 0, "channel:slack:inbound", { channel: "C1" }))
    const loaded = await store.load("s5")
    expect(loaded!.events[0]!.type).toBe("channel:slack:inbound")
    expect(loaded!.events[0]!.payload).toEqual({ channel: "C1" })
  })
})
