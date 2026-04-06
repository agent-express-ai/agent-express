/**
 * Global flag controlling whether real LLM API calls are allowed.
 *
 * When `false`, `resolveModel()` throws before making any network call
 * for string-based model identifiers (e.g., "anthropic/claude-sonnet-4-6").
 * Does NOT affect LanguageModelV3 objects passed directly (TestModel, FunctionModel, etc.).
 *
 * Set to `false` in test setup to prevent accidental real API calls:
 * ```typescript
 * import { setAllowRealRequests } from "agent-express/test"
 * setAllowRealRequests(false)
 * ```
 *
 * @default true
 */
export let ALLOW_REAL_REQUESTS = true

/**
 * Set the global ALLOW_REAL_REQUESTS flag.
 *
 * @param value - `false` to block real LLM calls, `true` to allow them
 */
export function setAllowRealRequests(value: boolean): void {
  ALLOW_REAL_REQUESTS = value
}
