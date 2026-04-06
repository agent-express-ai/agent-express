import type { Middleware, ToolContext } from "../../middleware.js"
import type { ToolResult } from "../../types.js"

/**
 * Approval decision returned by the approval function.
 * Use `approve()`, `deny()`, `modify()` helpers to construct.
 */
export type ApprovalDecision =
  | { action: "approve"; remember?: boolean }
  | { action: "deny"; reason: string }
  | { action: "modify"; args: Record<string, unknown> }

/** Creates an "approve" decision. */
export function approve(opts?: { remember?: boolean }): ApprovalDecision {
  return { action: "approve", ...(opts?.remember !== undefined && { remember: opts.remember }) }
}

/** Creates a "deny" decision with a reason returned to the model. */
export function deny(reason: string): ApprovalDecision {
  return { action: "deny", reason }
}

/** Creates a "modify" decision that changes the tool arguments. */
export function modify(args: Record<string, unknown>): ApprovalDecision {
  return { action: "modify", args }
}

/**
 * Approval function — receives tool details, returns a decision.
 * Supports sync and async (Promise) return values.
 */
export type ApprovalFunction = (
  toolName: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
) => ApprovalDecision | Promise<ApprovalDecision>

/** Configuration for `guard.approve()`. */
export interface ApproveConfig {
  /** The approval handler — called for tools that require approval. */
  approve: ApprovalFunction
}

/**
 * Creates a `guard.approve()` middleware for human-in-the-loop tool approval.
 *
 * Intercepts tool calls before execution for tools with `requireApproval` set.
 * Delegates to the developer-supplied approval function which can approve, deny,
 * or modify the tool call.
 *
 * @param config - Approval configuration with the handler function
 * @returns Middleware with a tool hook
 *
 * @example
 * ```typescript
 * import { approve, deny, modify } from "agent-express"
 *
 * agent.use(guard.approve({
 *   approve: async (toolName, args) => {
 *     if (toolName === "delete_all") return deny("Blocked")
 *     return approve()
 *   },
 * }))
 * ```
 */
export function guardApprove(config: ApproveConfig): Middleware {
  return {
    name: "guard:approve",

    state: {
      "guard:approve:remembered": {
        default: [] as string[],
      },
    },

    async tool(ctx: ToolContext, next: () => Promise<ToolResult>): Promise<ToolResult> {
      const { requireApproval } = ctx.tool

      // No requireApproval → pass through
      if (!requireApproval) return next()

      // Conditional requireApproval function
      if (typeof requireApproval === "function") {
        const needed = await requireApproval(ctx.args)
        if (!needed) return next()
      }

      // Already remembered (stored in session state, not closure) — pass through
      const remembered = (ctx.state["guard:approve:remembered"] as string[]) ?? []
      if (remembered.includes(ctx.tool.name)) return next()

      // Call approval function
      let decision: ApprovalDecision
      try {
        decision = await config.approve(ctx.tool.name, ctx.args, ctx)
      } catch (err) {
        // Fail-safe: treat thrown errors as denial
        decision = deny(err instanceof Error ? err.message : String(err))
      }

      // Handle decision
      switch (decision.action) {
        case "approve":
          if (decision.remember) {
            ctx.state["guard:approve:remembered"] = [...remembered, ctx.tool.name]
          }
          return next()

        case "deny":
          ctx.deny(decision.reason)
          return next()

        case "modify":
          ctx.modifyArgs(decision.args)
          return next()

        default:
          return next()
      }
    },
  }
}
