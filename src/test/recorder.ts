import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
} from "@ai-sdk/provider"
import type { Message, ModelResponse } from "../types.js"
import { fromAiSdkResult } from "../providers/adapter.js"
import { toGenerateResult } from "./model-utils.js"
import { readFile, writeFile } from "node:fs/promises"

/** Tool definition stored in a cassette interaction. */
export interface CassetteToolDef {
  /** Tool name. */
  name: string
  /** Tool description. */
  description: string
  /** JSON Schema for the tool's input. */
  jsonSchema: Record<string, unknown>
}

/** A single recorded interaction (request + response). */
export interface CassetteInteraction {
  /** The request sent to the model. */
  request: {
    messages: Message[]
    tools: CassetteToolDef[]
    callIndex: number
  }
  /** The model's response. */
  response: ModelResponse
}

/** JSON format for a cassette file. */
export interface Cassette {
  /** Format version. */
  version: number
  /** Model identifier from the inner model. */
  model: string
  /** ISO timestamp when the cassette was recorded. */
  recordedAt: string
  /** Ordered list of interactions. */
  interactions: CassetteInteraction[]
}

/**
 * Regex patterns for common API key fields to scrub from cassette JSON.
 * Matches Authorization header values, api-key, and x-api-key values.
 */
const API_KEY_PATTERNS = [
  /"Authorization"\s*:\s*"[^"]*"/gi,
  /"api-key"\s*:\s*"[^"]*"/gi,
  /"x-api-key"\s*:\s*"[^"]*"/gi,
  /"apiKey"\s*:\s*"[^"]*"/gi,
]

/**
 * Recording model that wraps a real LanguageModelV3, forwarding all calls
 * while capturing request/response pairs for later replay.
 *
 * Use `saveCassette(path)` to write the recorded interactions to a JSON file.
 * API key patterns are automatically scrubbed from the output.
 *
 * @example
 * ```typescript
 * const real = resolveModel("anthropic/claude-sonnet-4-6")
 * const recorder = new RecordModel(real)
 * // ... use recorder as the model in an Agent ...
 * await recorder.saveCassette("./fixtures/my-test.cassette.json")
 * ```
 */
export class RecordModel implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const
  readonly provider: string
  readonly modelId: string
  readonly supportedUrls = {}

  private readonly inner: LanguageModelV3
  private readonly interactions: CassetteInteraction[] = []
  private callIndex = 0

  constructor(inner: LanguageModelV3) {
    this.inner = inner
    this.provider = inner.provider
    this.modelId = inner.modelId
  }

  /**
   * Forwards the call to the inner model and records the interaction.
   *
   * @param options - AI SDK V3 call options
   * @returns The inner model's generate result
   */
  async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
    const idx = this.callIndex++

    // Extract messages and tools from the AI SDK prompt format
    const messages = this.promptToMessages(options.prompt)
    const tools: CassetteToolDef[] = (options.tools ?? [])
      .filter((t) => t.type === "function")
      .map((t) => ({
        name: (t as any).name,
        description: (t as any).description ?? "",
        jsonSchema: (t as any).inputSchema ?? (t as any).parameters ?? {},
      }))

    const result = await this.inner.doGenerate(options)
    const response = fromAiSdkResult(result)

    this.interactions.push({
      request: { messages, tools, callIndex: idx },
      response,
    })

    return result
  }

  /** @throws Always throws — streaming is not supported for recording. */
  async doStream(): Promise<never> {
    throw new Error("RecordModel does not support streaming.")
  }

  /**
   * Writes all recorded interactions to a JSON cassette file.
   * Automatically scrubs common API key patterns from the output.
   *
   * @param path - File path to write the cassette JSON
   */
  async saveCassette(path: string): Promise<void> {
    const cassette: Cassette = {
      version: 1,
      model: this.inner.modelId,
      recordedAt: new Date().toISOString(),
      interactions: this.interactions,
    }

    let json = JSON.stringify(cassette, null, 2)
    for (const pattern of API_KEY_PATTERNS) {
      json = json.replace(pattern, (match) => {
        const colonIndex = match.indexOf(":")
        const key = match.slice(0, colonIndex + 1)
        return `${key} "[REDACTED]"`
      })
    }

    await writeFile(path, json, "utf-8")
  }

  /** Convert AI SDK prompt messages to Agent Express Message format. */
  private promptToMessages(prompt: LanguageModelV3CallOptions["prompt"]): Message[] {
    return prompt.map((msg): Message => {
      if (msg.role === "system") {
        const parts = Array.isArray(msg.content) ? msg.content : [msg.content]
        const text = parts
          .filter((p: any) => typeof p === "string" || p.type === "text")
          .map((p: any) => (typeof p === "string" ? p : p.text))
          .join("")
        return { role: "system", content: text }
      }
      if (msg.role === "user") {
        const text = (msg.content as any[])
          .filter((p: any) => p.type === "text")
          .map((p: any) => p.text)
          .join("")
        return { role: "user", content: text }
      }
      if (msg.role === "assistant") {
        const content = msg.content as any[]
        const textParts = content.filter((p: any) => p.type === "text")
        if (textParts.length > 0 && !content.some((p: any) => p.type === "tool-call")) {
          return { role: "assistant", content: textParts.map((p: any) => p.text).join("") }
        }
        return {
          role: "assistant",
          content: content.map((p: any) => {
            if (p.type === "tool-call") {
              return {
                type: "tool-call" as const,
                toolCallId: p.toolCallId,
                toolName: p.toolName,
                args: typeof p.input === "string" ? JSON.parse(p.input) : p.input,
              }
            }
            return { type: "text" as const, text: p.text ?? "" }
          }),
        }
      }
      // tool role
      const content = msg.content as any[]
      return {
        role: "tool",
        content: content.map((p: any) => ({
          type: "tool-result" as const,
          toolCallId: p.toolCallId,
          result: p.result ?? p.content,
        })),
      }
    })
  }
}

