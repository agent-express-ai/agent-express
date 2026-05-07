import type { Message, ModelResponse, Tool, ToolResult } from "./types.js"
import type { TurnContext, ModelContext, ToolContext, Middleware } from "./middleware.js"
import { composeHooks } from "./executor.js"
import { createModelContext, createToolContext } from "./context.js"
import type { LanguageModelV3 } from "@ai-sdk/provider"

/** Result of one complete agent loop (one turn's worth of model calls and tool executions). */
export interface LoopResult {
  /** Final assistant text output. */
  text: string
}

/**
 * Runs the minimal agent loop for a single turn: model → tool → model → ... → final text.
 *
 * The loop calls the LLM, checks if the response contains tool calls, executes
 * them (in parallel by default), feeds results back to the LLM, and repeats
 * until the LLM returns a text response.
 *
 * Each LLM call passes through the `model` middleware onion.
 * Each tool execution passes through the `tool` middleware onion.
 *
 * All cross-cutting concerns (retry, usage tracking, tool recording, duration,
 * iteration limits, logging) are handled by middleware, not this loop.
 */
export async function runAgentLoop(
  turnCtx: TurnContext,
  model: LanguageModelV3 | null,
  modelId: string,
  tools: Tool[],
  middlewares: Middleware[],
  callModel: (ctx: ModelContext) => Promise<ModelResponse>,
): Promise<LoopResult> {
  // Build tool definitions for the LLM (name + description + JSON schema)
  const toolDefs = tools.map((t) => ({
    name: t.name,
    description: t.description,
    jsonSchema: t.jsonSchema,
    ...(t.requireApproval !== undefined && { requireApproval: t.requireApproval }),
  }))

  // Start with turn input, prepend conversation history if any
  const messages: Message[] = [...turnCtx.input]
  if (turnCtx.history.length > 0) {
    messages.unshift(...turnCtx.history.filter((m) => m.role !== "system"))
  }

  // Build model onion: middleware wrapping → actual LLM call
  const modelOnion = composeHooks<ModelContext, ModelResponse>(
    middlewares,
    "model",
    async (ctx) => {
      const skipped = (ctx as ModelContext & { _skipped?: ModelResponse })._skipped
      if (skipped) return skipped
      return callModel(ctx)
    },
  )

  // Build tool onion: middleware wrapping → actual tool execution
  const toolOnion = composeHooks<ToolContext, ToolResult>(
    middlewares,
    "tool",
    async (ctx) => {
      const denied = (ctx as ToolContext & { _denied?: string })._denied
      if (denied) {
        return { callId: ctx.callId, result: `Tool denied: ${denied}`, isError: true }
      }
      const skipped = (ctx as ToolContext & { _skipped?: ToolResult })._skipped
      if (skipped) return skipped

      const tool = tools.find((t) => t.name === ctx.tool.name)
      if (!tool) {
        return { callId: ctx.callId, result: `Tool not found: ${ctx.tool.name}`, isError: true }
      }

      const timeout = tool.timeout ?? 30_000
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const result = await Promise.race([
          tool.execute(ctx.args, ctx),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`Tool ${ctx.tool.name} timed out after ${timeout}ms`)),
              timeout,
            )
          }),
        ])
        turnCtx.emit({ type: "tool:result", payload: { tool: ctx.tool.name, callId: ctx.callId, result } })
        return { callId: ctx.callId, result }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        turnCtx.emit({
          type: "tool:result",
          payload: { tool: ctx.tool.name, callId: ctx.callId, result: null, error: error.message },
        })
        return { callId: ctx.callId, result: `Error: ${error.message}`, isError: true }
      } finally {
        if (timer !== undefined) clearTimeout(timer)
      }
    },
  )

  // Main agent loop: model → check response → execute tools → repeat
  // Hardcoded absolute safety limit to prevent infinite loops
  const ABSOLUTE_MAX = 1000
  let callIndex = 0
  for (; callIndex < ABSOLUTE_MAX;) {
    const modelCtx = createModelContext(turnCtx, messages, modelId, toolDefs, callIndex)

    turnCtx.emit({ type: "model:start", payload: { model: modelId, callIndex } })
    const response = await modelOnion(modelCtx)
    callIndex++

    turnCtx.emit({
      type: "model:end",
      payload: {
        callIndex: callIndex - 1,
        text: response.text ?? "",
        finishReason: response.finishReason,
        ...(response.usage !== undefined && { usage: response.usage }),
      },
    })

    // If no tool calls → turn is complete (text may be empty if iteration limit reached)
    if (!response.toolCalls || response.toolCalls.length === 0) {
      const text = response.text ?? ""
      messages.push({ role: "assistant", content: text })
      return { text }
    }

    // If tool calls → execute and feed results back
    if (response.toolCalls && response.toolCalls.length > 0) {
      messages.push({
        role: "assistant",
        content: response.toolCalls.map((tc) => ({
          type: "tool-call" as const,
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          args: tc.args,
        })),
      })

      const toolResults = await Promise.all(
        response.toolCalls.map(async (tc, idx) => {
          const toolDef = toolDefs.find((t) => t.name === tc.toolName)
          if (!toolDef) {
            return { callId: tc.toolCallId, result: `Tool not found: ${tc.toolName}`, isError: true }
          }

          turnCtx.emit({
            type: "tool:call",
            payload: { tool: tc.toolName, args: tc.args, callId: tc.toolCallId },
          })
          const toolCtx = createToolContext(turnCtx, toolDef, tc.args, tc.toolCallId, idx)
          return toolOnion(toolCtx)
        }),
      )

      for (const tr of toolResults) {
        messages.push({
          role: "tool",
          content: [{ type: "tool-result", toolCallId: tr.callId, result: tr.result }],
        })
      }
    }
  }

  // Safety: if ABSOLUTE_MAX reached, return whatever text we have
  return { text: "" }
}
