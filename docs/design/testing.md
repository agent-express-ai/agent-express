---
title: Testing
status: shipped
ships-with: v0.1.0+
last-revised: 2026-05-07
audience: contributors
---

# Testing

> How to test agents without paying for LLM calls in CI, without flaky
> network dependencies, and without writing mocks for every middleware.
> Covers `FunctionModel` / `TestModel` mocks, the `testAgent()` declarative
> helper, the recorder/replay cassette system, snapshot matching, the
> tool-call capture utility, and the network-blocking guard that catches
> accidental real API calls in test mode.

The contract: agent code is testable with the same `npx vitest` you'd
use for any TypeScript library, no special harness, no LLM keys
required, no deferred costs.

---

## 1. The problem testing AI agents typically has

Three things make agent testing hard out of the box:

1. **LLM calls cost money and are non-deterministic.** Running the
   real model in CI burns budget on every commit and produces
   different output between runs.
2. **Mocking the provider is awkward.** AI SDK V3's `LanguageModelV3`
   has 5+ methods; mocking the right shape is a chore for every test.
3. **Test/prod boundaries are fuzzy.** A test that accidentally hits a
   real API can drain your account or leak secrets, and you might not
   notice for days.

Agent Express solves these with four primitives that ship in
`agent-express/test`:

- **`TestModel`** — declarative deterministic mock
- **`FunctionModel`** — programmatic mock for complex scenarios
- **`testAgent()`** — declarative end-to-end test helper
- **`recorder` cassettes** — record real API calls once, replay forever
- **`capture`** — middleware that records model inputs/responses for
  inspection
- **`snapshot`** — deterministic serializer + Vitest matcher
- **`ALLOW_REAL_REQUESTS` flag** — kills real LLM calls in test env

All exported from `agent-express/test`. Pure TS, no runtime dependency
on the provider SDKs.

---

## 2. Mocking the model

### 2.1 `TestModel` — deterministic, declarative

Use when the test needs predictable responses and you don't care about
the exact LLM-protocol shape:

```typescript
import { TestModel } from "agent-express/test"

const model = new TestModel({
  responses: [
    { text: "I need to look that up.", toolCalls: [{ toolName: "search", args: { q: "x" }, toolCallId: "c1" }], finishReason: "tool-calls" },
    { text: "Here's the answer: 42.", finishReason: "stop" },
  ],
})

const agent = new Agent({ name: "test", model, instructions: "..." })
const { text } = await agent.run("what's the answer?").result
expect(text).toBe("Here's the answer: 42.")
```

Three modes:
- **No config**: auto-calls every available tool on first call, returns
  default text on second. Useful for "smoke tests that exercise tool
  middleware without writing a real test response."
- **`responses[]`**: returns each response in order. Throws when
  exhausted.
- **`defaultText`**: fallback when responses array is empty or
  exhausted under auto-tool mode.

`TestModel` implements `LanguageModelV3` directly — pass it as
`model:` in the agent config.

### 2.2 `FunctionModel` — programmatic, callback-based

When you need branching logic (different responses for different
inputs):

```typescript
import { FunctionModel } from "agent-express/test"

const model = new FunctionModel((messages, info) => {
  const last = messages[messages.length - 1]
  if (typeof last.content === "string" && last.content.includes("calculate")) {
    return {
      toolCalls: [{ toolName: "calc", args: { expr: "2+2" }, toolCallId: "c1" }],
      finishReason: "tool-calls",
      text: "",
    }
  }
  return { text: "I'm here to help.", finishReason: "stop" }
})
```

The callback receives the full message context plus `info.tools` (the
tool definitions the model sees) and `info.callIndex` (which call in
the turn this is). Return any `ModelResponse` shape — text, tool
calls, multi-turn responses.

This is the workhorse. Most tests use `FunctionModel` because real
agent flows branch.

---

## 3. `testAgent()` — declarative end-to-end

For the common pattern (run input, assert on output), there's a
single-call helper that handles agent.init/dispose, session lifecycle,
and assertion plumbing:

```typescript
import { testAgent } from "agent-express/test"

const result = await testAgent(agent, {
  input: "What's the capital of France?",
  expect: {
    outputContains: "Paris",
    toolsCalled: ["geo:lookup"],
    costUnder: 0.01,
  },
})

expect(result.passed).toBe(true)
expect(result.failures).toEqual([])
```

For multi-turn:

```typescript
const result = await testAgent(agent, {
  input: ["First question", "Follow-up", "Final"],
  expect: { outputContains: "expected text" },
})
```

