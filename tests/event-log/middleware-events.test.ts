import { describe, it, expect } from "vitest"
import { z } from "zod"

import { Agent } from "../../src/agent.js"
import { toolsFunction } from "../../src/tools/function.js"
import { guardApprove, approve, deny, modify } from "../../src/middleware/guard/approve.js"
import { budgetGuard } from "../../src/middleware/guard/budget.js"
import { guardTimeout } from "../../src/middleware/guard/timeout.js"
import { guardMaxIterations } from "../../src/middleware/guard/max-iterations.js"
import { guardRateLimit } from "../../src/middleware/guard/rate-limit.js"
import { inputGuard } from "../../src/middleware/guard/input.js"
import { outputGuard } from "../../src/middleware/guard/output.js"
import { memoryCompaction } from "../../src/middleware/memory/compaction.js"
import { FunctionModel } from "../../src/test/function-model.js"
import type { Event } from "../../src/types.js"

/** Helper: collect every event from an `agent.run()` iteration. */
async function runAndCollect(agent: Agent, input: string): Promise<Event[]> {
  const out: Event[] = []
  const run = agent.run(input)
  for await (const ev of run) out.push(ev)
  await run.result.catch(() => {}) // swallow guard-thrown errors
  return out
}

/** Model that returns one tool call then a text. */
function toolCallingModel(toolName: string, toolArgs: Record<string, unknown> = {}) {
  return new FunctionModel((_msgs, { callIndex }) => {
    if (callIndex === 0) {
      return {
        toolCalls: [{ toolCallId: "tc1", toolName, args: toolArgs }],
        usage: { inputTokens: 0, outputTokens: 0 },
        finishReason: "tool-calls",
      }
    }
    return { text: "done", usage: { inputTokens: 0, outputTokens: 0 }, finishReason: "stop" }
  })
}

