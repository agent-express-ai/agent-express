import type { Middleware, ModelContext } from "../../middleware.js"
import type { ModelResponse } from "../../types.js"
import { AgentExpressError } from "../../errors.js"

/** Thrown when guard.output() blocks a response (if `onBlock: "error"`). */
export class OutputGuardrailError extends AgentExpressError {
  /** Reason the response was blocked. */
  readonly reason: string

  constructor(reason: string) {
    super(`Output blocked: ${reason}`, "OUTPUT_BLOCKED", false)
    this.name = "OutputGuardrailError"
    this.reason = reason
  }
}

/**
 * Result of an output validation function.
 */
export interface OutputValidationResult {
  /** Whether the output passed validation. `false` blocks the response. */
  ok: boolean
  /** Reason for blocking (when `ok` is `false`). */
  reason?: string
  /** Modified output text (redaction, transformation). Only used when `ok` is `true`. */
  output?: string
}

/** Output validator function signature. Receives the model response and context. */
export type OutputValidator = (
  response: ModelResponse,
  ctx: ModelContext,
) => Promise<OutputValidationResult> | OutputValidationResult

/**
 * Configuration for `guard.output()`.
 */
export interface OutputGuardConfig {
  /** Validation function. */
  validate: OutputValidator
  /**
   * What to do when the validator blocks a response (`ok: false`).
   * - `"replace"` (default): strip tool calls, return reason as text
   * - `"error"`: throw `OutputGuardrailError`
   */
  onBlock?: "replace" | "error"
}

/**
 * Creates a `guard.output()` middleware that validates each model response
 * BEFORE tool calls are executed.
 *
 * Accepts either a validator function (shorthand) or a config object (full control).
 *
 * @example
 * ```typescript
 * // Shorthand — blocked responses are replaced by default
 * agent.use(guard.output(async (response, ctx) => {
 *   if (response.toolCalls?.some(tc => tc.toolName === "delete_all")) {
 *     return { ok: false, reason: "Dangerous tool call blocked" }
 *   }
 *   return { ok: true }
 * }))
 *
 * // Full config — throw on block
 * agent.use(guard.output({
 *   validate: myValidator,
 *   onBlock: "error",
 * }))
 * ```
 */
export function outputGuard(validatorOrConfig: OutputValidator | OutputGuardConfig): Middleware {
  const validate = typeof validatorOrConfig === "function" ? validatorOrConfig : validatorOrConfig.validate
  const onBlock = typeof validatorOrConfig === "function" ? "replace" : (validatorOrConfig.onBlock ?? "replace")

  return {
    name: "guard:output",

    async model(ctx: ModelContext, next: () => Promise<ModelResponse>): Promise<ModelResponse> {
      const response = await next()
      const result = await validate(response, ctx)

      // Passed — return as-is or with modified output
      if (result.ok) {
        if (result.output !== undefined) {
          return { ...response, text: result.output }
        }
        return response
      }

      // Blocked (ok: false)
      const reason = result.reason ?? "Response blocked by output guard"
      if (onBlock === "error") {
        throw new OutputGuardrailError(reason)
      }
      return {
        text: reason,
        usage: response.usage,
        finishReason: "stop",
      }
    },
  }
}
