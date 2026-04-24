import type { Message, StreamEvent, ModelResponse, ToolResult, Tool } from "./types.js"
import type {
  AgentContext,
  SessionContext,
  TurnContext,
  ModelContext,
  ToolContext,
} from "./middleware.js"
import { AbortError } from "./errors.js"
import type { SessionState } from "./session-store.js"
import type { EventBus } from "./events.js"

export function createAgentContext(
  agentDef: AgentContext["agent"],
  tools: Tool[],
): AgentContext {
  const registeredTools = [...tools]
  return {
    agent: agentDef,
    registerTool(tool: Tool) {
      registeredTools.push(tool)
    },
    config: {},
    get _tools() {
      return registeredTools
    },
  } as AgentContext & { _tools: Tool[] }
}

export function createSessionContext(
  agentCtx: AgentContext,
  session: SessionState,
  bus: EventBus,
): SessionContext {
  return {
    ...agentCtx,
    sessionId: session.id,
    state: session.state,
    history: session.history,
    emit(event: StreamEvent) {
      bus.emit(event)
    },
  }
}

export function createTurnContext(
  sessionCtx: SessionContext,
  input: Message[],
  turnId: string,
  turnIndex: number,
): TurnContext {
  return {
    ...sessionCtx,
    input,
    output: null,
    turnId,
    turnIndex,
    startedAt: Date.now(),
    abort(reason: string): never {
      throw new AbortError(reason)
    },
  }
}

export function createModelContext(
  turnCtx: TurnContext,
  messages: Message[],
  model: string,
  toolDefs: Array<{ name: string; description: string; jsonSchema: Record<string, unknown> }>,
  callIndex: number,
): ModelContext {
  let skipped: ModelResponse | null = null

  const ctx: ModelContext = {
    ...turnCtx,
    messages: [...messages],
    model,
    toolDefs: [...toolDefs],
    callIndex,
    setModel(m: string) {
      ctx.model = m
    },
    addSystemMessage(text: string) {
      ctx.messages.unshift({ role: "system", content: text })
    },
    addMessage(msg: Message) {
      ctx.messages.push(msg)
    },
    removeTools(...names: string[]) {
      ctx.toolDefs = ctx.toolDefs.filter((t) => !names.includes(t.name))
    },
    skipCall(response: ModelResponse) {
      skipped = response
    },
  }

  Object.defineProperty(ctx, "_skipped", {
    get: () => skipped,
    enumerable: false,
  })

  return ctx
}

export function createToolContext(
  turnCtx: TurnContext,
  tool: { name: string; description: string; jsonSchema: Record<string, unknown>; requireApproval?: boolean | ((args: Record<string, unknown>) => boolean | Promise<boolean>) },
  args: Record<string, unknown>,
  callId: string,
  callIndex: number,
): ToolContext {
  let denied: string | null = null
  let skipped: ToolResult | null = null

  const ctx: ToolContext = {
    ...turnCtx,
    tool,
    args: { ...args },
    callId,
    callIndex,
    modifyArgs(newArgs: Record<string, unknown>) {
      // Filter prototype pollution keys before merging
      const sanitized: Record<string, unknown> = {}
      for (const key of Object.keys(newArgs)) {
        if (key === "__proto__" || key === "constructor" || key === "prototype") continue
        sanitized[key] = newArgs[key]
      }
      Object.assign(ctx.args, sanitized)
    },
    approve() {
      // no-op for now, used for HITL in future
    },
    deny(reason: string) {
      denied = reason
    },
    skipCall(result: ToolResult) {
      skipped = result
    },
  }

  Object.defineProperty(ctx, "_denied", {
    get: () => denied,
    enumerable: false,
  })

  Object.defineProperty(ctx, "_skipped", {
    get: () => skipped,
    enumerable: false,
  })

  return ctx
}
