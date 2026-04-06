/**
 * Open the provider's API key creation page in the default browser.
 */
export async function openKeyPage(provider: string): Promise<void> {
  const urls: Record<string, string> = {
    anthropic: "https://console.anthropic.com/settings/keys",
    openai: "https://platform.openai.com/api-keys",
  }

  const url = urls[provider]
  if (!url) return

  try {
    const open = (await import("open")).default
    await open(url)
    console.log(`\n  Opened ${url} in your browser.`)
    console.log(`  Create an API key and paste it below.\n`)
  } catch {
    console.log(`\n  Open this URL to create an API key: ${url}\n`)
  }
}
