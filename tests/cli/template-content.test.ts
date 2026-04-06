import { describe, it, expect } from "vitest"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

const TEMPLATES_DIR = resolve(import.meta.dirname!, "../../packages/create-agent-express/templates")
const TEMPLATES = ["default", "support-bot", "research", "coding"] as const

async function readTemplate(template: string, ...segments: string[]): Promise<string> {
  return readFile(resolve(TEMPLATES_DIR, template, ...segments), "utf-8")
}

describe("template content validation", () => {
  it("each template agent.ts contains export default", async () => {
    for (const template of TEMPLATES) {
      const content = await readTemplate(template, "src", "agent.ts")
      expect(content, `${template}/src/agent.ts missing 'export default'`).toContain("export default")
    }
  })

  it("each template test file imports from agent-express/test", async () => {
    for (const template of TEMPLATES) {
      const content = await readTemplate(template, "tests", "agent.agent.test.ts")
      const importsTestModel = content.includes("TestModel")
      const importsFunctionModel = content.includes("FunctionModel")
      expect(
        importsTestModel || importsFunctionModel,
        `${template}/tests/agent.agent.test.ts should import TestModel or FunctionModel`,
      ).toBe(true)
    }
  })

  it("each template package.json has dev and test scripts", async () => {
    for (const template of TEMPLATES) {
      const content = await readTemplate(template, "package.json")
      const pkg = JSON.parse(content)
      expect(pkg.scripts, `${template}/package.json missing scripts`).toBeDefined()
      expect(pkg.scripts.dev, `${template}/package.json missing dev script`).toBeDefined()
      expect(pkg.scripts.test, `${template}/package.json missing test script`).toBeDefined()
    }
  })

  it("support-bot template uses guard.budget, guard.approve, guard.input, memory.compaction, observe.log", async () => {
    const content = await readTemplate("support-bot", "src", "agent.ts")
    expect(content).toContain("guard.budget")
    expect(content).toContain("guard.approve")
    expect(content).toContain("guard.input")
    expect(content).toContain("memory.compaction")
    expect(content).toContain("observe.log")
  })

  it("research template uses model.router, guard.output, guard.timeout", async () => {
    const content = await readTemplate("research", "src", "agent.ts")
    expect(content).toContain("model.router")
    expect(content).toContain("guard.output")
    expect(content).toContain("guard.timeout")
  })

  it("coding template uses guard.approve, guard.budget, dev.console", async () => {
    const content = await readTemplate("coding", "src", "agent.ts")
    expect(content).toContain("guard.approve")
    expect(content).toContain("guard.budget")
    expect(content).toContain("dev.console")
  })
})
