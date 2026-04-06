import { describe, it, expect } from "vitest"
import { Agent, tools, guard, approve, deny } from "agent-express"
import { TestModel, testAgent } from "agent-express/test"
import { z } from "zod"

// Fake order data (matches src/agent.ts)
const ORDERS = [
  { id: "ORD-001", customer: "Alice", status: "delivered", items: ["Blue T-Shirt", "Sneakers"], total: 89.99 },
  { id: "ORD-002", customer: "Bob", status: "in_transit", items: ["Laptop Stand"], total: 49.99 },
  { id: "ORD-003", customer: "Charlie", status: "processing", items: ["Wireless Mouse", "Keyboard", "Monitor"], total: 549.97 },
]

function createTestAgent(opts?: { defaultText?: string }) {
  const agent = new Agent({
    name: "support-bot",
    model: new TestModel({ defaultText: opts?.defaultText ?? "I found your order. How can I help?" }),
    instructions: "You are a customer support agent for ShopCo.",
    defaults: false,
  })

  agent.use(
    tools.function({
      name: "lookup_order",
      description: "Look up an order by its ID",
      schema: z.object({
        id: z.string().describe("Order ID"),
      }),
      execute: async ({ id }) => {
        const order = ORDERS.find((o) => o.id === id)
        if (!order) return { error: `Order ${id} not found` }
        return order
      },
    }),
  )

  agent.use(
    tools.function({
      name: "process_refund",
      description: "Process a refund for an order",
      schema: z.object({
        orderId: z.string().describe("Order ID to refund"),
        reason: z.string().describe("Reason for the refund"),
      }),
      execute: async ({ orderId, reason }) => {
        const order = ORDERS.find((o) => o.id === orderId)
        if (!order) return { error: `Order ${orderId} not found` }
        return { refundId: "REF-123", orderId, amount: order.total, reason, status: "processed" }
      },
      requireApproval: true,
    }),
  )

  // Auto-approve all tools in test
  agent.use(
    guard.approve({
      approve: async () => approve(),
    }),
  )

  return agent
}

describe("support-bot agent", () => {
  it("should respond to a greeting", async () => {
    const agent = createTestAgent()
    const { text } = await agent.run("Hi, I need help with my order").result

    expect(text).toBeDefined()
    expect(typeof text).toBe("string")
  })

  it("should call lookup_order tool", async () => {
    const agent = createTestAgent()
    const result = await testAgent(agent, {
      input: "Can you look up order ORD-001?",
      expect: {
        toolsCalled: ["lookup_order"],
      },
    })

    expect(result.passed).toBe(true)
  })

  it("should call both lookup_order and process_refund", async () => {
    const agent = createTestAgent()
    const result = await testAgent(agent, {
      input: "I want to refund order ORD-001 because the shirt was damaged",
      expect: {
        toolsCalled: ["lookup_order", "process_refund"],
      },
    })

    expect(result.passed).toBe(true)
  })

  it("should return order data from lookup_order", async () => {
    const agent = createTestAgent()
    const { text } = await agent.run("Check order ORD-002").result

    expect(text).toBeDefined()
  })
})
