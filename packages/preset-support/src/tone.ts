import type { Middleware, ModelContext } from "agent-express"
import type { ModelResponse } from "agent-express"

/** Available tone style presets. */
export type ToneStyle = "friendly-professional" | "formal" | "casual" | "empathetic" | "concise" | "educational"

/**
 * Configuration for the `guardTone()` middleware.
 */
export interface ToneConfig {
  /** Built-in tone style. Required when used standalone (not via preset). */
  style: ToneStyle
  /** Custom rules appended to tone instructions. */
  rules?: string[]
  /** Language for tone instructions. Default: "auto" (adapts to user). */
  language?: "auto" | string
  /** Escalation tool name to reference in instructions. */
  escalationToolName?: string
}

/** Built-in tone instruction templates. */
const TONE_TEMPLATES: Record<ToneStyle, string> = {
  "friendly-professional": `Respond in a friendly, professional tone. Be warm but precise.
Empathize before solving — acknowledge the user's situation before offering solutions.
Never mirror aggressive or frustrated language.
Use clear, simple language without jargon.`,

  "formal": `Respond in a formal, business-appropriate tone.
Use complete sentences and proper grammar. Avoid contractions and casual expressions.
Maintain professionalism regardless of the user's tone.`,

  "casual": `Respond in a casual, conversational tone — like talking to a friend.
Keep it relaxed and approachable. Short sentences are fine.
Be genuine and personable.`,

  "empathetic": `Respond with maximum empathy and understanding.
Always acknowledge the user's feelings before addressing their issue.
Use phrases like "I understand how frustrating this must be" and "I'm sorry you're experiencing this."
Never dismiss concerns or rush to solutions.`,

  "concise": `Respond as concisely as possible. Get straight to the point.
No filler, no fluff. Short sentences. Direct answers.
Only elaborate if specifically asked.`,

  "educational": `Respond as a patient, encouraging teacher.
Explain step by step. Use analogies when helpful.
Check understanding: "Does that make sense?" or "Would you like me to explain further?"
Never make the user feel bad for not knowing something.`,
}

/**
 * Creates a `guardTone()` middleware that enforces consistent tone.
 *
 * Injects tone instructions into the system prompt via `ctx.addSystemMessage()`.
 * The model handles enforcement — no output validation.
 *
 * @param config - Tone style and custom rules
 * @returns Middleware
 *
 * @example
 * ```typescript
 * import { guardTone } from "@agent-express/preset-support"
 *
 * agent.use(guardTone({ style: "friendly-professional" }))
 * ```
 */
export function guardTone(config: ToneConfig): Middleware {
  const { style, rules, language, escalationToolName } = config

  function buildInstructions(): string {
    let instructions = `## Tone Guidelines\n\n${TONE_TEMPLATES[style]}`

    if (rules && rules.length > 0) {
      instructions += `\n\nAdditional rules:\n${rules.map(r => `- ${r}`).join("\n")}`
    }

    if (escalationToolName) {
      instructions += `\n\nIf the customer seems frustrated, empathize first, acknowledge the issue, and offer to connect them with a human agent using the ${escalationToolName} tool.`
    }

    if (language && language !== "auto") {
      instructions += `\n\nRespond in ${language}.`
    } else {
      instructions += `\n\nRespond in the same language the user is using.`
    }

    return instructions
  }

  const toneInstructions = buildInstructions()

  return {
    name: "guard:tone",

    async model(ctx: ModelContext, next: () => Promise<ModelResponse>): Promise<ModelResponse> {
      ctx.addSystemMessage(toneInstructions)
      return next()
    },
  }
}