`testAgent` auto-handles `agent.init()`, creates a session, runs each
input, accumulates the final result, applies the assertions, and
disposes cleanly. Failed assertions are collected into
`result.failures` for clear test output.

The `toolsCalled` assertion requires `observe.tools()` middleware (in
the default stack); `costUnder` requires `guard.budget()` (or any
middleware that writes to `state["guard:budget:totalCost"]`).

For session-scoped tests, `testSession(agent, ...)` is the same shape
but yields a `Session` you can inspect across turns.

---

## 4. Recorder / cassette system — record once, replay forever

Pattern borrowed from VCR (Ruby) / Polly.js / msw. First run records
real LLM responses to a JSON cassette file; subsequent runs replay
from the cassette without hitting the network.

```typescript
import { RecordModel, ReplayModel } from "agent-express/test"

// Recording mode (one-time, requires real API key + ALLOW_REAL_REQUESTS=true)
const realModel = await resolveModel("anthropic/claude-sonnet-4-6")
const recorder = new RecordModel(realModel, "tests/cassettes/multi-turn.json")
const agent = new Agent({ name: "test", model: recorder, instructions: "..." })
await agent.run("hello").result
await recorder.flush()  // writes the cassette to disk

// Replay mode (every subsequent run)
const replay = await ReplayModel.fromFile("tests/cassettes/multi-turn.json")
const agent = new Agent({ name: "test", model: replay, instructions: "..." })
const result = await agent.run("hello").result
// ↑ no network call; replay reads the next interaction from the cassette
```

Cassette shape (`CassetteInteraction[]`):

```typescript
{
  request: { messages: Message[]; tools: CassetteToolDef[]; ... },
  response: ModelResponse,
}
```

Tool definitions are captured alongside requests so a cassette is
useful for refactoring tests (the recorded tool schema travels with
the request).

Use cases:
- Integration tests that exercise real LLM behavior without per-CI cost
- Snapshot-style tests where the LLM response is itself the contract
- Onboarding new contributors (they get the recorded fixtures, no
  API key needed)
- Bug reproductions (capture once, debug forever)

Replay is strict by default — if the request doesn't match the
recording, it throws. Re-record after intentional changes.

---

## 5. `capture` — inspect what middleware sent to the model

For tests that need to assert on the input the LLM saw (e.g.,
verifying `memory.compaction` actually trimmed the context window, or
that `guard.piiRedact` masked an email):

```typescript
import { capture } from "agent-express/test"

const result = capture()
agent.use(result.middleware)

await agent.run("test").result

expect(result.turns).toHaveLength(1)
expect(result.turns[0].input).not.toContain("john@example.com")  // PII removed
expect(result.turns[0].response.text).toBe("...")
```

`capture()` returns `{ middleware, turns, clear }`. The `middleware`
is a `model`-hook middleware that snapshots `ctx.messages` before
each call and `response` after. `turns: TurnCapture[]` accumulates
across runs.

---

## 6. Snapshot testing

`serializeForSnapshot(result, options?)` produces a deterministic plain
object suitable for Vitest's built-in `toMatchSnapshot()`:

```typescript
import { serializeForSnapshot } from "agent-express/test"

const result = await agent.run("hello").result
expect(serializeForSnapshot(result, { exclude: ["observe:duration"] })).toMatchSnapshot()
```

Sorts state keys alphabetically, drops timing-sensitive fields you
list in `exclude`. Avoids the "snapshot diff because timestamp
changed" pain.

There's also a custom matcher `toMatchAgentSnapshot()`:

```typescript
expect(result).toMatchAgentSnapshot({ exclude: ["observe:duration"] })
```

Same effect, slightly tidier syntax.

---

## 7. The network-blocking guard

The most important test-environment primitive is `ALLOW_REAL_REQUESTS`.
By default, when `resolveModel("provider/model")` is called:

```typescript
// src/providers/resolve.ts
if (!ALLOW_REAL_REQUESTS) {
  throw new Error(
    `Real LLM requests are blocked (ALLOW_REAL_REQUESTS = false). ` +
    `Use TestModel or FunctionModel from "agent-express/test" instead of "${modelId}".`,
  )
}
```

The framework ships a vitest setup file
(`src/cli/vitest-agent-setup.ts`) that calls
`setAllowRealRequests(false)` before tests run. Reference it in
`vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    setupFiles: ["agent-express/test/setup"],
  },
})
```

Or add to your existing setup file:

```typescript
import { setAllowRealRequests } from "agent-express/test"
setAllowRealRequests(false)
```