/**
 * Replay model that serves pre-recorded responses from a cassette.
 *
 * Does not make any network calls. Returns recorded responses in order.
 * Throws when all recorded interactions have been exhausted.
 *
 * @example
 * ```typescript
 * const replay = await ReplayModel.fromFile("./fixtures/my-test.cassette.json")
 * const agent = new Agent({ name: "test", model: replay, instructions: "test", defaults: false })
 * const { text } = await agent.run("Hello").result
 * ```
 */
export class ReplayModel implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const
  readonly provider = "replay"
  readonly modelId: string
  readonly supportedUrls = {}

  private readonly interactions: CassetteInteraction[]
  private callIndex = 0

  private constructor(modelId: string, interactions: CassetteInteraction[]) {
    this.modelId = modelId
    this.interactions = interactions
  }

  /**
   * Creates a ReplayModel from a cassette JSON file.
   *
   * @param path - Path to the cassette JSON file
   * @returns ReplayModel ready to serve recorded responses
   */
  static async fromFile(path: string): Promise<ReplayModel> {
    const raw = await readFile(path, "utf-8")
    const data = JSON.parse(raw)
    return ReplayModel.fromJSON(data)
  }

  /**
   * Creates a ReplayModel from parsed cassette JSON data.
   *
   * @param data - Parsed cassette object
   * @returns ReplayModel ready to serve recorded responses
   */
  static fromJSON(data: any): ReplayModel {
    const cassette = data as Cassette
    return new ReplayModel(
      cassette.model ?? "replay-model",
      cassette.interactions ?? [],
    )
  }

  /**
   * Returns the next recorded response. Throws if all responses are exhausted.
   *
   * @param _options - AI SDK call options (ignored — responses are pre-recorded)
   * @returns Pre-recorded generate result
   * @throws {Error} When all recorded interactions have been consumed
   */
  async doGenerate(_options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
    if (this.callIndex >= this.interactions.length) {
      throw new Error(
        `ReplayModel exhausted: expected ${this.interactions.length} calls, got ${this.callIndex + 1}. ` +
        `Record more interactions or check your test setup.`,
      )
    }

    const interaction = this.interactions[this.callIndex++]!
    return toGenerateResult(interaction.response)
  }

  /** @throws Always throws — streaming is not supported for replay. */
  async doStream(): Promise<never> {
    throw new Error("ReplayModel does not support streaming.")
  }

}
