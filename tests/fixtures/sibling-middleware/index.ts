/**
 * Test fixture: a middleware shaped like one a third party would publish.
 *
 * Declares its own event-type schema in the `events` field, emits via the
 * standard ctx.emit surface, and is consumed by the sibling-self-registration
 * test as if it were imported from a separate npm package.
 */

import { z } from "zod"
import type { Middleware } from "../../../src/middleware.js"

export const PingSchema = z.object({ at: z.number(), tag: z.string() })

export function pingChannel(): Middleware {
  return {
    name: "sibling-ping",
    events: {
      "channel:test:ping": { schema: PingSchema, schemaVersion: 1 },
    },
    turn: async (ctx, next) => {
      ctx.emit({ type: "channel:test:ping", payload: { at: Date.now(), tag: "before-next" } })
      await next()
    },
  }
}
