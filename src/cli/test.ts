/**
 * agent-express test runner.
 *
 * Wraps Vitest with agent-specific configuration:
 * - Auto-sets ALLOW_REAL_REQUESTS=false
 * - Discovers *.agent.test.ts files
 * - JUnit XML output for CI (--ci flag)
 */
export async function runTest(opts: { ci: boolean; pattern: string }): Promise<void> {
  // Block real API calls before running tests
  const { setAllowRealRequests } = await import("../test/allow-real-requests.js")
  setAllowRealRequests(false)

  try {
    const { startVitest } = await import("vitest/node")

    const reporters: any[] = ["default"]
    const outputFile: Record<string, string> = {}

    if (opts.ci) {
      reporters.push("junit")
      outputFile["junit"] = "./test-results/junit.xml"
    }

    console.log(`\n🧪 Running agent tests...`)
    console.log(`   Pattern: ${opts.pattern}`)
    console.log(`   ALLOW_REAL_REQUESTS: false (real API calls blocked)\n`)

    const vitest = await startVitest("test", [], {
      include: [opts.pattern],
      globals: true,
      watch: false,
      passWithNoTests: true,
      reporters,
      outputFile,
    })

    await vitest?.close()

    const exitCode = vitest?.state?.getCountOfFailedTests() ? 1 : 0
    process.exit(exitCode)
  } catch (err) {
    console.error(`\n❌ Test runner failed: ${(err as Error).message}`)
    process.exit(1)
  }
}
