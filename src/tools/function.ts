import type { ZodSchema } from "zod"
import { zodToJsonSchema } from "./zod-to-json.js"
import type { Middleware } from "../middleware.js"
import type { Tool } from "../types.js"

/**
 * Configuration for a single function tool.
 *
 * @example
 * ```typescript
 * const weatherTool: ToolDef = {
 *   name: "get_weather",
 *   description: "Get current weather for a city",
 *   schema: z.object({ city: z.string() }),
 *   execute: async ({ city }) => `Sunny in ${city}`,
 * }
 * ```
 */
export interface ToolDef {
  /** Unique tool name sent to the LLM. */
  name: string
  /** Description the LLM uses to decide when to call this tool. */
  description: string
  /** Zod schema for input validation and JSON Schema generation. */
  schema: ZodSchema
  /** Execution function called when the LLM invokes this tool. */
  execute: (args: Record<string, unknown>, ctx: unknown) => Promise<unknown>
  /** Maximum execution time in ms. Default: 30000. */
  timeout?: number
  /** Whether this tool requires human approval before execution. */
  requireApproval?: boolean | ((args: Record<string, unknown>) => boolean | Promise<boolean>)
}

/**
 * Creates a middleware that registers function tools on an agent.
 *
 * Accepts a single ToolDef or an array of ToolDefs.
 * Tools are registered via `ctx.registerTool()` in the `agent` hook
 * and are available to the LLM for the agent's lifetime.
 *
 * @example
 * ```typescript
 * agent.use(tools.function({
 *   name: "add",
 *   description: "Add two numbers",
 *   schema: z.object({ a: z.number(), b: z.number() }),
 *   execute: async ({ a, b }) => a + b,
 * }))
 * ```
 */
export function toolsFunction(defs: ToolDef | ToolDef[]): Middleware {
  const toolDefs = Array.isArray(defs) ? defs : [defs]

  const toolObjects: Tool[] = toolDefs.map((def) => ({
    name: def.name,
    description: def.description,
    schema: def.schema,
    jsonSchema: zodToJsonSchema(def.schema),
    execute: def.execute,
    timeout: def.timeout ?? 30_000,
    ...(def.requireApproval !== undefined && { requireApproval: def.requireApproval }),
  }))

  return {
    name: `tools:${toolObjects.map((t) => t.name).join(",")}`,
    async agent(ctx, next) {
      for (const tool of toolObjects) ctx.registerTool(tool)
      await next()
    },
  }
}