What this catches:
- Accidentally `.use(model.router({ default: "anthropic/claude-sonnet-4-6" }))`
  in a test that should have used `TestModel` — the test now throws
  with a clear error pointing at the issue.
- A new contributor copy-pastes example code into a test without
  realizing it would hit production LLM endpoints — caught
  immediately.
- A regression where a refactor accidentally passes a string model
  through to `resolveModel` — caught in CI before merge.

The flag does NOT affect `LanguageModelV3` objects passed directly:
`new Agent({ model: testModel, ... })` works because `testModel` is
already an instance, no resolution needed. This makes the guard
strict-where-needed (path-based resolution = real network call risk)
and permissive-where-safe (instance = test mock).

For the rare test that DOES need to hit a real API (recording a
cassette), opt in explicitly:

```typescript
import { setAllowRealRequests } from "agent-express/test"

beforeAll(() => setAllowRealRequests(true))
afterAll(() => setAllowRealRequests(false))
```

---

## 8. The CI runner

`npx agent-express test` wraps `vitest run` with two add-ons useful in
CI:

- `--ci` produces JUnit XML output (`test-results.xml`) for CI
  consumers (GitHub Actions test reporter, GitLab CI, etc.)
- The setup file is auto-registered, so the network guard is on by
  default

Use `npm test` (vitest direct) for local iteration; `npx agent-express
test --ci` for CI pipelines.

---

## 9. Putting it together: a typical test file

```typescript
import { describe, it, expect } from "vitest"
import { Agent, defaults, observe, guard } from "agent-express"
import { FunctionModel, capture, testAgent } from "agent-express/test"

describe("support agent", () => {
  it("escalates to human when budget exceeded", async () => {
    const model = new FunctionModel(() => ({
      text: "I'll need to escalate this.",
      finishReason: "stop",
    }))

    const agent = new Agent({ name: "support", model, instructions: "..." })
      .use(defaults())
      .use(guard.budget({ limit: 0.001 }))   // very tight cap

    const result = await testAgent(agent, {
      input: "complex question requiring tool calls",
      expect: { outputContains: "escalate" },
    })

    expect(result.passed).toBe(true)
  })

  it("redacts PII before model sees it", async () => {
    const cap = capture()
    const model = new FunctionModel(() => ({ text: "ok", finishReason: "stop" }))

    const agent = new Agent({ name: "test", model, instructions: "..." })
      .use(guard.piiRedact())
      .use(cap.middleware)

    await agent.run("Email me at john@example.com").result

    const inputToModel = JSON.stringify(cap.turns[0].input)
    expect(inputToModel).not.toContain("john@example.com")
    expect(inputToModel).toContain("[EMAIL]")
  })
})
```

Three things to notice:

1. No model resolver is called — `FunctionModel` is passed directly,
   `ALLOW_REAL_REQUESTS = false` doesn't matter
2. `testAgent()` handles init/dispose, no setup/teardown boilerplate
3. `capture()` plugs in via `agent.use()` like any other middleware —
   no special harness

This is what makes the framework testable: there's no "test mode" vs
"production mode" — tests run the same code paths through the same
middleware stack, just with mock models substituted for real ones.

---

## 10. Reading the code

- [`src/test/test-model.ts`](../../src/test/test-model.ts) — `TestModel`
- [`src/test/function-model.ts`](../../src/test/function-model.ts) — `FunctionModel`
- [`src/test/test-agent.ts`](../../src/test/test-agent.ts) — `testAgent()` and `testSession()`
- [`src/test/recorder.ts`](../../src/test/recorder.ts) — `RecordModel` / `ReplayModel`
- [`src/test/capture.ts`](../../src/test/capture.ts) — capture middleware
- [`src/test/snapshot.ts`](../../src/test/snapshot.ts) — snapshot serializer + matcher
- [`src/test/allow-real-requests.ts`](../../src/test/allow-real-requests.ts) — network guard
- [`src/cli/vitest-agent-setup.ts`](../../src/cli/vitest-agent-setup.ts) — auto-applied in `agent-express test --ci`

**Sibling design documents**:
- [`providers.md`](providers.md) § 5.3 — the resolver-side enforcement
  of `ALLOW_REAL_REQUESTS` (this doc covers the Vitest setup side)
- [`observability.md`](observability.md) — `capture` is for tests;
  `observe.tools()` / `observe.usage()` track the same calls in
  production via the same middleware stack
- [`middleware-interface.md`](middleware-interface.md) — the `(ctx, next)`
  contract that `capture` and `testAgent` plug into
- [`agent-loop.md`](agent-loop.md) — what the loop looks like when the
  model is mocked vs real (it's the same code path, by design)
