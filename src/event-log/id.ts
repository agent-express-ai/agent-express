/**
 * Event ID generation.
 *
 * UUIDv7 — timestamp-prefixed (millisecond resolution), monotonically
 * sortable in lexicographic order ≈ chronological order. Decentralized,
 * collision-free at production scale, aligned with the Anthropic Claude
 * Agent SDK convention (events carry `uuid`).
 */

import { v7 as uuidv7 } from "uuid"

/**
 * Generate the next event ID.
 * Returns a UUIDv7 string. Lex-sortable; same-millisecond emits get a
 * monotonically increasing random portion guaranteeing total order within
 * a millisecond by the spec.
 */
export function nextEventId(): string {
  return uuidv7()
}
