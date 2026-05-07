/**
 * Core event-type map — the closed event-type map event types the framework
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
   * `turn:end.status` distinguishes a normal completion from an abort
   * (guard intervention via `AbortError`) and a failure (any other thrown
   * error). When `status === "aborted"`, a `turn:aborted` event with the
   * specific guard reason precedes this event in the log.
   */
  "turn:end": {
    schema: z.object({
      turnIndex: z.number().int().nonnegative(),
      turnId: z.string(),
      text: z.string(),
      status: z.enum(["completed", "aborted", "failed"]),
    }),
    schemaVersion: SCHEMA_V1,
  },

  /**
   * Emitted by guard middleware when it intervenes in normal flow —
   * either by throwing (e.g., budget exceeded, timeout fired) or by
   * short-circuiting (e.g., maxIterations cap, rate-limit message).
   * Distinct from `error` which is reserved for unexpected exceptions.
   *
   * `reason` is an open-set string. Built-in guards use:
   * `budget` | `timeout` | `maxIterations` | `rateLimit` | `input` | `output` | `abort`.
   * Custom guards may pick their own values.
   */
  "turn:aborted": {
    schema: z.object({
      reason: z.string(),
      message: z.string().optional(),
      callIndex: z.number().int().nonnegative().optional(),
    }),
    schemaVersion: SCHEMA_V1,
  },

  /**
   * Reserved for **unexpected** failures — exceptions that aren't part of
   * the harness's guard-and-stop flow. For predictable guard interventions,
   * see `turn:aborted`.
   *
   * `scope` identifies which lifecycle layer the exception bubbled out of
   * (e.g., a tool that threw vs. an agent-level init failure). `kind` is
   * the error class name. `cause` is a serialized cause chain when present.
   */
  error: {
    schema: z.object({
      scope: z.enum(["agent", "session", "turn", "model", "tool"]),
      kind: z.string(),
      message: z.string(),
      cause: z.string().optional(),
    }),
    schemaVersion: SCHEMA_V1,
  },
}

// ─── Reserved-emitted in v0.4 ─────────────────────────────────────────

/**
 * Declared in core, with payload schemas published, but emitted only by
 * specific built-in middleware rather than the core agent loop.
 *
 * - `tool:progress` — emitted by tool-providing middleware between `tool:call`
 *   and `tool:result` to record streaming output (stdout/stderr, MCP deltas).
 * - `permission:*` — emitted by `guard.approve()` per HITL decision.
 * - `compaction:applied` — emitted by `memory.compaction()` after a successful
 *   pass over the message array.
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

  "permission:approved": {
    schema: z.object({
      tool: z.string(),
      callId: z.string(),
      classifier: z.string().optional(),
      remembered: z.boolean().optional(),
    }),
    schemaVersion: SCHEMA_V1,
  },

  "permission:denied": {
    schema: z.object({
      tool: z.string(),
      callId: z.string(),
      classifier: z.string().optional(),
      reason: z.string(),
    }),
    schemaVersion: SCHEMA_V1,
  },

  /**
   * Emitted when a permission classifier modifies tool arguments.
   * Original and modified arg shapes carried verbatim — callers must
   * not rely on these values being free of secrets (responsibility
   * lies with the classifier author).
   */
  "permission:modified": {
    schema: z.object({
      tool: z.string(),
      callId: z.string(),
      classifier: z.string().optional(),
      reason: z.string().optional(),
      originalArgs: z.record(z.string(), z.unknown()),
      modifiedArgs: z.record(z.string(), z.unknown()),
    }),
    schemaVersion: SCHEMA_V1,
  },

  /**
   * Emitted by `memory.compaction()` after compaction runs successfully.
   * Underlying events in the log are never modified or removed —
   * compaction stays in the harness, the log is the source of truth.
   * `tokensBefore` / `tokensAfter` are token counts of the in-context
   * `Message[]` (before-and-after of this compaction pass).
   */
  "compaction:applied": {
    schema: z.object({
      strategy: z.string(),
      tokensBefore: z.number().int().nonnegative().optional(),
      tokensAfter: z.number().int().nonnegative().optional(),
      messagesBefore: z.number().int().nonnegative().optional(),
      messagesAfter: z.number().int().nonnegative().optional(),
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
  "agent:handoff": placeholder(),
  "agent:delegate": placeholder(),
  "turn:diff": placeholder(),
  "turn:plan": placeholder(),
  "model:reasoning:chunk": placeholder(),
  "model:reasoning:end": placeholder(),
}

// ─── Aggregated core event-type map ───────────────────────────────────────

/**
 * Full set of event-type names owned by core. Used by the merger to detect
 * collisions when a middleware tries to declare a name core has already claimed.
 */
export const CORE_EVENT_TYPE_MAP: EventTypeMap = {
  ...EMITTED_CORE_EVENTS,
  ...RESERVED_EMITTED_CORE_EVENTS,
  ...RESERVED_ONLY_CORE_EVENTS,
}

/** Frozen set of all core event-type names (for fast lookup). */
export const CORE_EVENT_TYPES: ReadonlySet<string> = new Set(Object.keys(CORE_EVENT_TYPE_MAP))
