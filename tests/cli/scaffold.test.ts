import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { scaffoldFromTemplate } from "../../packages/create-agent-express/src/template-scaffold.js"

const TEMPLATES = ["default", "support-bot", "research", "coding"] as const

describe("scaffoldFromTemplate", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ae-test-"))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true })
  })

  it("copies default template files", async () => {
    await scaffoldFromTemplate(dir, "default", {
      projectName: "test-project",
      provider: "anthropic",
      model: "anthropic/claude-sonnet-4-6",
    })

    const entries = await readdir(dir, { recursive: true })
    const paths = entries.map(String)

    expect(paths).toContain("package.json")
    expect(paths).toContain("tsconfig.json")
    expect(paths).toContain("AGENTS.md")
    expect(paths).toContain("CLAUDE.md")
    expect(paths).toContain(".gitignore")
    // Nested files — readdir recursive returns relative paths with separators
    expect(paths.some((p) => p.endsWith("agent.ts") && p.includes("src"))).toBe(true)
    expect(paths.some((p) => p.endsWith("agent.agent.test.ts") && p.includes("tests"))).toBe(true)
  })

  it("substitutes project name in package.json", async () => {
    await scaffoldFromTemplate(dir, "default", {
      projectName: "my-cool-agent",
      provider: "anthropic",
      model: "anthropic/claude-sonnet-4-6",
    })

    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf-8"))
    expect(pkg.name).toBe("my-cool-agent")
  })

  it("renames _gitignore to .gitignore", async () => {
    await scaffoldFromTemplate(dir, "default", {
      projectName: "test-project",
      provider: "anthropic",
      model: "anthropic/claude-sonnet-4-6",
    })

    const entries = await readdir(dir)
    expect(entries).toContain(".gitignore")
    expect(entries).not.toContain("_gitignore")
  })

  it("each template produces valid file structure", async () => {
    for (const template of TEMPLATES) {
      const templateDir = await mkdtemp(join(tmpdir(), `ae-test-${template}-`))

      try {
        await scaffoldFromTemplate(templateDir, template, {
          projectName: `test-${template}`,
          provider: "anthropic",
          model: "anthropic/claude-sonnet-4-6",
        })

        const entries = await readdir(templateDir, { recursive: true })
        const paths = entries.map(String)

        expect(paths, `${template}: missing package.json`).toContain("package.json")
        expect(paths, `${template}: missing tsconfig.json`).toContain("tsconfig.json")
        expect(paths, `${template}: missing .gitignore`).toContain(".gitignore")
        expect(
          paths.some((p) => p.endsWith("agent.ts") && p.includes("src")),
          `${template}: missing src/agent.ts`,
        ).toBe(true)
        expect(
          paths.some((p) => p.endsWith("agent.agent.test.ts") && p.includes("tests")),
          `${template}: missing tests/agent.agent.test.ts`,
        ).toBe(true)
      } finally {
        await rm(templateDir, { recursive: true })
      }
    }
  })
})