describe("middleware-emitted events", () => {
  describe("guard.approve → permission:*", () => {
    it("emits permission:approved on approve", async () => {
      const agent = new Agent({ name: "t", model: toolCallingModel("danger"), defaults: false })
        .use(toolsFunction({
          name: "danger",
          description: "x",
          schema: z.object({}),
          execute: async () => "ok",
          requireApproval: true,
        }))
        .use(guardApprove({ approve: async () => approve({ remember: true }) }))

      const events = await runAndCollect(agent, "go")
      const perm = events.filter((e) => e.type === "permission:approved")
      expect(perm).toHaveLength(1)
      const payload = perm[0]!.payload as { tool: string; callId: string; remembered?: boolean }
      expect(payload.tool).toBe("danger")
      expect(payload.callId).toBe("tc1")
      expect(payload.remembered).toBe(true)
    })

    it("emits permission:denied on deny", async () => {
      const agent = new Agent({ name: "t", model: toolCallingModel("danger"), defaults: false })
        .use(toolsFunction({
          name: "danger",
          description: "x",
          schema: z.object({}),
          execute: async () => "ok",
          requireApproval: true,
        }))
        .use(guardApprove({ approve: async () => deny("policy violation") }))

      const events = await runAndCollect(agent, "go")
      const perm = events.filter((e) => e.type === "permission:denied")
      expect(perm).toHaveLength(1)
      const payload = perm[0]!.payload as { tool: string; reason: string }
      expect(payload.tool).toBe("danger")
      expect(payload.reason).toBe("policy violation")
    })

    it("emits permission:modified with originalArgs and modifiedArgs on modify", async () => {
      const agent = new Agent({ name: "t", model: toolCallingModel("danger", { input: "raw" }), defaults: false })
        .use(toolsFunction({
          name: "danger",
          description: "x",
          schema: z.object({ input: z.string() }),
          execute: async () => "ok",
          requireApproval: true,
        }))
        .use(guardApprove({ approve: async () => modify({ input: "sanitized" }) }))

      const events = await runAndCollect(agent, "go")
      const perm = events.filter((e) => e.type === "permission:modified")
      expect(perm).toHaveLength(1)
      const payload = perm[0]!.payload as {
        tool: string
        originalArgs: Record<string, unknown>
        modifiedArgs: Record<string, unknown>
      }
      expect(payload.originalArgs).toEqual({ input: "raw" })
      expect(payload.modifiedArgs).toEqual({ input: "sanitized" })
    })
  })

  describe("memory.compaction → compaction:applied", () => {
    it("emits compaction:applied with strategy and message counts when compaction runs", async () => {
      // Fill the conversation with enough messages to trigger compaction.
      // maxTokens=10 forces compaction on virtually any input.
      const model = new FunctionModel(() => ({
        text: "ok",
        usage: { inputTokens: 0, outputTokens: 0 },
        finishReason: "stop",
      }))

      const agent = new Agent({ name: "t", model, defaults: false })
        .use(memoryCompaction({ maxTokens: 10, strategy: "truncate" }))

      // Long input ensures token threshold is crossed.
      const longInput = "x ".repeat(200)
      const events = await runAndCollect(agent, longInput)

      const c = events.filter((e) => e.type === "compaction:applied")
      expect(c.length).toBeGreaterThan(0)
      const payload = c[0]!.payload as { strategy: string; tokensBefore?: number; tokensAfter?: number }
      expect(payload.strategy).toBe("truncate")
      expect(payload.tokensBefore).toBeGreaterThan(0)
    })
  })

  describe("guard.budget → turn:aborted{reason:'budget'}", () => {
    it("emits turn:aborted{reason:'budget'} when pre-call check exceeds limit", async () => {
      // Build a LanguageModelV3 mock that reports massive token usage so the
      // first turn pushes the running cost above the tiny limit. The second
      // turn then trips the pre-call check before any LLM round-trip.
      const mockModel: any = {
        specificationVersion: "v3",
        provider: "mock",
        modelId: "claude-sonnet-4-6",
        supportedUrls: {},
        doGenerate: async () => ({
          content: [{ type: "text", text: "ok" }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: { total: 1_000_000, noCache: 1_000_000, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 500_000, text: 500_000, reasoning: 0 },
          },
          warnings: [],
        }),
        doStream: async () => {
          throw new Error("not implemented")
        },
      }

      const agent = new Agent({ name: "t", model: mockModel, defaults: false })
      agent.use(budgetGuard({ limit: 0.001, onLimit: "stop" }))

      await agent.init()
      const session = agent.session()

      // First turn: pre-check passes (totalCost=0). After, cost accumulates above limit.
      const ev1: Event[] = []
      const r1 = session.run("first")
      for await (const e of r1) ev1.push(e)
      await r1.result
      expect(ev1.find((e) => e.type === "turn:aborted")).toBeUndefined()

      // Second turn: pre-check sees totalCost >= limit and emits turn:aborted.
      const ev2: Event[] = []
      const r2 = session.run("second")
      for await (const e of r2) ev2.push(e)
      await r2.result

      const aborted = ev2.filter((e) => e.type === "turn:aborted")
      expect(aborted.length).toBeGreaterThan(0)
      expect((aborted[0]!.payload as { reason: string }).reason).toBe("budget")

      await session.close()
      await agent.dispose()
    })
  })

  describe("guard.maxIterations → turn:aborted{reason:'maxIterations'}", () => {
    it("emits turn:aborted when max iterations strip tool calls", async () => {
      const model = new FunctionModel(() => ({
        text: "still calling",
        toolCalls: [{ toolCallId: "tc", toolName: "loop", args: {} }],
        usage: { inputTokens: 0, outputTokens: 0 },
        finishReason: "tool-calls",
      }))

      const agent = new Agent({ name: "t", model, defaults: false })
        .use(toolsFunction({
          name: "loop",
          description: "x",
          schema: z.object({}),
          execute: async () => "ok",
        }))
        .use(guardMaxIterations(2))

      const events = await runAndCollect(agent, "go")
      const aborted = events.filter(
        (e) => e.type === "turn:aborted" && (e.payload as { reason: string }).reason === "maxIterations",
      )
      expect(aborted.length).toBeGreaterThan(0)
    })
  })

  describe("guard.rateLimit → turn:aborted{reason:'rateLimit'}", () => {
    it("emits turn:aborted when rate limit triggers", async () => {
      const model = new FunctionModel(() => ({
        text: "ok",
        usage: { inputTokens: 0, outputTokens: 0 },
        finishReason: "stop",
      }))

      const agent = new Agent({ name: "t", model, defaults: false })
        .use(guardRateLimit({ maxPerMinute: 1, onExceeded: "message", message: "slow down" }))

      await agent.init()
      const session = agent.session()
      await session.run("first").result
      const events = await (async () => {
        const out: Event[] = []
        const run = session.run("second")
        for await (const ev of run) out.push(ev)
        await run.result
        return out
      })()

      const aborted = events.filter(
        (e) => e.type === "turn:aborted" && (e.payload as { reason: string }).reason === "rateLimit",
      )
      expect(aborted.length).toBeGreaterThan(0)
      await session.close()
      await agent.dispose()
    })
  })

  describe("guard.input → turn:aborted{reason:'input'}", () => {
    it("emits turn:aborted before throwing InputGuardrailError", async () => {
      const model = new FunctionModel(() => ({
        text: "ok",
        usage: { inputTokens: 0, outputTokens: 0 },
        finishReason: "stop",
      }))

      const agent = new Agent({ name: "t", model, defaults: false })
        .use(inputGuard(() => ({ ok: false, reason: "blocked" })))

      const events = await runAndCollect(agent, "go")
      const aborted = events.filter(
        (e) => e.type === "turn:aborted" && (e.payload as { reason: string }).reason === "input",
      )
      expect(aborted.length).toBeGreaterThan(0)
      // No `error` event should be emitted for this AbortError-like flow.
      // (InputGuardrailError is not an AbortError, so error IS emitted.
      // We only assert turn:aborted is present.)
    })
  })

  describe("guard.output → turn:aborted{reason:'output'}", () => {
    it("emits turn:aborted when output is blocked", async () => {
      const model = new FunctionModel(() => ({
        text: "ok",
        usage: { inputTokens: 0, outputTokens: 0 },
        finishReason: "stop",
      }))

      const agent = new Agent({ name: "t", model, defaults: false })
        .use(outputGuard({ validate: () => ({ ok: false, reason: "bad" }), onBlock: "replace" }))

      const events = await runAndCollect(agent, "go")
      const aborted = events.filter(
        (e) => e.type === "turn:aborted" && (e.payload as { reason: string }).reason === "output",
      )
      expect(aborted.length).toBeGreaterThan(0)
    })
  })

  describe("guard.timeout → turn:aborted{reason:'timeout'}", () => {
    it("emits turn:aborted when model timeout fires", async () => {
      const slowModel = new FunctionModel(async () => {
        await new Promise((r) => setTimeout(r, 200))
        return { text: "late", usage: { inputTokens: 0, outputTokens: 0 }, finishReason: "stop" }
      })

      const agent = new Agent({ name: "t", model: slowModel, defaults: false })
        .use(guardTimeout({ model: 50 }))

      const events = await runAndCollect(agent, "go")
      const aborted = events.filter(
        (e) => e.type === "turn:aborted" && (e.payload as { reason: string }).reason === "timeout",
      )
      expect(aborted.length).toBeGreaterThan(0)
    })
  })

  describe("ctx.abort → turn:aborted{reason:'abort'}", () => {
    it("emits turn:aborted{reason:'abort'} when middleware calls ctx.abort", async () => {
      const model = new FunctionModel(() => ({
        text: "ok",
        usage: { inputTokens: 0, outputTokens: 0 },
        finishReason: "stop",
      }))

      const agent = new Agent({ name: "t", model, defaults: false })
      agent.use(async (ctx, _next) => {
        ctx.abort("manual stop")
      })

      const events = await runAndCollect(agent, "go")
      const aborted = events.filter(
        (e) => e.type === "turn:aborted" && (e.payload as { reason: string }).reason === "abort",
      )
      expect(aborted).toHaveLength(1)
      const payload = aborted[0]!.payload as { reason: string; message?: string }
      expect(payload.message).toBe("manual stop")

      // turn:end should carry status="aborted"
      const turnEnd = events.find((e) => e.type === "turn:end")!
      expect((turnEnd.payload as { status: string }).status).toBe("aborted")

      // No `error` event should be emitted for AbortError path.
      const errs = events.filter((e) => e.type === "error")
      expect(errs).toHaveLength(0)
    })
  })

  describe("error event scope", () => {
    it("error event payload carries scope and kind for unexpected exceptions", async () => {
      const failingModel = new FunctionModel(() => {
        throw new Error("model exploded")
      })

      const agent = new Agent({ name: "t", model: failingModel, defaults: false })

      const events = await runAndCollect(agent, "go")
      const errs = events.filter((e) => e.type === "error")
      expect(errs).toHaveLength(1)
      const payload = errs[0]!.payload as { scope: string; kind: string; message: string }
      expect(payload.scope).toBe("turn")
      expect(payload.message).toContain("model exploded")
    })
  })
})
