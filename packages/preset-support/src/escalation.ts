import type { Middleware, TurnContext } from "agent-express"

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

  let counter = 0
  let triggered = false

  return {
    name: "support:escalation",

    state: {
      "support:escalation": {
        default: { triggered: false, counter: 0 } as EscalationState,
      },
    },

    async turn(ctx: TurnContext, next: () => Promise<void>): Promise<void> {
      if (triggered) {
        // Already escalated — keep responding with escalation message
        ctx.output = escalationMessage
        return
      }

      await next()

      // Check if model called any tool (including escalation tool)
      const toolsCalled = ctx.state["observe:tools"] as Array<{ name: string }> | undefined
      const lastTurnTools = toolsCalled?.filter(() => true) ?? []

      if (lastTurnTools.length > 0) {
        // Model is actively working or escalated — reset counter
        counter = 0
        // Check if escalation tool was called
        if (lastTurnTools.some(t => t.name === watchToolName)) {
          counter = 0 // Model handled escalation
        }
      } else {
        // No tool calls — unproductive turn
        counter++
      }

      // Check threshold
      if (counter >= threshold) {
        triggered = true
        counter = 0
        ctx.output = escalationMessage
        // Emit escalation as error event (StreamEvent doesn't have escalation type yet)
        ctx.emit({ type: "error", error: new Error(`Escalation safety-net triggered after ${threshold} unproductive turns`) })

        ctx.state["support:escalation"] = {
          triggered: true,
          reason: "safety-net",
          turnIndex: ctx.turnIndex,
          counter: 0,
        }
      } else {
        ctx.state["support:escalation"] = {
          triggered: false,
          counter,
        }
      }
    },
  }
}
