/**
 * @agent-express/embed-cohere — Cohere embedding adapter.
 * @module embed-cohere
 */

export interface CohereEmbedConfig {
  /** Cohere API key. Default: process.env.COHERE_API_KEY. */
  apiKey?: string
  /** Model. Default: "embed-english-v3.0". */
  model?: string
}

export function cohereEmbed(config?: CohereEmbedConfig): (text: string) => Promise<number[]> {
  const apiKey = config?.apiKey ?? process.env["COHERE_API_KEY"]
  const model = config?.model ?? "embed-english-v3.0"
  if (!apiKey) throw new Error("Cohere API key required. Set COHERE_API_KEY or pass apiKey.")

  return async (text: string): Promise<number[]> => {
    const response = await fetch("https://api.cohere.ai/v1/embed", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ texts: [text], model, input_type: "search_query" }),
    })
    if (!response.ok) throw new Error(`Cohere embedding failed: ${response.status}`)
    const data = await response.json() as { embeddings: number[][] }
    return data.embeddings[0]!
  }
}
