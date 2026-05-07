---
title: Providers
status: shipped
ships-with: v0.2.0+
last-revised: 2026-05-07
audience: contributors
---

# Providers

> Why `model: "anthropic/claude-sonnet-4-6"` works for any AI SDK provider
> without hardcoding a list. The dynamic resolver pattern, the security
> guards that make it safe, and how to plug in a custom provider.

The contract: any package shaped like `@ai-sdk/{provider}` works as a
model source via the string `"{provider}/{model-name}"`. No allowlist
in the framework, no per-provider import in user code, no migration
ceremony when a new provider lands.

---

## 1. The provider/model string

```typescript
new Agent({ model: "anthropic/claude-sonnet-4-6", ... })
new Agent({ model: "openai/gpt-4o", ... })
new Agent({ model: "google/gemini-2.0-flash", ... })
new Agent({ model: "amazon-bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0", ... })
new Agent({ model: "cohere/command-r-plus-08-2024", ... })
```

The string is split on the first `/`. Everything before is the
provider; everything after is the model name. The framework imports
`@ai-sdk/{provider}` at agent init, finds the factory function the
package exports, and constructs a `LanguageModelV3` instance with the
model name.

This means a new provider package becomes usable the moment it ships
to npm with the `@ai-sdk/*` naming convention. No framework PR
required.

---

## 2. Why a string and not direct import

Three options the ecosystem has tried:

```typescript
// Option A: direct import (Vercel AI SDK approach)
import { anthropic } from "@ai-sdk/anthropic"
new Agent({ model: anthropic("claude-sonnet-4-6"), ... })

// Option B: framework-owned enum (rejected)
new Agent({ model: AgentExpress.Models.Anthropic.ClaudeSonnet46, ... })

// Option C: provider/model string (chosen)
new Agent({ model: "anthropic/claude-sonnet-4-6", ... })
```

**Direct import (A)** is fine for one-provider setups but cumbersome
when the provider is configurable (env var, runtime selection,
multi-provider routing). Every consumer of the agent code has to
import every possible provider.

**Framework-owned enum (B)** breaks at every model release — the
framework needs a PR to add `claude-sonnet-4-7` to the enum. Worst of
both worlds.

**String (C)** keeps configuration data-driven (read from env, route
through `model.router()`, persist in agent definition YAML), and
delegates the model-name validity to the provider package. The
provider knows which models it supports; the framework doesn't have
to.

The string also accepts `LanguageModelV3` instances directly:

```typescript
import { anthropic } from "@ai-sdk/anthropic"
new Agent({ model: anthropic("claude-sonnet-4-6"), ... })
// ↑ no resolver call, no string parsing, just a direct instance
```

So both paths work — direct instance for hardcoded production use,
string for configurable / dynamic use. The string never wins on
performance (one extra dynamic import on init); it wins on
ergonomics for the configurable case.

---

## 3. Why peer dependencies, not direct dependencies

The framework declares `@ai-sdk/anthropic`, `@ai-sdk/openai`,
`@ai-sdk/*` providers as **optional peer dependencies**:

```json
{
  "peerDependencies": {
    "@ai-sdk/anthropic": "^3.0.0",
    "@ai-sdk/openai": "^3.0.0",
    "@modelcontextprotocol/sdk": "^1.20.0",
    "@opentelemetry/api": "^1.9.0"
  },
  "peerDependenciesMeta": {
    "@ai-sdk/anthropic": { "optional": true },
    "@ai-sdk/openai": { "optional": true },
    "@modelcontextprotocol/sdk": { "optional": true },
    "@opentelemetry/api": { "optional": true }
  }
}
```

Why this matters:

1. **Users install only what they need.** A team using only Anthropic
   doesn't pull OpenAI / Google / Cohere SDKs into their bundle.
2. **No version drift.** Users control the exact provider SDK
   version. The framework doesn't pin a specific patch.
3. **No transitive bloat.** `npm install agent-express` doesn't
   transitively install 10+ provider SDKs and their HTTP clients.
4. **Optional means optional.** Missing peer deps don't error at
   install time — the framework only complains at runtime if you
   actually try to use one that isn't installed.

The runtime error when a peer is missing:

```
Provider package @ai-sdk/google is not installed. Run: npm install @ai-sdk/google
```

Clear, actionable, points at the fix.

---

## 4. The resolver, step by step

[`src/providers/resolve.ts`](../../src/providers/resolve.ts):

```typescript
async function resolveModel(modelId: string): Promise<LanguageModelV3> {
  // 1. Block real API calls in test mode (see testing.md)
  if (!ALLOW_REAL_REQUESTS) throw ...

  // 2. Parse "provider/model-name"
  const [provider, modelName] = modelId.split("/", 2)

  // 3. Validate provider name (security guard, see § 5)
  if (!/^[a-z][a-z0-9-]*$/.test(provider)) throw ...

  // 4. Dynamic import — fails clearly if not installed
  const mod = await import(`@ai-sdk/${provider}`)

  // 5. Find the factory function (default export, or named "anthropic", etc.)
  const factory = mod.default ?? mod[provider] ?? mod[provider.replace(/-/g, "")]

  // 6. Build the model
  return factory(modelName)
}
```

