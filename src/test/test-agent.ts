import type { Agent } from "../agent.js"
import type { RunResult, ToolCallRecord, Message } from "../types.js"

/**
 * Options for `testAgent()`.
 */
export interface TestOptions {
  /** User message(s). String for single turn, string[] for multi-turn session. */
  input: string | string[]
  /** Assertions to check against the run result. */
  expect?: {
    /** Tool names that should have been called (requires observe.tools() middleware). */
    toolsCalled?: string[]
    /** Substring that should appear in the text. */
    outputContains?: string
    /** Regex the text should match. */
    outputMatches?: RegExp
    /** Maximum acceptable cost in USD (requires guard.budget() middleware). */
    costUnder?: number
  }
}

/**
 * Result of a `testAgent()` call.
 */
export interface TestResult {
  /** Whether all assertions passed. */
  passed: boolean
  /** List of failure descriptions (empty if all passed). */
  failures: string[]
  /** The full RunResult from the last turn. */
  run: RunResult
}

/**
 * Result of a `testSession()` call.
 */
export interface TestSessionResult {
  /** Results from each turn. */
  turns: RunResult[]
  /** Final session state. */
  session: {
    history: Message[]
    state: Record<string, unknown>
    id: string
  }
  /** Whether all assertions passed. */
  passed: boolean
  /** List of failure descriptions. */
  failures: string[]
}

/**
 * Declarative test helper for Agent Express agents.
 *
 * Supports single-turn (string input) and multi-turn (string[] input).
 * For multi-turn, creates a session and runs each input as a turn.
 *
 * @param agent - The Agent instance to test
 * @param opts - Input and optional assertions
 * @returns TestResult with pass/fail and details
 *
 * @example
 * ```typescript
 * // Single turn
 * const result = await testAgent(agent, {
 *   input: "Hello",
 *   expect: { outputContains: "Hi" },
 * })
 *
 * // Multi-turn
 * const result = await testAgent(agent, {
 *   input: ["Hello", "What did I say?"],
 *   expect: { outputContains: "Hello" },
 * })
 * ```
 */
export async function testAgent(agent: Agent, opts: TestOptions): Promise<TestResult> {
  let runResult: RunResult

  if (Array.isArray(opts.input)) {
    // Multi-turn: use session
    await agent.init()
    const session = agent.session()
    let lastResult!: RunResult
    for (const input of opts.input) {
      lastResult = await session.run(input).result
    }
    await session.close()
    runResult = lastResult
  } else {
    // Single turn: convenience
    runResult = await agent.run(opts.input).result
  }

  const failures: string[] = []

  if (opts.expect) {
    const { toolsCalled, outputContains, outputMatches, costUnder } = opts.expect

    if (toolsCalled) {
      const tools = (runResult.state["observe:tools"] as ToolCallRecord[] | undefined) ?? []
      const calledNames = tools.map((t) => t.name)
      for (const expected of toolsCalled) {
        if (!calledNames.includes(expected)) {
          failures.push(`Expected tool "${expected}" to be called, but it was not. Called: [${calledNames.join(", ")}]`)
        }
      }
    }

    if (outputContains !== undefined) {
      if (!runResult.text.includes(outputContains)) {
        failures.push(`Expected text to contain "${outputContains}", but got: "${runResult.text.slice(0, 200)}"`)
      }
    }

    if (outputMatches !== undefined) {
      if (!outputMatches.test(runResult.text)) {
        failures.push(`Expected text to match ${outputMatches}, but got: "${runResult.text.slice(0, 200)}"`)
      }
    }

    if (costUnder !== undefined) {
      const cost = (runResult.state["guard:budget:totalCost"] as number | undefined) ?? 0
      if (cost > costUnder) {
        failures.push(`Expected cost under ${costUnder}, but got ${cost}`)
      }
    }
  }

  return {
    passed: failures.length === 0,
    failures,
    run: runResult,
  }
}

/**
 * Multi-turn session test helper. Returns per-turn results and final session state.
 *
 * @param agent - The Agent instance to test
 * @param inputs - Array of user messages (one per turn)
 * @returns TestSessionResult with per-turn results and session data
 *
 * @example
 * ```typescript
 * const result = await testSession(agent, ["Hello", "Follow up", "Goodbye"])
 * expect(result.turns).toHaveLength(3)
 * expect(result.session.history).toHaveLength(6)
 * ```
 */
export async function testSession(agent: Agent, inputs: string[]): Promise<TestSessionResult> {
  await agent.init()
  const session = agent.session()
  const turns: RunResult[] = []

  for (const input of inputs) {
    const result = await session.run(input).result
    turns.push(result)
  }

  const sessionData = {
    history: [...session.history],
    state: { ...session.state },
    id: session.id,
  }

  await session.close()

  return {
    turns,
    session: sessionData,
    passed: true,
    failures: [],
  }
}
