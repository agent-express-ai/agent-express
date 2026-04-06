/**
 * Vitest setup file for agent tests.
 * Auto-imported by `agent-express test` to block real API calls.
 */
import { setAllowRealRequests } from "../test/allow-real-requests.js"

setAllowRealRequests(false)
