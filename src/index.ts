// Core
export { Agent } from "./agent.js"
export { AgentRun } from "./run.js"
export { Session } from "./session.js"

// Defaults
export { defaults } from "./defaults.js"

// Middleware
export type {
  Middleware,
  HookScope,
  AgentHookFn,
  SessionHookFn,
  TurnHookFn,
  ModelHookFn,
  ToolHookFn,
  AgentContext,
  SessionContext,
  TurnContext,
  ModelContext,
  ToolContext,
} from "./middleware.js"

// Types
export type {
  AgentDef,
  DefaultsOptions,
  RunOptions,
  RunResult,
  SessionOptions,
  StreamEvent,
  Message,
  MessagePart,
  Tool,
  ToolCallRecord,
  ToolResult,
  ModelResponse,
  ModelToolCall,
  Usage,
  RetryConfig,
  LogEvent,
  SpanData,
  MetricEvent,
  MetricsSnapshot,
  Chunk,
  SearchResult,
  SessionStore,
  SessionData,
  Event,
  EventEnvelope,
  EventTypeSchema,
  EventTypeMap,
  PiiMapping,
  PiiType,
  StateSchema,
  StateFieldDef,
} from "./types.js"

// Errors
export {
  AgentExpressError,
  AbortError,
  ModelError,
  RateLimitError,
  ContextOverflowError,
  ContentFilterError,
  AuthenticationError,
  NetworkError,
  ToolDeniedError,
  ToolExecutionError,
  SessionClosedError,
  SessionBusyError,
  StructuredOutputParseError,
  StructuredOutputValidationError,
} from "./errors.js"

// Tools namespace
import { toolsFunction } from "./tools/function.js"
import { mcpTools } from "./middleware/tools/mcp.js"
export const tools = {
  /** Create function tools with Zod schemas. */
  function: toolsFunction,
  /** Connect to an MCP server and register its tools. */
  mcp: mcpTools,
}
export type { ToolDef } from "./tools/function.js"
export type { McpServerConfig } from "./middleware/tools/mcp.js"

// Guard namespace
import { budgetGuard } from "./middleware/guard/budget.js"
import { inputGuard } from "./middleware/guard/input.js"
import { outputGuard } from "./middleware/guard/output.js"
import { guardMaxIterations } from "./middleware/guard/max-iterations.js"
import { guardTimeout } from "./middleware/guard/timeout.js"
import { guardApprove } from "./middleware/guard/approve.js"
import { guardPiiRedact } from "./middleware/guard/pii-redact.js"
import { guardRateLimit } from "./middleware/guard/rate-limit.js"
export const guard = {
  /** USD cost cap per session. */
  budget: budgetGuard,
  /** Validate input before each LLM call. */
  input: inputGuard,
  /** Validate output after each LLM response. */
  output: outputGuard,
  /** Limit model→tool→model iterations per turn. */
  maxIterations: guardMaxIterations,
  /** Turn and model call timeouts. */
  timeout: guardTimeout,
  /** Human-in-the-loop tool approval. */
  approve: guardApprove,
  /** PII detection and masking with restore for tools. */
  piiRedact: guardPiiRedact,
  /** Per-session/IP rate limiting with configurable strategies. */
  rateLimit: guardRateLimit,
}

// Approval decision helpers (top-level exports for DX)
export { approve, deny, modify } from "./middleware/guard/approve.js"
export type { ApproveConfig, ApprovalFunction, ApprovalDecision } from "./middleware/guard/approve.js"
export { BudgetExceededError } from "./middleware/guard/budget.js"
export type { BudgetConfig, CostRecord } from "./middleware/guard/budget.js"
export { InputGuardrailError } from "./middleware/guard/input.js"
export type { InputValidationResult, InputValidator } from "./middleware/guard/input.js"
export { injectionDetector } from "./middleware/guard/injection-detector.js"
export type { InjectionDetectorConfig } from "./middleware/guard/injection-detector.js"
export type { RateLimitConfig } from "./middleware/guard/rate-limit.js"
export type { PiiRedactConfig } from "./middleware/guard/pii-redact.js"
export { OutputGuardrailError } from "./middleware/guard/output.js"
export type { OutputValidationResult, OutputValidator, OutputGuardConfig } from "./middleware/guard/output.js"
export { TurnTimeoutError } from "./middleware/guard/timeout.js"
export type { TimeoutConfig } from "./middleware/guard/timeout.js"

// Model namespace
import { modelRouter } from "./middleware/model/router.js"
import { modelRetry } from "./middleware/model/retry.js"
export const model = {
  /** Route model calls by complexity. */
  router: modelRouter,
  /** Exponential backoff retry for transient LLM failures. */
  retry: modelRetry,
}
export type { ModelRouterConfig, ComplexityTier } from "./middleware/model/router.js"

// Observe namespace
import { observeUsage } from "./middleware/observe/usage.js"
import { observeTools } from "./middleware/observe/tools.js"
import { observeDuration } from "./middleware/observe/duration.js"
import { observeLog } from "./middleware/observe/log.js"
import { observeMetrics } from "./middleware/observe/metrics.js"
import { observeTraces } from "./middleware/observe/traces.js"
export const observe = {
  /** Token usage tracking → state['observe:usage']. */
  usage: observeUsage,
  /** Tool call recording → state['observe:tools']. */
  tools: observeTools,
  /** Turn duration timing → state['observe:duration']. */
  duration: observeDuration,
  /** Structured JSON logging. */
  log: observeLog,
  /** Prometheus/OpenMetrics metrics via OTel Meter API. */
  metrics: observeMetrics,
  /** OpenTelemetry-compatible distributed tracing. */
  traces: observeTraces,
}
export type { ObserveLogOptions } from "./middleware/observe/log.js"
export type { ObserveMetricsOptions } from "./middleware/observe/metrics.js"
export type { ObserveTracesOptions } from "./middleware/observe/traces.js"

// Search namespace
import { searchFile } from "./middleware/search/file.js"
import { searchWeb } from "./middleware/search/web.js"
export const search = {
  /** Document/knowledge base search with RAG retrieval. */
  file: searchFile,
  /** Web search tool — model calls when needed. */
  web: searchWeb,
}
export type { SearchFileConfig } from "./middleware/search/file.js"
export type { SearchWebConfig } from "./middleware/search/web.js"

// Memory namespace
import { memoryCompaction } from "./middleware/memory/compaction.js"
import { memoryStore } from "./middleware/memory/store.js"
export const memory = {
  /** Context window management with compaction strategies. */
  compaction: memoryCompaction,
  /** Session persistence to external stores. */
  store: memoryStore,
}
export type { CompactionConfig, CompactionStrategy } from "./middleware/memory/compaction.js"
export type { MemoryStoreConfig } from "./middleware/memory/store.js"

// Dev namespace
import { devConsole } from "./middleware/dev/console.js"
export const dev = {
  /** Full agent lifecycle terminal trace for development. */
  console: devConsole,
}
export type { ConsoleEntry, DevConsoleConfig } from "./middleware/dev/console.js"

// Pricing
export { calculateCost, DEFAULT_PRICING } from "./middleware/guard/pricing.js"
export type { ModelPricing } from "./middleware/guard/pricing.js"

// Token counting
export { defaultTokenCounter, countMessageTokens } from "./token-count.js"
export type { TokenCounter } from "./token-count.js"

// Providers
export { resolveModel } from "./providers/resolve.js"
export { callLanguageModel, toAiSdkMessages, toAiSdkTools, fromAiSdkResult } from "./providers/adapter.js"

// Events
export { EventBus } from "./events.js"
