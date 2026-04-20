/**
 * @agent-express/session-openai — OpenAI Conversation API session store.
 *
 * LIMITATION: OpenAI Conversation API stores messages only, not custom state.
 * Middleware state (budget, escalation, PII mappings) is NOT persisted.
 * On load(), state is returned empty. Use Redis or Postgres for full state persistence.
 *
 * @module session-openai
 */
import type { SessionStore, SessionData, Message } from "agent-express"

export interface OpenAIStoreConfig {
  /** OpenAI API key. Default: process.env.OPENAI_API_KEY. */
  apiKey?: string
}

export function openaiStore(config?: OpenAIStoreConfig): SessionStore {
  const apiKey = config?.apiKey ?? process.env["OPENAI_API_KEY"]
  if (!apiKey) throw new Error("OpenAI API key required. Set OPENAI_API_KEY or pass apiKey.")

  const headers = { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" }

  return {
    async load(sessionId) {
      try {
        const res = await fetch(`https://api.openai.com/v1/conversations/${sessionId}/items`, { headers, signal: AbortSignal.timeout(30_000) })
        if (!res.ok) return null
        const data = await res.json() as { data: Array<{ type: string; role?: string; content?: Array<{ text: string }> }> }
        const history: Message[] = (data.data ?? [])
          .filter(item => item.type === "message" && item.role)
          .map(item => ({
            role: item.role as Message["role"],
            content: item.content?.[0]?.text ?? "",
          }))
        // State NOT persisted by OpenAI — return empty
        return { state: {}, history, createdAt: "", updatedAt: "" }
      } catch {
        return null
      }
    },

    async save(_sessionId, _data) {
      // OpenAI manages conversation items via their API
      // Full save not supported — use add() for incremental message append
    },

    async delete(sessionId) {
      await fetch(`https://api.openai.com/v1/conversations/${sessionId}`, { method: "DELETE", headers, signal: AbortSignal.timeout(30_000) })
    },

    async add(sessionId, message) {
      await fetch(`https://api.openai.com/v1/conversations/${sessionId}/items`, {
        method: "POST",
        headers,
        body: JSON.stringify({ type: "message", role: message.role, content: [{ type: "text", text: typeof message.content === "string" ? message.content : JSON.stringify(message.content) }] }),
        signal: AbortSignal.timeout(30_000),
      })
    },

    async list(sessionId, opts) {
      const res = await fetch(`https://api.openai.com/v1/conversations/${sessionId}/items`, { headers, signal: AbortSignal.timeout(30_000) })
      if (!res.ok) return []
      const data = await res.json() as { data: Array<{ type: string; role?: string; content?: Array<{ text: string }> }> }
      let messages = (data.data ?? [])
        .filter(item => item.type === "message" && item.role)
        .map(item => ({ role: item.role as Message["role"], content: item.content?.[0]?.text ?? "" }))
      if (opts?.order === "desc") messages = messages.reverse()
      const offset = opts?.offset ?? 0
      const limit = opts?.limit ?? 1000
      return messages.slice(offset, offset + limit)
    },
  }
}
