/**
 * Test helpers for asserting on `Session.events` shape.
 *
 * The framework yields the same `Event` objects through `session.events` and
 * the streaming `for await` iterator — these helpers work on either.
 */

import type { Event } from "../types.js"

/**
 * Assert that `events` contains every type in `expectedTypes` in order
 * (subsequence match — other types may appear between). Throws if not.
 *
 * @example
 * ```typescript
 * expectEventTypes(session.events, ["turn:start", "user:input", "model:response", "turn:end"])
 * ```
 */
export function expectEventTypes(events: readonly Event[], expectedTypes: readonly string[]): void {
  const actual = events.map((e) => e.type)
  let cursor = 0
  for (const expected of expectedTypes) {
    const idx = actual.indexOf(expected, cursor)
    if (idx < 0) {
      throw new Error(
        `expectEventTypes: missing "${expected}" at or after index ${cursor}. Actual sequence: [${actual.join(", ")}]`,
      )
    }
    cursor = idx + 1
  }
}

/**
 * Find the first event of the given type and return its payload, narrowed
 * to `T`. Throws if no event of that type is present.
 *
 * @example
 * ```typescript
 * const userInput = expectEventPayload<{ text: string }>(session.events, "user:input")
 * expect(userInput.text).toBe("hello")
 * ```
 */
export function expectEventPayload<T = unknown>(events: readonly Event[], type: string): T {
  const event = events.find((e) => e.type === type)
  if (!event) {
    const seen = events.map((e) => e.type).join(", ")
    throw new Error(`expectEventPayload: no event of type "${type}" found. Saw: [${seen}]`)
  }
  return event.payload as T
}

/** Count events of a specific type. */
export function countEvents(events: readonly Event[], type: string): number {
  let n = 0
  for (const e of events) if (e.type === type) n++
  return n
}
