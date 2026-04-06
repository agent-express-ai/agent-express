import type { StateSchema, StateFieldDef } from "./types.js"

/**
 * Creates a session-scoped state object from middleware state declarations.
 *
 * Merges `state` properties from all middleware into a single object.
 * Each field gets its default value. If a field declares a `reducer`,
 * writes are intercepted via `Proxy`: `state.field = delta` dispatches
 * `reducer(currentValue, delta)` instead of a plain assignment.
 *
 * @param schemas - Array of state declarations from middleware (one per middleware that declares state)
 * @returns A Proxy-wrapped object where writes dispatch reducers
 *
 * @example
 * ```typescript
 * const state = createSessionState([
 *   { totalCost: { default: 0, reducer: (prev, delta) => prev + delta } },
 *   { messages: { default: [] } },
 * ])
 * state.totalCost = 0.003  // → 0.003 (reducer: 0 + 0.003)
 * state.totalCost = 0.002  // → 0.005 (reducer: 0.003 + 0.002)
 * state.messages = ["hi"]  // → ["hi"] (no reducer: plain assignment)
 * ```
 */
export function createSessionState(schemas: StateSchema[]): Record<string, unknown> {
  const merged: Record<string, StateFieldDef> = {}

  for (const schema of schemas) {
    for (const [key, def] of Object.entries(schema)) {
      // If both existing and new have reducers, last middleware wins
      merged[key] = def
    }
  }

  const values: Record<string, unknown> = {}
  for (const [key, def] of Object.entries(merged)) {
    values[key] = structuredClone(def.default)
  }

  return new Proxy(values, {
    set(_target, prop, value) {
      const key = prop as string
      const def = merged[key]
      if (def?.reducer) {
        const current = values[key]
        values[key] = def.reducer(current, value)
      } else {
        values[key] = value
      }
      return true
    },
    get(target, prop) {
      // Guard against Symbol keys (e.g., Symbol.toPrimitive, Symbol.iterator)
      if (typeof prop === "symbol") return undefined
      return target[prop]
    },
  })
}

/**
 * Creates a plain-object deep copy of the state, stripping the Proxy wrapper.
 *
 * Uses JSON round-trip because `structuredClone` cannot clone Proxy objects.
 * The result is safe to include in `RunResult.state`.
 *
 * @param state - The Proxy-wrapped session state
 * @returns A plain object snapshot
 */
export function snapshotState(state: Record<string, unknown>): Record<string, unknown> {
  const plain: Record<string, unknown> = {}
  for (const key of Object.keys(state)) {
    plain[key] = state[key]
  }
  return JSON.parse(JSON.stringify(plain))
}
