import { describe, it, expect } from "vitest"
import { composeHooks } from "../../src/executor.js"
import type { Middleware, TurnContext } from "../../src/middleware.js"

describe("composeHooks", () => {
  it("executes in onion order (A-before, B-before, core, B-after, A-after)", async () => {
    const order: string[] = []

    const middlewareA: Middleware = {
      name: "A",
      turn: async (_ctx, next) => {
        order.push("A-before")
        await next()
        order.push("A-after")
      },
    }

    const middlewareB: Middleware = {
      name: "B",
      turn: async (_ctx, next) => {
        order.push("B-before")
        await next()
        order.push("B-after")
      },
    }

    const composed = composeHooks<TurnContext, void>(
      [middlewareA, middlewareB],
      "turn",
      async () => {
        order.push("core")
      },
    )

    await composed({} as TurnContext)

    expect(order).toEqual(["A-before", "B-before", "core", "B-after", "A-after"])
  })

  it("calls inner function directly when no middleware has the hook", async () => {
    const order: string[] = []

    const middlewareA: Middleware = {
      name: "A",
      // no turn hook
    }

    const composed = composeHooks<TurnContext, void>([middlewareA], "turn", async () => {
      order.push("core")
    })

    await composed({} as TurnContext)

    expect(order).toEqual(["core"])
  })

  it("propagates errors through the stack", async () => {
    const order: string[] = []

    const middlewareA: Middleware = {
      name: "A",
      turn: async (_ctx, next) => {
        order.push("A-before")
        try {
          await next()
        } catch (e) {
          order.push("A-catch")
          throw e
        }
      },
    }

    const middlewareB: Middleware = {
      name: "B",
      turn: async (_ctx, _next) => {
        order.push("B-before")
        throw new Error("B failed")
      },
    }

    const composed = composeHooks<TurnContext, void>(
      [middlewareA, middlewareB],
      "turn",
      async () => {
        order.push("core")
      },
    )

    await expect(composed({} as TurnContext)).rejects.toThrow("B failed")
    expect(order).toEqual(["A-before", "B-before", "A-catch"])
  })

  it("works with a single middleware", async () => {
    const order: string[] = []

    const middlewareA: Middleware = {
      name: "A",
      turn: async (_ctx, next) => {
        order.push("A-before")
        await next()
        order.push("A-after")
      },
    }

    const composed = composeHooks<TurnContext, void>([middlewareA], "turn", async () => {
      order.push("core")
    })

    await composed({} as TurnContext)

    expect(order).toEqual(["A-before", "core", "A-after"])
  })

  it("works with three middleware for model hook returning values", async () => {
    const middlewareA: Middleware = {
      name: "A",
      model: async (_ctx, next) => {
        const result = await next()
        return { ...result, text: result.text + " +A" }
      },
    }

    const middlewareB: Middleware = {
      name: "B",
      model: async (_ctx, next) => {
        const result = await next()
        return { ...result, text: result.text + " +B" }
      },
    }

    const middlewareC: Middleware = {
      name: "C",
      model: async (_ctx, next) => {
        const result = await next()
        return { ...result, text: result.text + " +C" }
      },
    }

    const composed = composeHooks(
      [middlewareA, middlewareB, middlewareC],
      "model",
      async () => ({
        text: "base",
        usage: { inputTokens: 0, outputTokens: 0 },
        finishReason: "stop",
      }),
    )

    const result = await composed({} as any)

    // Inner C is first to modify, then B, then A (onion unwinding)
    expect(result.text).toBe("base +C +B +A")
  })
})
