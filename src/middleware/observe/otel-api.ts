/**
 * OpenTelemetry API detection helper.
 *
 * Dynamically imports `@opentelemetry/api` and caches the result.
 * Returns `null` if the package is not installed — no runtime error.
 * Used by both `observe.metrics()` and `observe.traces()` middleware.
 *
 * @module otel-api
 */

/** Cached OTel API module (null = not installed, undefined = not checked yet). */
let cached: typeof import("@opentelemetry/api") | null | undefined

/**
 * Try to import `@opentelemetry/api`. Returns the module or `null` if not installed.
 * Result is cached after the first call.
 */
export async function tryImportOtel(): Promise<typeof import("@opentelemetry/api") | null> {
  if (cached !== undefined) return cached
  try {
    cached = await import("@opentelemetry/api")
    return cached
  } catch {
    cached = null
    return null
  }
}
