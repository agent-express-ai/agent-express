/**
 * Core event vocabulary — the closed-vocabulary event types the framework
 * itself ships, with their Zod payload schemas.
 *
 * Three categories:
 * - **Emitted**: framework core code emits these during a normal turn.
 * - **Reserved-emitted**: declared in core, but core code does not emit them
 *   in v0.4. Tools or tool-providing middleware MAY emit them.
 * - **Reserved-only**: claimed up front to prevent middleware authors from
 *   colliding with names planned for upcoming features. Core does not emit
 *   them in v0.4; future minor releases fill in the emit logic.
 *
 * Adding to the emitted/reserved sets is a non-breaking change as long as
 * `schemaVersion` stays at 1 (or bumps with proper migration). Removing or
 * renaming an event type is breaking and requires a major.
 */

import { z } from "zod"
import type { EventTypeMap } from "../types.js"

const SCHEMA_V1 = 1

// ─── Shared sub-schemas ───────────────────────────────────────────────

const usageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cacheReadInputTokens: z.number().int().nonnegative().optional(),
    cacheCreationInputTokens: z.number().int().nonnegative().optional(),
  })
  .passthrough()

// ─── Emitted in v0.4 ──────────────────────────────────────────────────

/** Core event types whose schemas are emitted by the framework itself. */
export const EMITTED_CORE_EVENTS: EventTypeMap = {
  "user:input": {
    schema: z.object({
      text: z.string(),
    }),
    schemaVersion: SCHEMA_V1,
  },

  "model:start": {
    schema: z.object({
      model: z.string(),
      callIndex: z.number().int().nonnegative(),
    }),
    schemaVersion: SCHEMA_V1,
  },

  "model:chunk": {
    schema: z.object({
      callIndex: z.number().int().nonnegative(),
      text: z.string(),
    }),
    schemaVersion: SCHEMA_V1,
  },

  "model:end": {
    schema: z.object({
      callIndex: z.number().int().nonnegative(),
      text: z.string(),
      finishReason: z.string(),
      usage: usageSchema.optional(),
    }),
    schemaVersion: SCHEMA_V1,
  },

  "model:response": {
    schema: z.object({
      text: z.string(),
      usage: usageSchema.optional(),
    }),
    schemaVersion: SCHEMA_V1,
  },

  "tool:call": {
    schema: z.object({
      tool: z.string(),
      args: z.record(z.string(), z.unknown()),
      callId: z.string(),
    }),
    schemaVersion: SCHEMA_V1,
  },

  "tool:result": {
    schema: z.object({
      tool: z.string(),
      callId: z.string(),
      result: z.unknown(),
      error: z.string().optional(),
    }),
    schemaVersion: SCHEMA_V1,
  },

  "turn:start": {
    schema: z.object({
      turnIndex: z.number().int().nonnegative(),
      turnId: z.string(),
    }),
    schemaVersion: SCHEMA_V1,
  },

  /**
   * `turn:end.status` distinguishes a normal completion from an interrupt
   * (`AbortError`) and a failure (any other thrown error). Borrowed from
   * Codex `app-server` `turn/completed`.
   */
  "turn:end": {
    schema: z.object({
      turnIndex: z.number().int().nonnegative(),
      turnId: z.string(),
      text: z.string(),
      status: z.enum(["completed", "interrupted", "failed"]),
    }),
    schemaVersion: SCHEMA_V1,
  },

  error: {
    schema: z.object({
      kind: z.string(),
      message: z.string(),
    }),
    schemaVersion: SCHEMA_V1,
  },
}

// ─── Reserved-emitted in v0.4 ─────────────────────────────────────────

/**
 * Declared in core, but core code does not emit. Tools / tool-providing
 * middleware MAY emit these between `tool:call` and `tool:result` to
 * record streaming progress (stdout/stderr, search progress, MCP deltas).
 */
export const RESERVED_EMITTED_CORE_EVENTS: EventTypeMap = {
  "tool:progress": {
    schema: z.object({
      tool: z.string(),
      callId: z.string(),
      delta: z.string(),
    }),
    schemaVersion: SCHEMA_V1,
  },
}

// ─── Reserved-only (declared, not core-emitted) ───────────────────────

/**
 * Names claimed by core so user middleware cannot accidentally take them
 * for custom events. Future feature work fills in the emit logic with
 * proper schemas; for v0.4 these carry `unknown`-payload placeholder
 * schemas — payload validation is essentially permissive until the core
 * code emits them.
 */
const PLACEHOLDER_SCHEMA = z.unknown()
const placeholder = (): { schema: typeof PLACEHOLDER_SCHEMA; schemaVersion: number } => ({
  schema: PLACEHOLDER_SCHEMA,
  schemaVersion: SCHEMA_V1,
})

export const RESERVED_ONLY_CORE_EVENTS: EventTypeMap = {
  "compaction:applied": placeholder(),
  "agent:handoff": placeholder(),
  "agent:delegate": placeholder(),
  "permission:approved": placeholder(),
  "permission:denied": placeholder(),
  "permission:modified": placeholder(),
  "turn:diff": placeholder(),
  "turn:plan": placeholder(),
  "model:reasoning:chunk": placeholder(),
  "model:reasoning:end": placeholder(),
}

// ─── Aggregated core vocabulary ───────────────────────────────────────

/**
 * Full set of event-type names owned by core. Used by the merger to detect
 * collisions when a middleware tries to declare a name core has already claimed.
 */
export const CORE_EVENT_VOCABULARY: EventTypeMap = {
  ...EMITTED_CORE_EVENTS,
  ...RESERVED_EMITTED_CORE_EVENTS,
  ...RESERVED_ONLY_CORE_EVENTS,
}

/** Frozen set of all core event-type names (for fast lookup). */
export const CORE_EVENT_TYPES: ReadonlySet<string> = new Set(Object.keys(CORE_EVENT_VOCABULARY))
