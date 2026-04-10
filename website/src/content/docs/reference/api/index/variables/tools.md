---
editUrl: false
next: false
prev: false
title: "tools"
---

> `const` **tools**: `object`

## Type Declaration

### function

> **function**: (`defs`) => [`Middleware`](/reference/api/index/interfaces/middleware/) = `toolsFunction`

Create function tools with Zod schemas.

Creates a middleware that registers function tools on an agent.

Accepts a single ToolDef or an array of ToolDefs.
Tools are registered via `ctx.registerTool()` in the `agent` hook
and are available to the LLM for the agent's lifetime.

#### Parameters

##### defs

[`ToolDef`](/reference/api/index/interfaces/tooldef/) \| [`ToolDef`](/reference/api/index/interfaces/tooldef/)[]

#### Returns

[`Middleware`](/reference/api/index/interfaces/middleware/)

#### Example

```typescript
agent.use(tools.function({
  name: "add",
  description: "Add two numbers",
  schema: z.object({ a: z.number(), b: z.number() }),
  execute: async ({ a, b }) => a + b,
}))
```

### mcp

> **mcp**: (`config`) => [`Middleware`](/reference/api/index/interfaces/middleware/) = `mcpTools`

Connect to an MCP server and register its tools.

Creates a `tools.mcp()` middleware that connects to an MCP server,
discovers its tools, and registers them on the agent.

One server per `.use()` call. For multiple servers, call `.use()` multiple times.
Requires `@modelcontextprotocol/sdk` as a peer dependency (optional install).

#### Parameters

##### config

[`McpServerConfig`](/reference/api/index/type-aliases/mcpserverconfig/)

MCP server connection configuration

#### Returns

[`Middleware`](/reference/api/index/interfaces/middleware/)

Middleware that connects to the MCP server and registers its tools

#### Example

```typescript
// Local process via stdio
agent.use(tools.mcp({
  name: "crm",
  transport: "stdio",
  command: "npx",
  args: ["-y", "@acme/crm-mcp"],
}))

// Remote server via HTTP
agent.use(tools.mcp({
  name: "docs",
  transport: "http",
  url: "https://mcp.example.com",
  headers: { "Authorization": "Bearer token" },
}))
```
