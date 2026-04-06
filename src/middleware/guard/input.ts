import type { Middleware, ModelContext } from "../../middleware.js"
import type { Message, ModelResponse } from "../../types.js"
import { AgentExpressError } from "../../errors.js"

/** Thrown when guard.input() rejects input. */
export class InputGuardrailError extends AgentExpressError {
  /** Reason the input was rejected. */
  readonly reason: string

  constructor(reason: string) {
    super(`Input validation failed: ${reason}`, "INPUT_VALIDATION", false)
    this.name = "InputGuardrailError"
    this.reason = reason
  }
}

/**
 * Result of an input validation function.
 */
export interface InputValidationResult {
  /** Whether the input passed validation. */
  ok: boolean
  /** Reason for rejection (when !ok). */
  reason?: string
  /** Modified messages to use instead of originals (when ok + messages provided). */
  messages?: Message[]
}

/** Input validator function signature. */
export type InputValidator = (
  ctx: ModelContext,
) => Promise<InputValidationResult> | InputValidationResult

/**
 * Creates a `guard.input()` middleware that validates input before each LLM call.
 *
 * Runs in the `model` hook before `next()`. If the validator returns `{ ok: false }`,
 * throws `InputGuardrailError`. If it returns modified messages, those replace
 * the originals for this model call.
 *
 * @param validator - Async or sync validation function receiving ModelContext
 * @returns Middleware that validates input before each LLM call
 *
 * @example
 * ```typescript
 * agent.use(guard.input(async (ctx) => {
 *   if (ctx.messages.some(m => typeof m.content === "string" && m.content.includes("ignore previous"))) {
 *     return { ok: false, reason: "Potential prompt injection" }
 *   }
 *   return { ok: true }
 * }))
 * ```
 */
export function inputGuard(validator: InputValidator): Middleware {
  return {
    name: "guard:input",

    async model(ctx: ModelContext, next: () => Promise<ModelResponse>): Promise<ModelResponse> {
      const result = await validator(ctx)

      if (!result.ok) {
        throw new InputGuardrailError(result.reason ?? "Input validation failed")
      }

      if (result.messages) {
        ctx.messages.length = 0
        ctx.messages.push(...result.messages)
      }

      return next()
    },
  }
}
