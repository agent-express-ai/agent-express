import { Agent, tools, guard, dev, approve, deny } from "agent-express"
import { z } from "zod"
import * as fs from "node:fs/promises"
import * as path from "node:path"

const agent = new Agent({
  name: "coding",
  model: "anthropic/claude-sonnet-4-6",
  instructions: `You are a coding assistant that can read, write, and explore files.

Your capabilities:
- Read file contents with read_file
- Write or update files with write_file
- List directory contents with list_dir

Guidelines:
- Always read a file before modifying it
- Prefer small, focused changes over large rewrites
- Explain what you changed and why
- Respect existing code style and conventions`,
})

// Read file tool
agent.use(
  tools.function({
    name: "read_file",
    description: "Read the contents of a file at the given path. Returns the file content as a string.",
    schema: z.object({
      path: z.string().describe("File path to read"),
    }),
    execute: async ({ path: filePath }) => {
      try {
        const content = await fs.readFile(filePath as string, "utf-8")
        return { content, size: content.length }
      } catch (err) {
        return { error: `Failed to read file: ${(err as Error).message}` }
      }
    },
  }),
)

// Write file tool (requires approval)
agent.use(
  tools.function({
    name: "write_file",
    description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does.",
    schema: z.object({
      path: z.string().describe("File path to write"),
      content: z.string().describe("Content to write to the file"),
    }),
    execute: async ({ path: filePath, content }) => {
      try {
        const dir = path.dirname(filePath as string)
        await fs.mkdir(dir, { recursive: true })
        await fs.writeFile(filePath as string, content as string, "utf-8")
        return { written: true, path: filePath, size: (content as string).length }
      } catch (err) {
        return { error: `Failed to write file: ${(err as Error).message}` }
      }
    },
    requireApproval: true,
  }),
)

// List directory tool
agent.use(
  tools.function({
    name: "list_dir",
    description: "List the contents of a directory. Returns file and directory names with their types.",
    schema: z.object({
      path: z.string().describe("Directory path to list"),
    }),
    execute: async ({ path: dirPath }) => {
      try {
        const entries = await fs.readdir(dirPath as string, { withFileTypes: true })
        return {
          path: dirPath,
          entries: entries.map((e) => ({
            name: e.name,
            type: e.isDirectory() ? "directory" : "file",
          })),
        }
      } catch (err) {
        return { error: `Failed to list directory: ${(err as Error).message}` }
      }
    },
  }),
)

// Approval gate for write_file
agent.use(
  guard.approve({
    approve: async (toolName, args) => {
      if (toolName === "write_file") {
        const filePath = args.path as string
        // Block writes to sensitive paths
        const blockedPaths = ["/etc", "/usr", "/System", "/bin", "/sbin"]
        for (const blocked of blockedPaths) {
          if (filePath.startsWith(blocked)) {
            return deny(`Writing to ${blocked} is not allowed`)
          }
        }
        // In production, prompt the user for confirmation
        return approve()
      }
      return approve()
    },
  }),
)

// Budget guard — cap cost at $0.50 per session
agent.use(guard.budget({ limit: 0.50 }))

// Dev console — terminal trace for development
agent.use(dev.console())

export default agent
export { agent }
