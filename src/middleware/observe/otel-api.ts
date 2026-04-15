/**
 * OpenTelemetry API detection helper.
 *
 * Dynamically imports `@opentelemetry/api` and caches the result.
 * Returns `null` if the package is not installed — no runtime error.
 * Used by both `observe.metrics()` and `observe.traces()` middleware.
 *
 * @module otel-api
 */

/** Cached import promise — ensures only one import attempt regardless of concurrency. */
let pending: Promise<typeof import("@opentelemetry/api") | null> | undefined

/**
 * Try to import `@opentelemetry/api`. Returns the module or `null` if not installed.
 * Result is cached after the first call. Concurrent calls share the same promise.
 */
export function tryImportOtel(): Promise<typeof import("@opentelemetry/api") | null> {
  if (!pending) {
    pending = import("@opentelemetry/api").catch(() => null)
  }
  return pending
}
