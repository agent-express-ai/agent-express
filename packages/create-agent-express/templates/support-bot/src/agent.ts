import { Agent, tools, guard, memory, observe, approve, deny } from "agent-express"
import { z } from "zod"

// Fake order database
const ORDERS = [
  { id: "ORD-001", customer: "Alice", status: "delivered", items: ["Blue T-Shirt", "Sneakers"], total: 89.99 },
  { id: "ORD-002", customer: "Bob", status: "in_transit", items: ["Laptop Stand"], total: 49.99 },
  { id: "ORD-003", customer: "Charlie", status: "processing", items: ["Wireless Mouse", "Keyboard", "Monitor"], total: 549.97 },
]

const agent = new Agent({
  name: "support-bot",
  model: "anthropic/claude-sonnet-4-6",
  instructions: `You are a customer support agent for ShopCo, an e-commerce store.

Your responsibilities:
- Help customers look up their orders by order ID
- Process refund requests when appropriate
- Be friendly, professional, and concise
- Always verify the order exists before discussing it
- Only process refunds for delivered orders

If a customer asks about something outside your scope, politely redirect them.`,
})

// Order lookup tool
agent.use(
  tools.function({
    name: "lookup_order",
    description: "Look up an order by its ID. Returns order details including status, items, and total.",
    schema: z.object({
      id: z.string().describe("Order ID, e.g. 'ORD-001'"),
    }),
    execute: async ({ id }) => {
      const order = ORDERS.find((o) => o.id === id)
      if (!order) return { error: `Order ${id} not found` }
      return order
    },
  }),
)

// Refund tool (requires approval)
agent.use(
  tools.function({
    name: "process_refund",
    description: "Process a refund for an order. Only works for delivered orders.",
    schema: z.object({
      orderId: z.string().describe("Order ID to refund"),
      reason: z.string().describe("Reason for the refund"),
    }),
    execute: async ({ orderId, reason }) => {
      const order = ORDERS.find((o) => o.id === orderId)
      if (!order) return { error: `Order ${orderId} not found` }
      if (order.status !== "delivered") return { error: `Cannot refund order with status: ${order.status}` }
      return {
        refundId: `REF-${Date.now()}`,
        orderId,
        amount: order.total,
        reason,
        status: "processed",
      }
    },
    requireApproval: true,
  }),
)

// Budget guard — cap cost at $1.00 per session
agent.use(guard.budget({ limit: 1.0 }))

// Approval gate for process_refund
agent.use(
  guard.approve({
    approve: async (toolName, args) => {
      // Auto-approve lookups, require approval for refunds
      if (toolName === "process_refund") {
        // In production, this would prompt a human operator
        // For now, auto-approve refunds under $100
        const orderId = args.orderId as string
        const order = ORDERS.find((o) => o.id === orderId)
        if (order && order.total < 100) return approve()
        return deny("Refund over $100 requires manual approval")
      }
      return approve()
    },
  }),
)

// Input guard — block prompt injection patterns
agent.use(
  guard.input(async (ctx) => {
    const lastMsg = ctx.messages[ctx.messages.length - 1]
    if (!lastMsg || typeof lastMsg.content !== "string") return { ok: true }

    const content = lastMsg.content.toLowerCase()
    const blockedPatterns = [
      "ignore previous instructions",
      "ignore all previous",
      "disregard your instructions",
      "forget your rules",
      "you are now",
      "new instructions:",
    ]

    for (const pattern of blockedPatterns) {
      if (content.includes(pattern)) {
        return { ok: false, reason: "Potential prompt injection detected" }
      }
    }

    return { ok: true }
  }),
)

// Memory compaction — keep context manageable
agent.use(memory.compaction({ maxTokens: 4096 }))

// Structured JSON logging
agent.use(observe.log())

export default agent
export { agent }
