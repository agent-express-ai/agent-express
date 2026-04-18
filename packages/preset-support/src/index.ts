/**
 * @agent-express/preset-support
 *
 * Production-ready support bot preset for agent-express.
 * Includes tone enforcement, escalation safety net, and supportBot() composition.
 *
 * @module preset-support
 */

export { supportBot } from "./support-bot.js"
export type { SupportBotConfig } from "./support-bot.js"

export { guardTone } from "./tone.js"
export type { ToneConfig, ToneStyle } from "./tone.js"

export { agentEscalation } from "./escalation.js"
export type { EscalationConfig } from "./escalation.js"
