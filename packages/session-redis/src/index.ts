/**
 * @agent-express/session-redis — Redis-backed event-log session store.
 *
 * Per-session events are stored in a sorted set keyed by `ord` (per-session
 * monotonic counter) with the JSON envelope as the member. Idempotent
 * `appendEvent` via Lua script that checks for existing eventId before adding.
 *
 * Best-effort durability — assumes AOF=everysec or similar.
 *
 * @module session-redis
 */
import type { SessionStore, SessionData, EventEnvelope } from "agent-express"

export interface RedisStoreConfig {
  /** Redis URL. Default: process.env.REDIS_URL or "redis://localhost:6379". */
  url?: string
  /** Key prefix. Default: "agent-express:session:". */
  prefix?: string
  /** TTL in seconds applied to session keys. */
  ttl?: number
}

const APPEND_LUA = `
local sessionKey = KEYS[1]
local eventsKey  = KEYS[2]
local idIndexKey = KEYS[3]

local eventId    = ARGV[1]
local ord        = tonumber(ARGV[2])
local ts         = tonumber(ARGV[3])
local typ        = ARGV[4]
local schemaVer  = tonumber(ARGV[5])
local payload    = ARGV[6]
local now        = tonumber(ARGV[7])
local ttl        = tonumber(ARGV[8])

if redis.call('SISMEMBER', idIndexKey, eventId) == 1 then
  return 0
end

local member = cjson.encode({
  eventId = eventId,
  ord = ord,
  ts = ts,
  type = typ,
  schemaVersion = schemaVer,
  payload = cjson.decode(payload),
})
redis.call('ZADD', eventsKey, ord, member)
redis.call('SADD', idIndexKey, eventId)

if redis.call('EXISTS', sessionKey) == 0 then
  redis.call('HSET', sessionKey,
    'state', '{}',
    'created_at', now,
    'updated_at', now)
else
  redis.call('HSET', sessionKey, 'updated_at', now)
end

if ttl > 0 then
  redis.call('EXPIRE', sessionKey, ttl)
  redis.call('EXPIRE', eventsKey, ttl)
  redis.call('EXPIRE', idIndexKey, ttl)
end

return 1
`

export function redisStore(config?: RedisStoreConfig): SessionStore {
  const url = config?.url ?? process.env["REDIS_URL"] ?? "redis://localhost:6379"
  const prefix = config?.prefix ?? "agent-express:session:"
  const ttl = config?.ttl ?? 0

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: any = null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function getClient(): Promise<any> {
    if (!client) {
      const ioredis = await import("ioredis")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Redis = (ioredis as { default?: unknown }).default ?? ioredis
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client = new (Redis as any)(url)
    }
    return client
  }

  const sessionKey = (id: string) => `${prefix}${id}`
  const eventsKey = (id: string) => `${prefix}${id}:events`
  const idIndexKey = (id: string) => `${prefix}${id}:event-ids`

  function applyTtl(pipeline: { expire: (k: string, t: number) => unknown }, sessionId: string): void {
    if (ttl > 0) {
      pipeline.expire(sessionKey(sessionId), ttl)
      pipeline.expire(eventsKey(sessionId), ttl)
      pipeline.expire(idIndexKey(sessionId), ttl)
    }
  }

  return {
    async load(sessionId: string): Promise<SessionData | null> {
      const r = await getClient()
      const meta = await r.hgetall(sessionKey(sessionId))
      if (!meta || Object.keys(meta).length === 0) return null

      const members = (await r.zrange(eventsKey(sessionId), 0, -1)) as string[]
      const events: EventEnvelope[] = members.map((m) => {
        const parsed = JSON.parse(m) as {
          eventId: string
          ord: number
          ts: number
          type: string
          schemaVersion: number
          payload: unknown
        }
        return { sessionId, ...parsed }
      })

      return {
        state: meta.state ? (JSON.parse(meta.state as string) as Record<string, unknown>) : {},
        events,
        createdAt: Number(meta.created_at) || Date.now(),
        updatedAt: Number(meta.updated_at) || Date.now(),
      }
    },

    async save(sessionId: string, data: SessionData): Promise<void> {
      const r = await getClient()
      const pipeline = r.multi()
      pipeline.hset(sessionKey(sessionId), {
        state: JSON.stringify(data.state),
        created_at: data.createdAt,
        updated_at: data.updatedAt,
      })
      pipeline.del(eventsKey(sessionId))
      pipeline.del(idIndexKey(sessionId))
      for (const e of data.events) {
        const member = JSON.stringify({
          eventId: e.eventId,
          ord: e.ord,
          ts: e.ts,
          type: e.type,
          schemaVersion: e.schemaVersion,
          payload: e.payload,
        })
        pipeline.zadd(eventsKey(sessionId), e.ord, member)
        pipeline.sadd(idIndexKey(sessionId), e.eventId)
      }
      applyTtl(pipeline, sessionId)
      await pipeline.exec()
    },

    async delete(sessionId: string): Promise<void> {
      const r = await getClient()
      await r.del(sessionKey(sessionId), eventsKey(sessionId), idIndexKey(sessionId))
    },

    async appendEvent(sessionId: string, envelope: EventEnvelope): Promise<void> {
      const r = await getClient()
      // Idempotent on (sessionId, eventId) via the Lua script. The caller
      // supplies `ord` (its position in the session's event log) so resume
      // from a persisted log keeps a single monotonic sequence.
      await r.eval(
        APPEND_LUA,
        3,
        sessionKey(sessionId),
        eventsKey(sessionId),
        idIndexKey(sessionId),
        envelope.eventId,
        String(envelope.ord),
        String(envelope.ts),
        envelope.type,
        String(envelope.schemaVersion),
        JSON.stringify(envelope.payload),
        String(Date.now()),
        String(ttl),
      )
    },

    async listEvents(
      sessionId: string,
      opts?: { limit?: number; offset?: number; order?: "asc" | "desc" },
    ): Promise<EventEnvelope[]> {
      const r = await getClient()
      const limit = opts?.limit ?? 1000
      const offset = opts?.offset ?? 0
      const order = opts?.order === "desc" ? "desc" : "asc"

      const stop = offset + limit - 1
      const members =
        order === "asc"
          ? ((await r.zrange(eventsKey(sessionId), offset, stop)) as string[])
          : ((await r.zrevrange(eventsKey(sessionId), offset, stop)) as string[])

      return members.map((m) => {
        const parsed = JSON.parse(m) as {
          eventId: string
          ord: number
          ts: number
          type: string
          schemaVersion: number
          payload: unknown
        }
        return { sessionId, ...parsed }
      })
    },
  }
}
