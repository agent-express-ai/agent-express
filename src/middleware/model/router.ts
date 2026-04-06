import type { Middleware, ModelContext } from "../../middleware.js"
import type { ModelResponse } from "../../types.js"
import { defaultTokenCounter, countMessageTokens, type TokenCounter } from "../../token-count.js"

/** Complexity tier for model routing. */
export type ComplexityTier = "simple" | "medium" | "complex"

/**
 * Configuration for the `model.router()` middleware.
 */
export interface ModelRouterConfig {
  /** Model ID mapping for each complexity tier. */
  routes: Record<ComplexityTier, string>
  /** Custom classifier function. Overrides the default heuristic. */
  classify?: (ctx: ModelContext) => ComplexityTier
  /** Token counter for input complexity estimation. Default: chars/4. */
  tokenCounter?: TokenCounter
}

/**
 * Default complexity classifier.
 *
 * Heuristic based on estimated input token count and available tool count:
 * - **simple**: < 500 tokens AND no tools defined
 * - **complex**: > 2000 tokens OR 5+ tools available
 * - **medium**: everything else
 *
 * @param ctx - ModelContext with messages and tool definitions
 * @param counter - Token counter function
 * @returns Complexity tier
 */
function defaultClassifier(ctx: ModelContext, counter: TokenCounter): ComplexityTier {
  const tokenCount = countMessageTokens(ctx.messages, counter)
  const toolCount = ctx.toolDefs.length

  if (tokenCount < 500 && toolCount === 0) return "simple"
  if (tokenCount > 2000 || toolCount >= 5) return "complex"
  return "medium"
}

/**
 * Creates a `model.router()` middleware that routes model calls by complexity.
 *
 * Classifies each model call as simple, medium, or complex, then overrides
 * the model to the configured route target. Saves 60-90% on LLM costs for
 * mixed-complexity workloads.
 *
 * @param config - Routes mapping and optional custom classifier
 * @returns Middleware that routes model calls by complexity
 *
 * @example
 * ```typescript
 * agent.use(model.router({
 *   routes: {
 *     simple: "anthropic/claude-haiku-4-5",
 *     medium: "anthropic/claude-sonnet-4-6",
 *     complex: "anthropic/claude-opus-4-6",
 *   },
 * }))
 * ```
 */
export function modelRouter(config: ModelRouterConfig): Middleware {
  const counter = config.tokenCounter ?? defaultTokenCounter

  return {
    name: "model:router",

    async model(ctx: ModelContext, next: () => Promise<ModelResponse>): Promise<ModelResponse> {
      const tier = config.classify
        ? config.classify(ctx)
        : defaultClassifier(ctx, counter)

      const targetModel = config.routes[tier]
      if (targetModel) {
        ctx.setModel(targetModel)
      }

      return next()
    },
  }
}
