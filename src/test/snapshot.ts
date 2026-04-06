import type { RunResult } from "../types.js"
import { expect } from "vitest"

/**
 * Options for the `toMatchAgentSnapshot` custom matcher.
 */
export interface SnapshotOptions {
  /** State keys to exclude from the snapshot comparison. */
  exclude?: string[]
}

/**
 * Creates a deterministic serializable form of a RunResult for snapshot comparison.
 *
 * Sorts state keys alphabetically, excludes specified keys, and produces
 * a plain object suitable for Vitest's built-in snapshot matching.
 *
 * @param result - The run result (or any object with text, state, data)
 * @param options - Optional exclusion list for state keys
 * @returns Deterministic plain object
 */
export function serializeForSnapshot(
  result: Pick<RunResult, "text" | "state"> & { data?: unknown },
  options?: SnapshotOptions,
): Record<string, unknown> {
  const exclude = new Set(options?.exclude ?? [])

  // Sort state keys and filter excluded
  const sortedState: Record<string, unknown> = {}
  const stateKeys = Object.keys(result.state ?? {}).sort()
  for (const key of stateKeys) {
    if (!exclude.has(key)) {
      sortedState[key] = result.state[key]
    }
  }

  const serialized: Record<string, unknown> = {
    text: result.text,
    state: sortedState,
  }

  if (result.data !== undefined) {
    serialized["data"] = result.data
  }

  return serialized
}

/**
 * Vitest custom matcher that compares a RunResult against a stored snapshot.
 *
 * Uses deterministic serialization (sorted state keys, excluded keys removed)
 * and delegates to Vitest's built-in `toMatchSnapshot()` for the actual
 * snapshot file management.
 *
 * Register with `expect.extend({ toMatchAgentSnapshot })` and use as:
 * ```typescript
 * expect(result).toMatchAgentSnapshot({ exclude: ['observe:duration'] })
 * ```
 *
 * @param this - Vitest matcher context
 * @param received - The RunResult to snapshot
 * @param options - Optional snapshot options (exclude keys, etc.)
 * @returns Matcher result with pass/fail and message
 */
export function toMatchAgentSnapshot(
  this: any,
  received: Pick<RunResult, "text" | "state"> & { data?: unknown },
  options?: SnapshotOptions,
): { pass: boolean; message: () => string } {
  const serialized = serializeForSnapshot(received, options)

  try {
    // Delegate to Vitest's built-in snapshot matching via the context
    // We use expect() to leverage the snapshot infrastructure
    expect(serialized).toMatchSnapshot()
    return {
      pass: !this.isNot,
      message: () => "Agent snapshot matched",
    }
  } catch (err: any) {
    return {
      pass: this.isNot ? true : false,
      message: () => err.message ?? "Agent snapshot did not match",
    }
  }
}