The factory-finding logic is conventional: AI SDK provider packages
export either a default function (`@ai-sdk/google`'s `default`) or a
named export matching the provider name (`@ai-sdk/anthropic`'s
`anthropic`). The hyphen-stripped variant covers `@ai-sdk/amazon-bedrock`
exporting `amazonBedrock`. If a provider exports neither, the
resolver throws and the user can pass a `LanguageModelV3` instance
directly.

---

## 5. Security guards

Three defenses against malicious model strings:

### 5.1 Path-traversal block

```typescript
if (!/^[a-z][a-z0-9-]*$/.test(provider)) throw ...
```

Without this, `"../../some-attacker-package/model"` would resolve to
`@ai-sdk/../../some-attacker-package` and Node's resolver would walk
up the filesystem. The strict regex (`a-z` + `0-9` + `-`, must start
with letter) rules this out at the syntactic level.

What this allows: `anthropic`, `openai`, `google`, `amazon-bedrock`,
`cohere`. What this blocks: anything with `/`, `.`, `..`, `_`,
upper-case, or non-ASCII. AI SDK package names are all lowercase
hyphen-separated, so the regex is exactly the convention's surface.

### 5.2 Prototype-property guard

```typescript
const factory = mod.default
  ?? (Object.hasOwn(mod, provider) ? mod[provider] : undefined)
  ?? (Object.hasOwn(mod, providerKey) ? mod[providerKey] : undefined)
```

`Object.hasOwn` (not bare property access) avoids walking the
prototype chain. Without this, a malicious user-supplied `provider`
string of `"constructor"` or `"toString"` would resolve to a function
from `Object.prototype` — and calling
`(Object.prototype.constructor)(modelName)` would invoke the `Object`
constructor with the model name as argument. Harmless in this case,
but the principle generalizes: never index into a module by an
attacker-controlled key without `Object.hasOwn`.

### 5.3 Real-requests blocking

In test mode, the resolver throws before making any network call:

```typescript
if (!ALLOW_REAL_REQUESTS) {
  throw new Error("Real LLM requests are blocked...")
}
```

See [`testing.md`](testing.md) § 7 for the full design. The provider
resolver is the single chokepoint where path-based model strings turn
into real network calls, so the guard sits here.

---

## 6. Custom providers (non-AI SDK)

If you have a model that doesn't ship as `@ai-sdk/{name}`:

### 6.1 Direct LanguageModelV3 instance

The simplest path. Construct the model however the SDK wants and pass
the instance directly:

```typescript
import { customProvider } from "some-other-sdk"
const model = customProvider("model-name")
new Agent({ model, ... })
```

No string parsing, no resolver, no peer-dep dance.

### 6.2 Wrap as `@ai-sdk/*` package

If you want the string-config experience for an in-house model,
publish a package named `@yourorg/ai-sdk-yourmodel` (or
`@ai-sdk/yourmodel` if you can claim the namespace) that exports a
factory matching the AI SDK convention. Then `model:
"yourmodel/your-version"` works through the resolver.

### 6.3 Custom resolver for non-conventional packages

If the package isn't shaped like AI SDK and you can't wrap it, you
can override resolution by passing a `LanguageModelV3` instance.
There's no framework hook for "register a custom resolver" — the
escape hatch is direct instance pass-through.

---

## 7. The cost: one async on init

The resolver requires `agent.init()` to be `async` because the
dynamic import is async. Every other framework that imports providers
statically can have a synchronous Agent constructor. This is the
trade-off.

In practice: `agent.init()` is called once per process. The dynamic
import is cached by Node's module loader, so subsequent agents using
the same provider don't re-resolve. The cost is microseconds in the
warm path, milliseconds on first init.

For latency-sensitive workloads (cold starts, edge functions), you
can pre-resolve manually:

```typescript
import { resolveModel } from "agent-express"
const model = await resolveModel("anthropic/claude-sonnet-4-6")  // outside hot path

// Hot path
const agent = new Agent({ model, ... })  // direct instance, no resolver call
await agent.init()
```

---

## 8. Reading the code

- [`src/providers/resolve.ts`](../../src/providers/resolve.ts) — the
  resolver itself, including the security guards
- [`src/providers/adapter.ts`](../../src/providers/adapter.ts) —
  format bridge between AI SDK V3 messages and our internal `Message`
  shape
- [`package.json`](../../package.json) — peer dependency declarations

**Sibling design documents**:
- [`agent-loop.md`](agent-loop.md) — where the resolved
  `LanguageModelV3` instance plugs into the model onion
- [`middleware-interface.md`](middleware-interface.md) — `model.router()`
  and `model.retry()` are middleware that wrap the resolved model
- [`adapters.md`](adapters.md) — same peer-deps + dynamic-import
  pattern used for storage / embedding / search adapters
- [`testing.md`](testing.md) § 7 — the `ALLOW_REAL_REQUESTS` guard
  that the resolver enforces in test mode

**External reference**:
- AI SDK Provider Spec: <https://ai-sdk.dev/docs/foundations/providers-and-models>
- `@ai-sdk/provider` package (the V3 interface):
  <https://www.npmjs.com/package/@ai-sdk/provider>
