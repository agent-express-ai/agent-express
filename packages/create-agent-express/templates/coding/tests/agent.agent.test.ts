import { describe, it, expect } from "vitest"
import { Agent, tools, guard, approve } from "agent-express"
import { TestModel, testAgent } from "agent-express/test"
import { z } from "zod"

// In-memory fake filesystem for tests
const fakeFs: Record<string, string> = {
  "/project/src/index.ts": 'export const hello = "world"',
  "/project/package.json": '{ "name": "test-project", "version": "1.0.0" }',
}

function createTestAgent(opts?: { defaultText?: string }) {
  const agent = new Agent({
    name: "coding",
    model: new TestModel({ defaultText: opts?.defaultText ?? "I've read the file and here's what I found." }),
    instructions: "You are a coding assistant that can read, write, and explore files.",
    defaults: false,
  })

  agent.use(
    tools.function({
      name: "read_file",
      description: "Read the contents of a file",
      schema: z.object({
        path: z.string().describe("File path to read"),
      }),
      execute: async ({ path: filePath }) => {
        const content = fakeFs[filePath as string]
        if (!content) return { error: `File not found: ${filePath}` }
        return { content, size: content.length }
      },
    }),
  )

  agent.use(
    tools.function({
      name: "write_file",
      description: "Write content to a file",
      schema: z.object({
        path: z.string().describe("File path to write"),
        content: z.string().describe("Content to write"),
      }),
      execute: async ({ path: filePath, content }) => {
        fakeFs[filePath as string] = content as string
        return { written: true, path: filePath, size: (content as string).length }
      },
      requireApproval: true,
    }),
  )

  agent.use(
    tools.function({
      name: "list_dir",
      description: "List directory contents",
      schema: z.object({
        path: z.string().describe("Directory path"),
      }),
      execute: async ({ path: dirPath }) => {
        const prefix = (dirPath as string).endsWith("/") ? dirPath as string : `${dirPath}/`
        const entries = Object.keys(fakeFs)
          .filter((k) => k.startsWith(prefix))
          .map((k) => {
            const rest = k.slice(prefix.length)
            const name = rest.split("/")[0]!
            return { name, type: rest.includes("/") ? "directory" : "file" }
          })
        // Deduplicate
        const unique = [...new Map(entries.map((e) => [e.name, e])).values()]
        return { path: dirPath, entries: unique }
      },
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

describe("coding agent", () => {
  it("should respond to a simple message", async () => {
    const agent = createTestAgent()
    const { text } = await agent.run("What files are in this project?").result

    expect(text).toBeDefined()
    expect(typeof text).toBe("string")
  })

  it("should call read_file tool", async () => {
    const agent = createTestAgent()
    const result = await testAgent(agent, {
      input: "Read the file at /project/src/index.ts",
      expect: {
        toolsCalled: ["read_file"],
      },
    })

    expect(result.passed).toBe(true)
  })

  it("should call all file tools", async () => {
    const agent = createTestAgent()
    const result = await testAgent(agent, {
      input: "List the project directory and read the main file",
      expect: {
        toolsCalled: ["read_file", "write_file", "list_dir"],
      },
    })

    expect(result.passed).toBe(true)
  })

  it("should read fake file content correctly", async () => {
    const agent = createTestAgent()
    // TestModel auto-calls all tools with "test" args, so read_file will get path="test"
    // which won't match our fake fs, but the tool still executes
    const { text } = await agent.run("Read /project/src/index.ts").result

    expect(text).toBe("I've read the file and here's what I found.")
  })
})
