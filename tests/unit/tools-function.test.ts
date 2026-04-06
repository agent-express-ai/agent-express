import { describe, it, expect, vi } from "vitest"
import { toolsFunction } from "../../src/tools/function.js"
import { z } from "zod"
import type { Tool } from "../../src/types.js"

/** Calls the agent hook with a mock context and returns registered tools. */
async function getRegisteredTools(mw: ReturnType<typeof toolsFunction>): Promise<Tool[]> {
  const tools: Tool[] = []
  const mockCtx = {
    agent: { name: "test", model: "mock", instructions: "test" },
    registerTool: (tool: Tool) => tools.push(tool),
    config: {},
  }
  await mw.agent!(mockCtx as any, async () => {})
  return tools
}

describe("tools.function()", () => {
  it("creates middleware with a single tool", async () => {
    const mw = toolsFunction({
      name: "add",
      description: "Add two numbers",
      schema: z.object({ a: z.number(), b: z.number() }),
      execute: async ({ a, b }) => (a as number) + (b as number),
    })

    expect(mw.name).toBe("tools:add")
    expect(mw.agent).toBeDefined()

    const tools = await getRegisteredTools(mw)
    expect(tools).toHaveLength(1)
    expect(tools[0]!.name).toBe("add")
    expect(tools[0]!.description).toBe("Add two numbers")
    expect(tools[0]!.jsonSchema).toEqual({
      type: "object",
      properties: {
        a: { type: "number" },
        b: { type: "number" },
      },
      required: ["a", "b"],
    })
  })

  it("creates middleware with multiple tools", async () => {
    const mw = toolsFunction([
      {
        name: "add",
        description: "Add",
        schema: z.object({ a: z.number(), b: z.number() }),
        execute: async () => 0,
      },
      {
        name: "multiply",
        description: "Multiply",
        schema: z.object({ a: z.number(), b: z.number() }),
        execute: async () => 0,
      },
    ])

    expect(mw.name).toBe("tools:add,multiply")

    const tools = await getRegisteredTools(mw)
    expect(tools).toHaveLength(2)
  })

  it("converts Zod schema with optional and string fields", async () => {
    const mw = toolsFunction({
      name: "search",
      description: "Search",
      schema: z.object({
        query: z.string(),
        limit: z.number().optional(),
      }),
      execute: async () => [],
    })

    const tools = await getRegisteredTools(mw)
    const jsonSchema = tools[0]!.jsonSchema
    expect(jsonSchema).toEqual({
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"], // limit is optional — not in required
    })
  })

  it("sets default timeout to 30000", async () => {
    const mw = toolsFunction({
      name: "test",
      description: "test",
      schema: z.object({}),
      execute: async () => null,
    })
    const tools = await getRegisteredTools(mw)
    expect(tools[0]!.timeout).toBe(30000)
  })

  it("respects custom timeout", async () => {
    const mw = toolsFunction({
      name: "test",
      description: "test",
      schema: z.object({}),
      execute: async () => null,
      timeout: 5000,
    })
    const tools = await getRegisteredTools(mw)
    expect(tools[0]!.timeout).toBe(5000)
  })
})
