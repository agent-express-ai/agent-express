import type { Middleware, TurnContext, ModelContext, ModelResponse } from "agent-express"

/**
 * Configuration for the `agentEscalation()` safety net middleware.
 */
export interface EscalationConfig {
  /** Unproductive turns before force-escalation. Default: 5. */
  after?: number
  /** Message when safety net triggers. */
  message?: string
  /** Tool name to watch for (if model calls it, counter resets). Default: "escalate_to_human". */
  toolName?: string
}

interface EscalationState {
  triggered: boolean
  reason?: string
  turnIndex?: number
  counter: number
  toolName?: string
}

/**
 * Creates an `agentEscalation()` safety net middleware.
 *
 * Primary escalation is the developer's tool (model decides when to call it).
 * This middleware is the fallback — force-escalates after N unproductive turns
 * if the model fails to act.
 *
 * @param config - Safety net options
 * @returns Middleware
 *
 * @example
 * ```typescript
 * import { agentEscalation } from "@agent-express/preset-support"
 *
 * agent.use(agentEscalation({ after: 5 }))
 * ```
 */
export function agentEscalation(config?: EscalationConfig): Middleware {
  const threshold = config?.after ?? 5
  const escalationMessage = config?.message ?? "Let me connect you with a human agent who can help."
  const watchToolName = config?.toolName ?? "escalate_to_human"

  return {
    name: "support:escalation",

    state: {
      "support:escalation": {
        default: { triggered: false, counter: 0 } as EscalationState,
      },
      "support:escalation:hadTools": {
        default: false,
      },
    },

    async model(ctx: ModelContext, next: () => Promise<ModelResponse>): Promise<ModelResponse> {
      const response = await next()
      if (response.toolCalls && response.toolCalls.length > 0) {
        ctx.state["support:escalation:hadTools"] = true
      }
      return response
    },

    async turn(ctx: TurnContext, next: () => Promise<void>): Promise<void> {
      const escalationState = ctx.state["support:escalation"] as EscalationState

      if (escalationState.triggered) {
        // Already escalated — keep responding with escalation message
        ctx.output = escalationMessage
        return
      }

      ctx.state["support:escalation:hadTools"] = false
      await next()

      let counter = escalationState.counter

      if (ctx.state["support:escalation:hadTools"] as boolean) {
        // Model is actively working or escalated — reset counter
        counter = 0
      } else {
        // No tool calls — unproductive turn
        counter++
      }

      // Check threshold
      if (counter >= threshold) {
        ctx.output = escalationMessage
        ctx.emit({
          type: "turn:aborted",
          payload: {
            reason: "escalation",
            message: `Escalation safety-net triggered after ${threshold} unproductive turns`,
          },
        })

        ctx.state["support:escalation"] = {
          triggered: true,
          reason: "safety-net",
          turnIndex: ctx.turnIndex,
          counter: 0,
          toolName: watchToolName,
        }
      } else {
        ctx.state["support:escalation"] = {
          triggered: false,
          counter,
          toolName: watchToolName,
        }
      }
    },
  }
}
