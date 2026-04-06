import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3Message,
  LanguageModelV3FunctionTool,
  LanguageModelV3ToolCall,
  LanguageModelV3Text,
  LanguageModelV3ToolResultOutput,
  JSONSchema7,
} from "@ai-sdk/provider"
import type { Message, ModelResponse } from "../types.js"
import type { ModelContext } from "../middleware.js"

/**
 * Converts Agent Express internal messages to AI SDK V3 `LanguageModelV3Message[]` format.
 *
 * This is the bridge between Agent Express's simple `Message` type and the
 * AI SDK's structured prompt format with typed content parts.
 *
 * @param messages - Agent Express messages from `ModelContext.messages`
 * @returns AI SDK V3 formatted prompt
 */
export function toAiSdkMessages(messages: Message[]): LanguageModelV3Message[] {
  return messages.map((msg) => {
    if (msg.role === "system") {
      return {
        role: "system" as const,
        content: typeof msg.content === "string" ? msg.content : "",
      }
    }

    if (msg.role === "user") {
      return {
        role: "user" as const,
        content: [
          {
            type: "text" as const,
            text: typeof msg.content === "string" ? msg.content : "",
          },
        ],
      }
    }

    if (msg.role === "assistant") {
      if (typeof msg.content === "string") {
        return {
          role: "assistant" as const,
          content: [{ type: "text" as const, text: msg.content }],
        }
      }
      const parts = msg.content.map((part) => {
        if (part.type === "tool-call") {
          return {
            type: "tool-call" as const,
            toolCallId: part.toolCallId!,
            toolName: part.toolName!,
            input: part.args ?? {},
          }
        }
        return { type: "text" as const, text: part.text ?? "" } as const
      })
      return { role: "assistant" as const, content: parts }
    }

    // tool role — content may be string (cleared tool result) or MessagePart array
    if (typeof msg.content === "string") {
      // Cleared tool result placeholder (from memory.compaction clear-tool-results strategy)
      return {
        role: "tool" as const,
        content: [{
          type: "tool-result" as const,
          toolCallId: "cleared",
          toolName: "cleared",
          output: { type: "text" as const, value: msg.content } as LanguageModelV3ToolResultOutput,
        }],
      }
    }
    const parts = msg.content.map((part) => ({
      type: "tool-result" as const,
      toolCallId: part.toolCallId!,
      toolName: part.toolName ?? "",
      output: {
        type: "text",
        value: typeof part.result === "string" ? part.result : JSON.stringify(part.result),
      } as LanguageModelV3ToolResultOutput,
    }))
    return { role: "tool" as const, content: parts }
  })
}

/**
 * Converts Agent Express tool definitions to AI SDK V3 `LanguageModelV3FunctionTool[]`.
 *
 * @param toolDefs - Tool definitions from `ModelContext.toolDefs`
 * @returns AI SDK formatted function tools, or undefined if no tools
 */
export function toAiSdkTools(
  toolDefs: ModelContext["toolDefs"],
): LanguageModelV3FunctionTool[] | undefined {
  if (toolDefs.length === 0) return undefined
  return toolDefs.map((t) => ({
    type: "function" as const,
    name: t.name,
    description: t.description,
    inputSchema: t.jsonSchema as JSONSchema7,
  }))
}

/**
 * Parses the AI SDK V3 `LanguageModelV3GenerateResult` into Agent Express's
 * internal `ModelResponse` format.
 *
 * Extracts text and tool calls from the `content` array, flattens token
 * usage from the nested V3 structure, and normalizes the finish reason.
 *
 * @param result - Raw result from `model.doGenerate()`
 * @returns Normalized ModelResponse
 */
export function fromAiSdkResult(result: LanguageModelV3GenerateResult): ModelResponse {
  let text: string | undefined
  const toolCalls: Array<{
    toolCallId: string
    toolName: string
    args: Record<string, unknown>
  }> = []

  for (const part of result.content) {
    if ((part as LanguageModelV3Text).type === "text") {
      const textPart = part as LanguageModelV3Text
      text = (text ?? "") + textPart.text
    } else if ((part as LanguageModelV3ToolCall).type === "tool-call") {
      const tc = part as LanguageModelV3ToolCall
      let parsedArgs: Record<string, unknown>
      if (typeof tc.input === "string") {
        try {
          parsedArgs = JSON.parse(tc.input) as Record<string, unknown>
        } catch {
          throw new Error(`Failed to parse tool call arguments for "${tc.toolName}" (callId: ${tc.toolCallId}): invalid JSON`)
        }
      } else {
        parsedArgs = tc.input as Record<string, unknown>
      }
      toolCalls.push({
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        args: parsedArgs,
      })
    }
  }

  return {
    ...(text !== undefined && { text }),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
    usage: {
      inputTokens: result.usage.inputTokens.total ?? 0,
      outputTokens: result.usage.outputTokens.total ?? 0,
    },
    finishReason: result.finishReason.unified,
  }
}

/**
 * Calls a `LanguageModelV3` instance with the messages and tools from a `ModelContext`.
 *
 * This is the core bridge function: converts Agent Express format → AI SDK V3 format,
 * calls `model.doGenerate()`, and converts the result back.
 *
 * @param model - Resolved LanguageModelV3 instance
 * @param ctx - ModelContext with messages and tool definitions
 * @returns Normalized ModelResponse
 */
export async function callLanguageModel(
  model: LanguageModelV3,
  ctx: ModelContext,
  responseFormat?: { type: "json"; schema: Record<string, unknown>; name?: string; description?: string },
): Promise<ModelResponse> {
  const prompt = toAiSdkMessages(ctx.messages)
  const tools = toAiSdkTools(ctx.toolDefs)

  const options: LanguageModelV3CallOptions = {
    prompt,
    ...(tools ? { tools } : {}),
    ...(responseFormat ? { responseFormat } : {}),
  }

  const result = await model.doGenerate(options)
  return fromAiSdkResult(result)
}
