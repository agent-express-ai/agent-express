import { describe, it, expect, beforeEach, vi } from "vitest"
import type { EventEnvelope, SessionStore } from "agent-express"

vi.mock("ioredis", () => {
  // Minimal in-memory ioredis double covering the API our adapter uses.
  class MemRedis {
    private kv = new Map<string, Map<string, string> | string | Set<string> | Map<number, string>>()

    private getMap(k: string): Map<string, string> {
      let m = this.kv.get(k)
      if (!m) { m = new Map<string, string>(); this.kv.set(k, m) }
      return m as Map<string, string>
    }
    private getZset(k: string): Map<number, string> {
      let m = this.kv.get(k)
      if (!m) { m = new Map<number, string>(); this.kv.set(k, m) }
      return m as Map<number, string>
    }
    private getSet(k: string): Set<string> {
      let s = this.kv.get(k)
      if (!s) { s = new Set<string>(); this.kv.set(k, s) }
      return s as Set<string>
    }

    async hgetall(k: string): Promise<Record<string, string>> {
      const m = this.kv.get(k)
      if (!m || !(m instanceof Map)) return {}
      return Object.fromEntries(m.entries() as IterableIterator<[string, string]>) as Record<string, string>
    }
    async hset(k: string, fields: Record<string, string | number>): Promise<void> {
      const m = this.getMap(k)
      for (const [f, v] of Object.entries(fields)) m.set(f, String(v))
    }
    async zrange(k: string, start: number, stop: number): Promise<string[]> {
      const z = this.getZset(k)
      const sorted = [...z.entries()].sort(([a], [b]) => a - b).map(([, v]) => v)
      const realStop = stop === -1 ? sorted.length : stop + 1
      return sorted.slice(start, realStop)
    }
    async zrevrange(k: string, start: number, stop: number): Promise<string[]> {
      const list = await this.zrange(k, 0, -1)
      list.reverse()
      const realStop = stop === -1 ? list.length : stop + 1
      return list.slice(start, realStop)
    }
    async zadd(k: string, score: number, member: string): Promise<void> {
      this.getZset(k).set(score, member)
    }
    async sadd(k: string, member: string): Promise<void> {
      this.getSet(k).add(member)
    }
    async set(k: string, value: string): Promise<void> {
      this.kv.set(k, value)
    }
    async del(...keys: string[]): Promise<void> {
      for (const k of keys) this.kv.delete(k)
    }
    async expire(): Promise<void> { /* no-op */ }
    multi(): { hset: typeof this.hset; del: typeof this.del; set: typeof this.set; zadd: typeof this.zadd; sadd: typeof this.sadd; expire: typeof this.expire; exec: () => Promise<void> } {
      return {
        hset: (k, v) => this.hset(k, v),
        del: (...k) => this.del(...k),
        set: (k, v) => this.set(k, v),
        zadd: (k, s, m) => this.zadd(k, s, m),
        sadd: (k, m) => this.sadd(k, m),
        expire: () => this.expire(),
        exec: async () => {},
      }
    }
    async eval(_script: string, _numKeys: number, ...args: string[]): Promise<number> {
      const [sessionKey, eventsKey, idIndexKey, eventId, ord, ts, typ, schemaVer, payload, now] = args
      const idSet = this.getSet(idIndexKey)
      if (idSet.has(eventId)) return 0
      const ordNum = Number(ord)
      const member = JSON.stringify({
        eventId,
        ord: ordNum,
        ts: Number(ts),
        type: typ,
        schemaVersion: Number(schemaVer),
        payload: JSON.parse(payload),
      })
      this.getZset(eventsKey).set(ordNum, member)
      idSet.add(eventId)
      const sessionMap = this.getMap(sessionKey)
      if (sessionMap.size === 0) {
        sessionMap.set("state", "{}")
        sessionMap.set("created_at", now)
      }
      sessionMap.set("updated_at", now)
      return 1
    }
  }

  return { default: MemRedis, Redis: MemRedis }
})

import { redisStore } from "../src/index.js"

function envelope(sessionId: string, eventId: string, ord: number, type = "user:input", payload: unknown = { text: "x" }): EventEnvelope {
  return { sessionId, eventId, ord, ts: Date.now(), type, schemaVersion: 1, payload }
}

describe("redisStore", () => {
  let store: SessionStore

  beforeEach(() => {
    store = redisStore({ url: "redis://test" })
  })

  it("returns null for nonexistent session", async () => {
    expect(await store.load("missing")).toBeNull()
  })

  it("appendEvent persists an event with idempotent re-emit", async () => {
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

  it("delete removes session and its events", async () => {
    await store.appendEvent("s3", envelope("s3", "e1", 0))
    await store.delete("s3")
    expect(await store.load("s3")).toBeNull()
    expect(await store.listEvents("s3")).toEqual([])
  })

  it("preserves unknown event types verbatim", async () => {
    await store.appendEvent("s4", envelope("s4", "e1", 0, "channel:slack:inbound", { channel: "C1" }))
    const loaded = await store.load("s4")
    expect(loaded!.events[0]!.type).toBe("channel:slack:inbound")
    expect(loaded!.events[0]!.payload).toEqual({ channel: "C1" })
  })
})
