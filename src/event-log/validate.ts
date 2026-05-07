/**
 * Registry merging and emit-time validation.
 *
 * Builds the per-agent merged event-type map at construction by combining
 * the core event-type map with each middleware's `events` declarations.
 * Throws `EventTypeCollisionError` when the same name is declared twice.
 *
 * At emit time, validates `{ type, payload }` against the merged event-type map —
 * unknown types throw `UnknownEventTypeError`; bad payload shapes throw
 * `EventValidationError`; payloads that pass Zod but fail JSON serialization
 * throw `EventSerializationError`.
 */

import type { EventTypeMap, EventTypeSchema } from "../types.js"
import type { Middleware } from "../middleware.js"
import {
  EventTypeCollisionError,
  EventValidationError,
  EventSerializationError,
  UnknownEventTypeError,
} from "../errors.js"
import { CORE_EVENT_TYPE_MAP } from "./events.js"

/**
 * Merge core event-type map with middleware-declared schemas into a
 * single per-agent event-type map. Throws on collisions.
 *
 * @param middlewares - The middleware list registered on the agent.
 * @returns Merged event-type map suitable for emit-time lookup + validation.
 */
export function mergeEventTypeMaps(middlewares: readonly Middleware[]): EventTypeMap {
  const merged: Record<string, EventTypeSchema> = { ...CORE_EVENT_TYPE_MAP }
  const owners = new Map<string, string[]>()
  // Seed owners with core for collision messages
  for (const type of Object.keys(CORE_EVENT_TYPE_MAP)) {
    owners.set(type, ["core"])
  }

  for (const mw of middlewares) {
    if (!mw.events) continue
    const mwName = mw.name ?? "<unnamed middleware>"
    for (const [type, schema] of Object.entries(mw.events)) {
      const existing = owners.get(type)
      if (existing) {
        throw new EventTypeCollisionError(type, [...existing, mwName])
      }
      merged[type] = schema
      owners.set(type, [mwName])
    }
  }

  return merged
}

/** Emit-time validation. Returns the parsed payload (post-Zod) on success. */
export function validateEmit(
  eventTypeMap: EventTypeMap,
  type: string,
  payload: unknown,
): { schemaVersion: number; payload: unknown } {
  const schema = eventTypeMap[type]
  if (!schema) {
    throw new UnknownEventTypeError(type)
  }

  const result = schema.schema.safeParse(payload)
  if (!result.success) {
    throw new EventValidationError(type, result.error.issues)
  }

  // Two-layer defense: Zod may accept values that JSON storage cannot round-trip
  // (functions silently dropped, Date coerced to ISO string, BigInt throws,
  // circular refs throw, undefined silently dropped). Replacer rejects any
  // value type that wouldn't round-trip safely.
  try {
    JSON.stringify(result.data, (_key, value) => {
      if (typeof value === "function") {
        throw new TypeError("payload contains a function (would be silently dropped by JSON.stringify)")
      }
      if (typeof value === "bigint") {
        throw new TypeError("payload contains a BigInt (not JSON-serializable)")
      }
      if (typeof value === "undefined") {
        // undefined as a property value is silently dropped by JSON.stringify;
        // surfacing reflects the spec contract (no silent corruption).
        throw new TypeError("payload contains undefined (would be silently dropped by JSON.stringify)")
      }
      if (value instanceof Date) {
        throw new TypeError("payload contains a Date (would be coerced to ISO string, breaking round-trip equality)")
      }
      return value
    })
  } catch (cause) {
    throw new EventSerializationError(type, cause instanceof Error ? cause : new Error(String(cause)))
  }

  return { schemaVersion: schema.schemaVersion, payload: result.data }
}
