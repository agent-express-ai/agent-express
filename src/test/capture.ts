import type { Middleware, ModelContext } from "../middleware.js"
import type { Message, ModelResponse } from "../types.js"

/**
 * A single captured model call within a turn.
 */
export interface TurnCapture {
  /** Which model call in this turn (0-based). */
  callIndex: number
  /** Messages sent to the model (snapshot taken before the call). */
  input: Message[]
  /** Model response returned after the call. */
  response: ModelResponse
}

/**
 * Accumulated capture data from model calls.
 */
export interface CaptureResult {
  /** All captured model calls, in order. */
  turns: TurnCapture[]
  /** Reset captured data to empty. */
  clear(): void
}

/**
 * Creates a message capture middleware that records model inputs and outputs.
 *
 * The middleware installs a `model` hook that snapshots `ctx.messages` before
 * each LLM call and records the response after. All captures are accumulated
 * in `result.turns`.
 *
 * @returns Object with `middleware` to install and `result` to inspect captures
 *
 * @example
 * ```typescript
 * const { middleware, result } = capture()
 * const agent = new Agent({ name: "test", model, instructions: "test", defaults: false })
 *   .use(middleware)
 *
 * await agent.run("Hello").result
 * console.log(result.turns[0].input)    // messages sent to model
 * console.log(result.turns[0].response) // model response
 * ```
 */
export function capture(): { middleware: Middleware; result: CaptureResult } {
  const turns: TurnCapture[] = []

  const result: CaptureResult = {
    turns,
    clear() {
      turns.length = 0
    },
  }

  const middleware: Middleware = {
    name: "test:capture",
    model: async (ctx: ModelContext, next: () => Promise<ModelResponse>): Promise<ModelResponse> => {
      const input: Message[] = ctx.messages.map((m) => ({ ...m }))
      const callIndex = ctx.callIndex

      const response = await next()

      turns.push({ callIndex, input, response })

      return response
    },
  }

  return { middleware, result }
}
