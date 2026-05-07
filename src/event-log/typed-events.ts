/**
 * Read-site narrowing helper: filter `session.events` (or any `Event[]`)
 * to a specific event type and Zod-parse the payload.
 *
 * Lets consumers use a declared event-type schema to safely access fields
 * without `as` casts. Skips events whose payload doesn't match the schema —
 * useful for forward-compat reads where unknown payload shapes may exist.
 *
 * @example
 * ```typescript
 * import { z } from "zod"
 * import { typedEvents } from "agent-express"
 *
 * const InboundSchema = z.object({ channel: z.string(), text: z.string() })
 *
 * for (const e of typedEvents(session.events, "channel:slack:inbound", InboundSchema)) {
 *   console.log(e.payload.channel, e.payload.text)  // typed as { channel: string; text: string }
 * }
 * ```
 */

import type { ZodSchema } from "zod"
import type { Event } from "../types.js"

/** Yield the subset of events matching `type`, with payloads parsed against `schema`. */
export function* typedEvents<T>(
  events: readonly Event[],
  type: string,
  schema: ZodSchema<T>,
): IterableIterator<Event<typeof type, T>> {
  for (const event of events) {
    if (event.type !== type) continue
    const result = schema.safeParse(event.payload)
    if (!result.success) continue
    yield {
      id: event.id,
      ts: event.ts,
      type: event.type,
      schemaVersion: event.schemaVersion,
      payload: result.data,
    } as Event<typeof type, T>
  }
}
