import type { Message, EmitInput, ModelResponse, ToolResult, Tool, Event, EventEnvelope, EventTypeMap } from "./types.js"
import type {
  AgentContext,
  SessionContext,
  TurnContext,
  ModelContext,
  ToolContext,
} from "./middleware.js"
import { AbortError, EventOutsideSessionError } from "./errors.js"
import type { SessionState } from "./session-store.js"
import type { Writer } from "./event-log/writer.js"
import { nextEventId } from "./event-log/id.js"
import { validateEmit } from "./event-log/validate.js"

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

/**
 * Build the `emit` closure for a session-scoped context.
 *
 * Validates the type+payload against the merged eventTypeMap, generates a
 * UUIDv7 + timestamp, appends to the session's `EventLog` (read-your-writes),
 * and queues a durable write through the optional `Writer`. Throws
 * `EventOutsideSessionError` after the session has ended.
 */
function buildSessionEmit(
  session: SessionState,
  eventTypeMap: EventTypeMap,
  writer: Writer | null,
): (input: EmitInput) => void {
  return (input: EmitInput) => {
    if (session.eventLog.isClosed) {
      throw new EventOutsideSessionError(`session ${session.id} has ended`)
    }
    const validated = validateEmit(eventTypeMap, input.type, input.payload)
    const event: Event = {
      id: nextEventId(),
      ts: Date.now(),
      type: input.type,
      schemaVersion: validated.schemaVersion,
      payload: validated.payload,
    }
    session.eventLog.append(event)
    if (writer) {
      // ord = the index where this event landed in the log. Stays monotonic
      // across replay/resume because replay populates earlier indices first.
      const ord = session.eventLog.events.length - 1
      const envelope: EventEnvelope = {
        sessionId: session.id,
        eventId: event.id,
        ord,
        ts: event.ts,
        type: event.type,
        schemaVersion: event.schemaVersion,
        payload: event.payload,
      }
      // Fire-and-forget queueing — the durable-write Promise is awaited at the
      // turn:end durability boundary via writer.drain(sessionId).
      void writer.enqueue(envelope).catch(() => {
        // Adapter failures surface via writer.drain() — do not double-throw here.
      })
    }
  }
}

export function createSessionContext(
  agentCtx: AgentContext,
  session: SessionState,
  eventTypeMap: EventTypeMap,
  writer: Writer | null,
): SessionContext {
  const ctx = {
    ...agentCtx,
    sessionId: session.id,
    state: session.state,
    emit: buildSessionEmit(session, eventTypeMap, writer),
  } as SessionContext
  defineLiveHistory(ctx, session)
  return ctx
}

export function createTurnContext(
  sessionCtx: SessionContext,
  input: Message[],
  turnId: string,
  turnIndex: number,
): TurnContext {
  // Get the live session reference from sessionCtx so the derived `history`
  // continues to update as new events land during the turn.
  const session = (sessionCtx as SessionContext & { _session?: SessionState })._session
  const ctx = {
    ...sessionCtx,
    input,
    output: null,
    turnId,
    turnIndex,
    startedAt: Date.now(),
    abort(reason: string): never {
      throw new AbortError(reason)
    },
  } as TurnContext
  if (session) defineLiveHistory(ctx, session)
  return ctx
}

/**
 * Define `history` as a live getter on the given context. Re-derives the
 * `Message[]` view from the underlying event log on each access so chained
 * contexts (turn → model → tool) all see the latest projection.
 */
function defineLiveHistory(ctx: object, session: SessionState): void {
  Object.defineProperty(ctx, "history", {
    get() {
      return session.history
    },
    enumerable: true,
    configurable: true,
  })
  // Also stash the session ref so chained contexts can rebind the getter.
  Object.defineProperty(ctx, "_session", {
    value: session,
    enumerable: false,
    writable: false,
    configurable: true,
  })
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
