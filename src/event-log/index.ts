/**
 * Event log primitives for agent-express.
 *
 * Public API:
 * - `EventLog` — per-session canonical event store + live tail iterator.
 * - `Writer` — durable-write queue draining to `SessionStore.appendEvent`.
 * - `nextEventId` — UUIDv7 generator for fresh emits.
 * - `mergeEventTypeMaps` / `validateEmit` — event-type map merging and runtime validation.
 * - `deriveHistory` — pure projection of events into a `Message[]` view.
 * - `typedEvents` — narrowing helper for read-site type safety.
 * - Core event-type map tables: emitted, reserved-emitted, reserved-only.
 */

export { EventLog } from "./event-log.js"
export type { EventSubscriber } from "./event-log.js"
export { Writer } from "./writer.js"
export { nextEventId } from "./id.js"
export { mergeEventTypeMaps, validateEmit } from "./validate.js"
export { deriveHistory } from "./derive-history.js"
export { typedEvents } from "./typed-events.js"
export {
  CORE_EVENT_TYPE_MAP,
  CORE_EVENT_TYPES,
  EMITTED_CORE_EVENTS,
  RESERVED_EMITTED_CORE_EVENTS,
  RESERVED_ONLY_CORE_EVENTS,
} from "./events.js"
