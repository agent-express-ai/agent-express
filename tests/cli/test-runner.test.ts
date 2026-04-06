import { describe, it, expect, afterEach } from "vitest"
import { ALLOW_REAL_REQUESTS, setAllowRealRequests } from "../../src/test/allow-real-requests.js"

describe("ALLOW_REAL_REQUESTS flag", () => {
  afterEach(() => {
    // Reset to default after each test to avoid leaking
    setAllowRealRequests(true)
  })

  it("defaults to true", () => {
    expect(ALLOW_REAL_REQUESTS).toBe(true)
  })

  it("setAllowRealRequests(false) blocks flag", () => {
    setAllowRealRequests(false)
    // Re-import the live binding to check current value
    expect(ALLOW_REAL_REQUESTS).toBe(false)
  })

  it("setAllowRealRequests(true) restores flag", () => {
    setAllowRealRequests(false)
    expect(ALLOW_REAL_REQUESTS).toBe(false)

    setAllowRealRequests(true)
    expect(ALLOW_REAL_REQUESTS).toBe(true)
  })

  it("vitest-agent-setup.ts sets ALLOW_REAL_REQUESTS=false", async () => {
    // Ensure it starts as true
    setAllowRealRequests(true)
    expect(ALLOW_REAL_REQUESTS).toBe(true)

    // Dynamically import the setup file — it calls setAllowRealRequests(false)
    await import("../../src/cli/vitest-agent-setup.js")

    expect(ALLOW_REAL_REQUESTS).toBe(false)
  })
})
