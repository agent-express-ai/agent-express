import { describe, it, expect, vi } from "vitest"
import { Agent } from "../../src/agent.js"
import { toolsFunction } from "../../src/tools/function.js"
import { guardApprove, approve, deny, modify } from "../../src/middleware/guard/approve.js"
import { FunctionModel } from "../../src/test/function-model.js"
import { z } from "zod"

/** Model that calls a tool on first call, returns text on second. */
function toolCallingModel(toolName: string, toolArgs: Record<string, unknown>) {
  return new FunctionModel((_msgs, { callIndex }) => {
    if (callIndex === 0) {
      return {
        toolCalls: [{ toolCallId: "tc1", toolName, args: toolArgs }],
        usage: { inputTokens: 0, outputTokens: 0 },
        finishReason: "tool-calls",
      }
    }
    return { text: "Done", usage: { inputTokens: 0, outputTokens: 0 }, finishReason: "stop" }
  })
}

function createAgent(model: any) {
  return new Agent({ name: "test", model, instructions: "test", defaults: false })
}

describe("guard.approve()", () => {
  // US1: Per-tool requireApproval flag
  describe("requireApproval flag", () => {
    it("tool with requireApproval=true triggers approval function", async () => {
      const approveFn = vi.fn(async () => approve())

      const agent = createAgent(toolCallingModel("danger", { x: 1 }))
        .use(toolsFunction({
          name: "danger",
          description: "Dangerous tool",
          schema: z.object({ x: z.number() }),
          execute: async () => "executed",
          requireApproval: true,
        }))
        .use(guardApprove({ approve: approveFn }))

      await agent.run("test").result
      expect(approveFn).toHaveBeenCalledTimes(1)
      expect(approveFn).toHaveBeenCalledWith("danger", expect.any(Object), expect.any(Object))
    })

    it("tool without requireApproval skips approval", async () => {
      const approveFn = vi.fn(async () => approve())

      const agent = createAgent(toolCallingModel("safe", { x: 1 }))
        .use(toolsFunction({
          name: "safe",
          description: "Safe tool",
          schema: z.object({ x: z.number() }),
          execute: async () => "executed",
          // no requireApproval
        }))
        .use(guardApprove({ approve: approveFn }))

      await agent.run("test").result
      expect(approveFn).not.toHaveBeenCalled()
    })

    it("conditional requireApproval function called with args", async () => {
      const approveFn = vi.fn(async () => approve())

      const agent = createAgent(toolCallingModel("transfer", { amount: 5000 }))
        .use(toolsFunction({
          name: "transfer",
          description: "Transfer money",
          schema: z.object({ amount: z.number() }),
          execute: async () => "transferred",
          requireApproval: ({ amount }) => (amount as number) > 1000,
        }))
        .use(guardApprove({ approve: approveFn }))

      await agent.run("test").result
      expect(approveFn).toHaveBeenCalledTimes(1) // 5000 > 1000

      approveFn.mockClear()

      // Small amount — no approval needed
      const agent2 = createAgent(toolCallingModel("transfer", { amount: 50 }))
        .use(toolsFunction({
          name: "transfer",
          description: "Transfer money",
          schema: z.object({ amount: z.number() }),
          execute: async () => "transferred",
          requireApproval: ({ amount }) => (amount as number) > 1000,
        }))
        .use(guardApprove({ approve: approveFn }))

      await agent2.run("test").result
      expect(approveFn).not.toHaveBeenCalled() // 50 < 1000
    })
  })

  // US2: Decisions
  describe("approval decisions", () => {
    it("approve() executes tool normally", async () => {
      let executed = false
      const agent = createAgent(toolCallingModel("action", {}))
        .use(toolsFunction({
          name: "action",
          description: "Do something",
          schema: z.object({}),
          execute: async () => { executed = true; return "done" },
          requireApproval: true,
        }))
        .use(guardApprove({ approve: async () => approve() }))

      await agent.run("test").result
      expect(executed).toBe(true)
    })

    it("deny() blocks tool, returns reason to model", async () => {
      let executed = false
      const agent = createAgent(toolCallingModel("action", {}))
        .use(toolsFunction({
          name: "action",
          description: "Do something",
          schema: z.object({}),
          execute: async () => { executed = true; return "done" },
          requireApproval: true,
        }))
        .use(guardApprove({ approve: async () => deny("Not allowed") }))

      const { text } = await agent.run("test").result
      expect(executed).toBe(false)
      expect(text).toBe("Done") // Model gets the denial and responds
    })

    it("modify() changes args before execution", async () => {
      let receivedArgs: any = null
      const agent = createAgent(toolCallingModel("action", { value: "original" }))
        .use(toolsFunction({
          name: "action",
          description: "Do something",
          schema: z.object({ value: z.string() }),
          execute: async (args) => { receivedArgs = args; return "done" },
          requireApproval: true,
        }))
        .use(guardApprove({
          approve: async () => modify({ value: "modified" }),
        }))

      await agent.run("test").result
      expect(receivedArgs.value).toBe("modified")
    })

    it("remember=true skips approval on subsequent calls", async () => {
      const approveFn = vi.fn(async () => approve({ remember: true }))

      // Model calls the same tool twice
      let callCount = 0
      const model = new FunctionModel((_msgs, { callIndex }) => {
        if (callIndex < 2) {
          return {
            toolCalls: [{ toolCallId: `tc${callIndex}`, toolName: "action", args: {} }],
            usage: { inputTokens: 0, outputTokens: 0 },
            finishReason: "tool-calls",
          }
        }
        return { text: "Done", usage: { inputTokens: 0, outputTokens: 0 }, finishReason: "stop" }
      })

      const agent = createAgent(model)
        .use(toolsFunction({
          name: "action",
          description: "Do",
          schema: z.object({}),
          execute: async () => "ok",
          requireApproval: true,
        }))
        .use(guardApprove({ approve: approveFn }))

      await agent.run("test").result
      // First call triggers approval, second is remembered
      expect(approveFn).toHaveBeenCalledTimes(1)
    })

    it("approval function throw → deny with error message", async () => {
      let executed = false
      const agent = createAgent(toolCallingModel("action", {}))
        .use(toolsFunction({
          name: "action",
          description: "Do",
          schema: z.object({}),
          execute: async () => { executed = true; return "done" },
          requireApproval: true,
        }))
        .use(guardApprove({
          approve: async () => { throw new Error("Approval service down") },
        }))

      await agent.run("test").result
      expect(executed).toBe(false) // Denied due to throw
    })
  })

  // US3: Async
  describe("async approval", () => {
    it("async approval function pauses and resumes", async () => {
      let executed = false
      const agent = createAgent(toolCallingModel("action", {}))
        .use(toolsFunction({
          name: "action",
          description: "Do",
          schema: z.object({}),
          execute: async () => { executed = true; return "done" },
          requireApproval: true,
        }))
        .use(guardApprove({
          approve: async () => {
            await new Promise((r) => setTimeout(r, 50)) // simulate delay
            return approve()
          },
        }))

      await agent.run("test").result
      expect(executed).toBe(true)
    })
  })

  // Helper functions
  describe("helper functions", () => {
    it("approve() creates correct decision", () => {
      expect(approve()).toEqual({ action: "approve" })
      expect(approve({ remember: true })).toEqual({ action: "approve", remember: true })
    })

    it("deny() creates correct decision", () => {
      expect(deny("reason")).toEqual({ action: "deny", reason: "reason" })
    })

    it("modify() creates correct decision", () => {
      expect(modify({ x: 1 })).toEqual({ action: "modify", args: { x: 1 } })
    })
  })
})
