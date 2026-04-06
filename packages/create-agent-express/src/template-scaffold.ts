import { cp, readFile, writeFile, rename, readdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = fileURLToPath(new URL(".", import.meta.url))

/**
 * Scaffold a project from a static template.
 *
 * Copies all files from the template directory to the target,
 * renames _gitignore → .gitignore, and substitutes project config
 * into package.json.
 */
export async function scaffoldFromTemplate(
  projectDir: string,
  template: string,
  config: { projectName: string; provider: string; model: string; apiKey?: string },
): Promise<void> {
  const templateDir = resolve(__dirname, "..", "templates", template)

  // Copy template recursively
  await cp(templateDir, projectDir, { recursive: true })

  // Rename special files (_gitignore → .gitignore, etc.)
  await renameSpecialFiles(projectDir)

  // Substitute config into package.json
  const pkgPath = join(projectDir, "package.json")
  let pkg = await readFile(pkgPath, "utf-8")
  pkg = pkg.replace(/"name":\s*"[^"]*"/, `"name": "${config.projectName}"`)
  await writeFile(pkgPath, pkg)

  // Write .env if API key provided
  if (config.apiKey) {
    const envKey = config.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"
    await writeFile(join(projectDir, ".env"), `${envKey}=${config.apiKey}\n`)
  }
}

async function renameSpecialFiles(dir: string): Promise<void> {
  const renames: Record<string, string> = {
    _gitignore: ".gitignore",
    "_env.example": ".env.example",
  }

  const entries = await readdir(dir, { withFileTypes: true, recursive: true })
  for (const entry of entries) {
    if (entry.isFile() && renames[entry.name]) {
      const oldPath = join(entry.parentPath ?? entry.path, entry.name)
      const newPath = join(entry.parentPath ?? entry.path, renames[entry.name]!)
      await rename(oldPath, newPath)
    }
  }
}
