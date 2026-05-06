/**
 * Derive a `Message[]` view from an event log.
 *
 * The framework no longer maintains a separate authoritative messages array —
 * `Session.history` is computed from `Session.events` on read. Pure function:
 * walk events in order, project `user:input` and `model:response` (or fall
 * back to the last `model:end` text if no `model:response` was emitted) into
 * `{ role, content }` entries; ignore everything else.
 *
 * For long-running sessions, `maxHistory` trims the result to the last N
 * messages — same semantics as the v0.3 SessionState.maxHistory option.
 */

import type { Event, Message } from "../types.js"

/**
 * Project an event log into a chronological `Message[]` view.
 *
 * Rules:
 * - `user:input` events → `{ role: "user", content: text }`
 * - `model:response` events → `{ role: "assistant", content: text }` (preferred)
 * - `model:end` events → `{ role: "assistant", content: text }` ONLY when no
 *   `model:response` exists for the same turn (single-call turns may skip the
 *   rolled-up `model:response` event)
 * - all other event types are ignored (tool calls/results, turn boundaries,
 *   custom middleware events, errors, reserved-only types)
 *
 * @param events - The event log to project.
 * @param maxHistory - Optional: keep only the last N messages.
 */
export function deriveHistory(events: readonly Event[], maxHistory?: number): Message[] {
  const messages: Message[] = []
  let lastModelEndForTurn: { turnId: string | null; text: string } | null = null
  let currentTurnId: string | null = null
  let assistantResponseEmittedThisTurn = false

  for (const event of events) {
    switch (event.type) {
      case "turn:start": {
        // Flush a pending model:end for the previous turn if no model:response was seen
        if (lastModelEndForTurn && !assistantResponseEmittedThisTurn) {
          messages.push({ role: "assistant", content: lastModelEndForTurn.text })
        }
        currentTurnId = (event.payload as { turnId?: string }).turnId ?? null
        lastModelEndForTurn = null
        assistantResponseEmittedThisTurn = false
        break
      }
      case "user:input": {
        const text = (event.payload as { text?: string }).text
        if (typeof text === "string") {
          messages.push({ role: "user", content: text })
        }
        break
      }
      case "model:end": {
        const text = (event.payload as { text?: string }).text
        if (typeof text === "string") {
          lastModelEndForTurn = { turnId: currentTurnId, text }
        }
        break
      }
      case "model:response": {
        const text = (event.payload as { text?: string }).text
        if (typeof text === "string") {
          messages.push({ role: "assistant", content: text })
          assistantResponseEmittedThisTurn = true
        }
        break
      }
      case "turn:end": {
        // If turn ended without model:response, fall back to the last model:end text
        if (!assistantResponseEmittedThisTurn && lastModelEndForTurn) {
          messages.push({ role: "assistant", content: lastModelEndForTurn.text })
        }
        lastModelEndForTurn = null
        assistantResponseEmittedThisTurn = false
        currentTurnId = null
        break
      }
      // tool:call, tool:result, tool:progress, model:start, model:chunk,
      // error, reserved-only, custom middleware events — all ignored for
      // history derivation purposes.
      default:
        break
    }
  }

  // If the log ended mid-turn with a model:end but no turn:end yet,
  // surface the assistant text so live in-progress reads see latest output.
  if (lastModelEndForTurn && !assistantResponseEmittedThisTurn) {
    messages.push({ role: "assistant", content: lastModelEndForTurn.text })
  }

  if (maxHistory !== undefined && messages.length > maxHistory) {
    return messages.slice(messages.length - maxHistory)
  }
  return messages
}
