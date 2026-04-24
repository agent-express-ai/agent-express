/**
 * @agent-express/session-redis — Redis session store adapter.
 * Recommended for distributed/production deployments.
 * @module session-redis
 */
import type { SessionStore, SessionData, Message } from "agent-express"

export interface RedisStoreConfig {
  /** Redis URL. Default: process.env.REDIS_URL or "redis://localhost:6379". */
  url?: string
  /** Key prefix. Default: "agent-express:session:". */
  prefix?: string
  /** TTL in seconds. */
  ttl?: number
}

export function redisStore(config?: RedisStoreConfig): SessionStore {
  const url = config?.url ?? process.env["REDIS_URL"] ?? "redis://localhost:6379"
  const prefix = config?.prefix ?? "agent-express:session:"
  const ttl = config?.ttl

  let client: import("ioredis").default | null = null

  async function getClient(): Promise<import("ioredis").default> {
    if (!client) {
      const { default: Redis } = await import("ioredis")
      client = new Redis(url)
    }
    return client
  }

  function key(sessionId: string): string { return `${prefix}${sessionId}` }
  function msgsKey(sessionId: string): string { return `${prefix}${sessionId}:messages` }

  return {
    async load(sessionId) {
      const r = await getClient()
      const data = await r.get(key(sessionId))
      if (!data) return null
      const parsed = JSON.parse(data) as Omit<SessionData, "history">
      const msgs = await r.lrange(msgsKey(sessionId), 0, -1)
      const history = msgs.map(m => JSON.parse(m) as Message)
      return { ...parsed, history }
    },

    async save(sessionId, data) {
      const r = await getClient()
      const { history, ...rest } = data
      const pipeline = r.multi()
      pipeline.set(key(sessionId), JSON.stringify(rest))
      pipeline.del(msgsKey(sessionId))
      if (history.length > 0) {
        pipeline.rpush(msgsKey(sessionId), ...history.map(m => JSON.stringify(m)))
      }
      if (ttl) {
        pipeline.expire(key(sessionId), ttl)
        pipeline.expire(msgsKey(sessionId), ttl)
      }
      await pipeline.exec()
    },

    async delete(sessionId) {
      const r = await getClient()
      await r.del(key(sessionId), msgsKey(sessionId))
    },

    async add(sessionId, message) {
      const r = await getClient()
      await r.rpush(msgsKey(sessionId), JSON.stringify(message))
    },

    async list(sessionId, opts) {
      const r = await getClient()
      const order = opts?.order ?? "desc"
      const limit = opts?.limit ?? 1000
      const offset = opts?.offset ?? 0
      const msgs = await r.lrange(msgsKey(sessionId), 0, -1)
      const parsed = msgs.map(m => JSON.parse(m) as Message)
      if (order === "desc") parsed.reverse()
      return parsed.slice(offset, offset + limit)
    },
  }
}
