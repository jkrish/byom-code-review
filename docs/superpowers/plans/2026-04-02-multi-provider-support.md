# Multi-Provider Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded OpenRouter client with a provider registry so users can run reviews through OpenRouter, Baseten, or any custom OpenAI-compatible endpoint.

**Architecture:** A provider registry (`providers.mjs`) defines each provider as a plain config object (base URL, auth header format, env var names). A generic `ProviderClient` replaces `OpenRouterClient` with the same `chatCompletion()` interface. Provider selection flows through `--provider` flag → `BYOM_DEFAULT_PROVIDER` env → `"openrouter"` default.

**Tech Stack:** Node.js (ESM), native `fetch`, `node:test` for testing. Zero npm dependencies preserved.

**Spec:** `docs/superpowers/specs/2026-04-02-multi-provider-support-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/lib/providers.mjs` | **New** — Provider registry: definitions for openrouter, baseten, custom. Exports `getProvider`, `listProviders`, `resolveProvider`. |
| `scripts/lib/provider-client.mjs` | **New** — Generic `ProviderClient` class. Same `chatCompletion()` interface as old `OpenRouterClient`. Takes a provider config at construction. |
| `scripts/lib/openrouter.mjs` | **Deleted** — Fully replaced by `providers.mjs` + `provider-client.mjs`. |
| `scripts/byom-companion.mjs` | **Modified** — Update imports, add `--provider` parsing, provider-aware setup report, provider-aware `ensureApiKeyReady`. |
| `scripts/lib/review-engine.mjs` | **No changes** — Already provider-agnostic (calls `client.chatCompletion()`). |
| `commands/review.md` | **Modified** — Add `--provider` to argument-hint and supported flags description. |
| `commands/adversarial-review.md` | **Modified** — Add `--provider` to argument-hint and supported flags description. |
| `commands/setup.md` | **Modified** — Update to describe multi-provider dashboard. |
| `.claude-plugin/plugin.json` | **Modified** — Update description to be provider-neutral. |
| `tests/providers.test.mjs` | **New** — Tests for provider registry. |
| `tests/provider-client.test.mjs` | **New** — Tests for `ProviderClient`. |
| `tests/openrouter.test.mjs` | **Deleted** — Replaced by `tests/provider-client.test.mjs`. |
| `tests/commands.test.mjs` | **Modified** — Update assertions that check for "OpenRouter" in command files and plugin manifest. |

---

### Task 1: Create Provider Registry

**Files:**
- Create: `plugins/byom-review/scripts/lib/providers.mjs`
- Create: `tests/providers.test.mjs`

- [ ] **Step 1: Write the failing tests for the provider registry**

Create `tests/providers.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";

import { getProvider, listProviders, resolveProvider } from "../plugins/byom-review/scripts/lib/providers.mjs";

test("getProvider returns openrouter config", () => {
  const p = getProvider("openrouter");
  assert.equal(p.name, "openrouter");
  assert.equal(p.label, "OpenRouter");
  assert.equal(p.baseUrl, "https://openrouter.ai/api/v1");
  assert.equal(p.apiKeyEnv, "OPENROUTER_API_KEY");
  assert.equal(typeof p.authHeader, "function");
  assert.equal(p.authHeader("sk-123"), "Bearer sk-123");
  assert.ok(p.extraHeaders["HTTP-Referer"]);
  assert.ok(p.extraHeaders["X-Title"]);
});

test("getProvider returns baseten config", () => {
  const p = getProvider("baseten");
  assert.equal(p.name, "baseten");
  assert.equal(p.label, "Baseten");
  assert.equal(p.baseUrl, "https://inference.baseten.co/v1");
  assert.equal(p.apiKeyEnv, "BASETEN_API_KEY");
  assert.equal(p.authHeader("bt-key"), "Api-Key bt-key");
});

test("getProvider returns custom config", () => {
  const p = getProvider("custom");
  assert.equal(p.name, "custom");
  assert.equal(p.apiKeyEnv, "BYOM_CUSTOM_API_KEY");
  assert.equal(p.baseUrlEnv, "BYOM_CUSTOM_BASE_URL");
  assert.equal(p.authHeader("ck"), "Bearer ck");
});

test("getProvider throws for unknown provider", () => {
  assert.throws(
    () => getProvider("foobar"),
    /Unknown provider: foobar\. Available: openrouter, baseten, custom/
  );
});

test("listProviders returns all three providers", () => {
  const all = listProviders();
  const names = all.map((p) => p.name);
  assert.deepEqual(names, ["openrouter", "baseten", "custom"]);
});

test("resolveProvider uses explicit provider option first", () => {
  const p = resolveProvider({ provider: "baseten" });
  assert.equal(p.name, "baseten");
});

test("resolveProvider falls back to BYOM_DEFAULT_PROVIDER env", () => {
  const orig = process.env.BYOM_DEFAULT_PROVIDER;
  process.env.BYOM_DEFAULT_PROVIDER = "baseten";
  try {
    const p = resolveProvider({});
    assert.equal(p.name, "baseten");
  } finally {
    if (orig) {
      process.env.BYOM_DEFAULT_PROVIDER = orig;
    } else {
      delete process.env.BYOM_DEFAULT_PROVIDER;
    }
  }
});

test("resolveProvider defaults to openrouter", () => {
  const orig = process.env.BYOM_DEFAULT_PROVIDER;
  delete process.env.BYOM_DEFAULT_PROVIDER;
  try {
    const p = resolveProvider({});
    assert.equal(p.name, "openrouter");
  } finally {
    if (orig) {
      process.env.BYOM_DEFAULT_PROVIDER = orig;
    } else {
      delete process.env.BYOM_DEFAULT_PROVIDER;
    }
  }
});

test("resolveProvider throws for unknown provider in option", () => {
  assert.throws(
    () => resolveProvider({ provider: "nope" }),
    /Unknown provider: nope/
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/providers.test.mjs`
Expected: All tests fail — module does not exist yet.

- [ ] **Step 3: Implement the provider registry**

Create `plugins/byom-review/scripts/lib/providers.mjs`:

```js
const PROVIDERS = [
  {
    name: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
    baseUrlEnv: "OPENROUTER_BASE_URL",
    authHeader: (key) => `Bearer ${key}`,
    extraHeaders: {
      "HTTP-Referer": "https://github.com/jkrish/byom-code-review",
      "X-Title": "byom-code-review"
    }
  },
  {
    name: "baseten",
    label: "Baseten",
    baseUrl: "https://inference.baseten.co/v1",
    apiKeyEnv: "BASETEN_API_KEY",
    baseUrlEnv: "BASETEN_BASE_URL",
    authHeader: (key) => `Api-Key ${key}`,
    extraHeaders: {}
  },
  {
    name: "custom",
    label: "Custom",
    baseUrl: "",
    apiKeyEnv: "BYOM_CUSTOM_API_KEY",
    baseUrlEnv: "BYOM_CUSTOM_BASE_URL",
    authHeader: (key) => `Bearer ${key}`,
    extraHeaders: {}
  }
];

const PROVIDER_MAP = new Map(PROVIDERS.map((p) => [p.name, p]));

function providerNames() {
  return PROVIDERS.map((p) => p.name).join(", ");
}

export function getProvider(name) {
  const provider = PROVIDER_MAP.get(name);
  if (!provider) {
    throw new Error(`Unknown provider: ${name}. Available: ${providerNames()}`);
  }
  return provider;
}

export function listProviders() {
  return [...PROVIDERS];
}

export function resolveProvider(options = {}) {
  const name = options.provider || process.env.BYOM_DEFAULT_PROVIDER || "openrouter";
  return getProvider(name);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/providers.test.mjs`
Expected: All 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/byom-review/scripts/lib/providers.mjs tests/providers.test.mjs
git commit -m "feat: add provider registry with openrouter, baseten, and custom providers"
```

---

### Task 2: Create Generic ProviderClient

**Files:**
- Create: `plugins/byom-review/scripts/lib/provider-client.mjs`
- Create: `tests/provider-client.test.mjs`
- Delete: `plugins/byom-review/scripts/lib/openrouter.mjs`
- Delete: `tests/openrouter.test.mjs`

- [ ] **Step 1: Write the failing tests for ProviderClient**

Create `tests/provider-client.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";

import { ProviderClient } from "../plugins/byom-review/scripts/lib/provider-client.mjs";
import { getProvider } from "../plugins/byom-review/scripts/lib/providers.mjs";

test("ProviderClient uses provider config for defaults", () => {
  const provider = getProvider("openrouter");
  const client = new ProviderClient(provider, { apiKey: "sk-test" });
  assert.equal(client.apiKey, "sk-test");
  assert.equal(client.baseUrl, "https://openrouter.ai/api/v1");
  assert.ok(client.isConfigured);
});

test("ProviderClient reads API key from provider env var", () => {
  const provider = getProvider("baseten");
  const orig = process.env.BASETEN_API_KEY;
  process.env.BASETEN_API_KEY = "bt-test-key";
  try {
    const client = new ProviderClient(provider);
    assert.equal(client.apiKey, "bt-test-key");
    assert.equal(client.baseUrl, "https://inference.baseten.co/v1");
    assert.ok(client.isConfigured);
  } finally {
    if (orig) {
      process.env.BASETEN_API_KEY = orig;
    } else {
      delete process.env.BASETEN_API_KEY;
    }
  }
});

test("ProviderClient reads base URL override from provider env var", () => {
  const provider = getProvider("openrouter");
  const orig = process.env.OPENROUTER_BASE_URL;
  process.env.OPENROUTER_BASE_URL = "https://custom.openrouter/v1";
  try {
    const client = new ProviderClient(provider, { apiKey: "sk-test" });
    assert.equal(client.baseUrl, "https://custom.openrouter/v1");
  } finally {
    if (orig) {
      process.env.OPENROUTER_BASE_URL = orig;
    } else {
      delete process.env.OPENROUTER_BASE_URL;
    }
  }
});

test("ProviderClient reports not configured when no key", () => {
  const provider = getProvider("openrouter");
  const client = new ProviderClient(provider, { apiKey: "" });
  assert.ok(!client.isConfigured);
});

test("ProviderClient accepts explicit baseUrl override", () => {
  const provider = getProvider("baseten");
  const client = new ProviderClient(provider, {
    apiKey: "bt-key",
    baseUrl: "https://override.example/v1"
  });
  assert.equal(client.baseUrl, "https://override.example/v1");
});

test("chatCompletion throws with provider-specific error when no API key", async () => {
  const provider = getProvider("baseten");
  const client = new ProviderClient(provider, { apiKey: "" });
  await assert.rejects(
    () => client.chatCompletion({ messages: [{ role: "user", content: "hi" }] }),
    /BASETEN_API_KEY is not set/
  );
});

test("chatCompletion throws with provider-specific error for openrouter", async () => {
  const provider = getProvider("openrouter");
  const client = new ProviderClient(provider, { apiKey: "" });
  await assert.rejects(
    () => client.chatCompletion({ messages: [{ role: "user", content: "hi" }] }),
    /OPENROUTER_API_KEY is not set/
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/provider-client.test.mjs`
Expected: All tests fail — module does not exist yet.

- [ ] **Step 3: Implement ProviderClient**

Create `plugins/byom-review/scripts/lib/provider-client.mjs`:

```js
export class ProviderClient {
  constructor(provider, options = {}) {
    this.provider = provider;
    this.apiKey = options.apiKey || process.env[provider.apiKeyEnv] || "";
    this.baseUrl =
      options.baseUrl ||
      (provider.baseUrlEnv ? process.env[provider.baseUrlEnv] : undefined) ||
      provider.baseUrl;
    this.defaultModel = options.defaultModel || "";
  }

  get isConfigured() {
    return Boolean(this.apiKey);
  }

  async chatCompletion({ messages, model, responseFormat, temperature, maxTokens }) {
    if (!this.apiKey) {
      throw new Error(
        `${this.provider.apiKeyEnv} is not set. Set it in your environment to use ${this.provider.label}.`
      );
    }

    const body = {
      model: model || this.defaultModel,
      messages
    };

    if (responseFormat) {
      body.response_format = responseFormat;
    }
    if (temperature != null) {
      body.temperature = temperature;
    }
    if (maxTokens != null) {
      body.max_tokens = maxTokens;
    }

    const headers = {
      "Content-Type": "application/json",
      Authorization: this.provider.authHeader(this.apiKey),
      ...this.provider.extraHeaders
    };

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      let detail = "";
      try {
        const parsed = JSON.parse(errorBody);
        detail = parsed.error?.message || parsed.error || errorBody;
      } catch {
        detail = errorBody;
      }
      throw new Error(
        `${this.provider.label} API error (${response.status}): ${detail}`
      );
    }

    const data = await response.json();
    return {
      content: data.choices?.[0]?.message?.content ?? "",
      model: data.model ?? body.model,
      usage: data.usage ?? null,
      id: data.id ?? null
    };
  }

  async listModels() {
    const response = await fetch(`${this.baseUrl}/models`, {
      headers: {
        Authorization: this.provider.authHeader(this.apiKey),
        ...this.provider.extraHeaders
      }
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`Failed to list models (${response.status})`);
    }

    const data = await response.json();
    return data.data ?? [];
  }

  async validateApiKey() {
    try {
      const models = await this.listModels();
      if (models === null) {
        return { valid: "unknown" };
      }
      return { valid: true, modelCount: models.length };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/provider-client.test.mjs`
Expected: All 7 tests pass.

- [ ] **Step 5: Delete the old openrouter module and its tests**

```bash
git rm plugins/byom-review/scripts/lib/openrouter.mjs
git rm tests/openrouter.test.mjs
```

- [ ] **Step 6: Run remaining tests to see what breaks**

Run: `node --test tests/*.test.mjs`
Expected: `tests/commands.test.mjs` still passes. `tests/review-engine.test.mjs` still passes (it only imports `parseStructuredOutput`, no OpenRouter dependency). `byom-companion.mjs` will break at import time but it's not directly tested here.

- [ ] **Step 7: Commit**

```bash
git add plugins/byom-review/scripts/lib/provider-client.mjs tests/provider-client.test.mjs
git commit -m "feat: add generic ProviderClient, remove OpenRouterClient"
```

---

### Task 3: Update byom-companion.mjs to Use Provider System

**Files:**
- Modify: `plugins/byom-review/scripts/byom-companion.mjs`

- [ ] **Step 1: Update imports**

Replace lines 10-11 in `byom-companion.mjs`:

```js
// Old:
import { OpenRouterClient, API_KEY_ENV, DEFAULT_MODEL_ENV, DEFAULT_MODEL } from "./lib/openrouter.mjs";

// New:
import { resolveProvider, listProviders } from "./lib/providers.mjs";
import { ProviderClient } from "./lib/provider-client.mjs";

const DEFAULT_MODEL_ENV = "BYOM_DEFAULT_MODEL";
const DEFAULT_MODEL = "minimax/minimax-m2.7";
```

- [ ] **Step 2: Replace `ensureApiKeyReady` with provider-aware version**

Replace the `ensureApiKeyReady` function (lines 69-75):

```js
// Old:
function ensureApiKeyReady() {
  if (!process.env[API_KEY_ENV]) {
    throw new Error(
      `${API_KEY_ENV} is not set. Get an API key at https://openrouter.ai/keys and export it in your environment.`
    );
  }
}

// New:
function ensureProviderReady(provider) {
  if (!process.env[provider.apiKeyEnv]) {
    throw new Error(
      `${provider.apiKeyEnv} is not set. Set it in your environment to use ${provider.label}.`
    );
  }
  if (provider.name === "custom" && !process.env[provider.baseUrlEnv]) {
    throw new Error(
      `${provider.baseUrlEnv} is required when using the custom provider.`
    );
  }
}
```

- [ ] **Step 3: Rewrite `buildSetupReport` for multi-provider dashboard**

Replace the `buildSetupReport` function (lines 77-93):

```js
function buildSetupReport() {
  const providers = {};
  let anyConfigured = false;

  for (const provider of listProviders()) {
    const hasKey = Boolean(process.env[provider.apiKeyEnv]);
    const hasBaseUrl = provider.name !== "custom" || Boolean(process.env[provider.baseUrlEnv]);
    const configured = hasKey && hasBaseUrl;

    if (configured) {
      anyConfigured = true;
    }

    providers[provider.name] = {
      label: provider.label,
      configured,
      apiKeyEnv: provider.apiKeyEnv,
      ...(provider.baseUrlEnv ? { baseUrlEnv: provider.baseUrlEnv } : {})
    };

    if (provider.name === "openrouter" && configured) {
      providers[provider.name].defaultModel =
        process.env[DEFAULT_MODEL_ENV] || DEFAULT_MODEL;
    }
  }

  const defaultProvider = process.env.BYOM_DEFAULT_PROVIDER || "openrouter";
  const nextSteps = [];

  for (const [name, info] of Object.entries(providers)) {
    if (!info.configured) {
      if (name === "custom") {
        nextSteps.push(
          `To use a custom provider: export ${info.apiKeyEnv}=... and export ${info.baseUrlEnv}=...`
        );
      } else {
        nextSteps.push(`To use ${info.label}: export ${info.apiKeyEnv}=your-key-here`);
      }
    }
  }

  return {
    ready: anyConfigured,
    defaultProvider,
    providers,
    nextSteps
  };
}
```

- [ ] **Step 4: Rewrite `renderSetupReport` for multi-provider dashboard**

Replace the `renderSetupReport` function (lines 95-111):

```js
function renderSetupReport(report) {
  const lines = [];
  lines.push("BYOM Code Review Setup");
  lines.push("─────────────────────");
  lines.push("Providers:");

  for (const [name, info] of Object.entries(report.providers)) {
    const status = info.configured ? "✓" : "✗";
    let detail;
    if (info.configured) {
      detail = "API key configured";
      if (info.defaultModel) {
        detail += `, default model: ${info.defaultModel}`;
      }
    } else if (name === "custom") {
      detail = `not configured (${info.apiKeyEnv} + ${info.baseUrlEnv})`;
    } else {
      detail = `API key not set (${info.apiKeyEnv})`;
    }
    lines.push(`  ${status} ${name.padEnd(14)}— ${detail}`);
  }

  lines.push("");
  lines.push(`Default provider: ${report.defaultProvider}`);
  lines.push(`Ready: ${report.ready ? "yes" : "no"}`);

  if (report.nextSteps.length > 0) {
    lines.push("");
    lines.push("Next steps:");
    for (const step of report.nextSteps) {
      lines.push(`  • ${step}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}
```

- [ ] **Step 5: Update `executeReviewRun` to accept and use provider**

Replace `executeReviewRun` (lines 142-197). The key changes are: accept `provider` in the request, call `ensureProviderReady(provider)` instead of `ensureApiKeyReady()`, and construct `new ProviderClient(provider)` instead of `new OpenRouterClient()`:

```js
async function executeReviewRun(request) {
  const provider = request.provider;
  ensureProviderReady(provider);
  ensureGitRepository(request.cwd);

  const target = resolveReviewTarget(request.cwd, {
    base: request.base,
    scope: request.scope
  });

  const context = collectReviewContext(request.cwd, target);
  const schema = readOutputSchema(REVIEW_SCHEMA_PATH);
  const client = new ProviderClient(provider, {
    defaultModel: process.env[DEFAULT_MODEL_ENV] || DEFAULT_MODEL
  });

  const focusText = request.focusText?.trim() ?? "";
  const reviewName = request.reviewName ?? "Review";
  const systemPrompt =
    reviewName === "Adversarial Review"
      ? buildAdversarialReviewPrompt(context, focusText)
      : buildStandardReviewPrompt(context);

  const reviewResult = await runReview({
    client,
    gitContext: context,
    systemPrompt,
    schema,
    model: request.model
  });

  const parsed = reviewResult.result;
  const payload = {
    review: reviewName,
    target,
    context: {
      repoRoot: context.repoRoot,
      branch: context.branch,
      summary: context.summary
    },
    model: reviewResult.model,
    usage: reviewResult.usage,
    result: parsed.parsed,
    rawOutput: parsed.rawOutput,
    parseError: parsed.parseError
  };

  return {
    exitStatus: reviewResult.status,
    payload,
    rendered: renderReviewResult(parsed, {
      reviewLabel: reviewName,
      targetLabel: context.target.label,
      model: reviewResult.model,
      usage: reviewResult.usage
    }),
    summary: parsed.parsed?.summary ?? parsed.parseError ?? firstMeaningfulLine(parsed.rawOutput, `${reviewName} finished.`)
  };
}
```

- [ ] **Step 6: Update `handleReview` to parse `--provider` and resolve provider**

Replace `handleReview` (lines 199-224):

```js
async function handleReview(argv, reviewName = "Review") {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["base", "scope", "model", "provider", "cwd"],
    booleanOptions: ["json", "wait"],
    aliasMap: {
      m: "model",
      p: "provider"
    }
  });

  const provider = resolveProvider({ provider: options.provider });
  const cwd = resolveCommandCwd(options);
  const focusText = positionals.join(" ").trim();

  const execution = await executeReviewRun({
    cwd,
    base: options.base,
    scope: options.scope,
    model: options.model,
    provider,
    focusText,
    reviewName
  });

  outputResult(options.json ? execution.payload : execution.rendered, options.json);
  if (execution.exitStatus !== 0) {
    process.exitCode = execution.exitStatus;
  }
}
```

- [ ] **Step 7: Run all tests**

Run: `node --test tests/*.test.mjs`
Expected: `tests/providers.test.mjs` passes, `tests/provider-client.test.mjs` passes, `tests/review-engine.test.mjs` passes. `tests/commands.test.mjs` may have assertions checking for "OpenRouter" in command markdown — those will be updated in Task 5.

- [ ] **Step 8: Commit**

```bash
git add plugins/byom-review/scripts/byom-companion.mjs
git commit -m "feat: wire provider system into companion script"
```

---

### Task 4: Update Slash Commands

**Files:**
- Modify: `plugins/byom-review/commands/review.md`
- Modify: `plugins/byom-review/commands/adversarial-review.md`
- Modify: `plugins/byom-review/commands/setup.md`

- [ ] **Step 1: Update `review.md`**

In `commands/review.md`, update the argument-hint on line 3 to include `--provider`:

```
argument-hint: '[--provider <name>] [--model <id>] [--base <ref>] [--scope auto|working-tree|branch]'
```

In the "Argument handling" section (around line 33), update the description of supported flags. Replace:

```
- Supported models: any model ID from OpenRouter (e.g., `anthropic/claude-sonnet-4`, `openai/gpt-4o`, `google/gemini-2.0-flash`).
```

with:

```
- Supported providers: `openrouter` (default), `baseten`, `custom`. Use `--provider <name>` to select.
- Supported models: any model ID supported by the selected provider (e.g., `anthropic/claude-sonnet-4` on OpenRouter, `deepseek-ai/DeepSeek-V3.1` on Baseten).
```

- [ ] **Step 2: Update `adversarial-review.md`**

In `commands/adversarial-review.md`, update the argument-hint on line 3 to include `--provider`:

```
argument-hint: '[--provider <name>] [--model <id>] [--base <ref>] [--scope auto|working-tree|branch] [focus ...]'
```

Replace line 8:

```
Run an adversarial code review through OpenRouter using any model.
```

with:

```
Run an adversarial code review using any model via the configured provider.
```

In the "Argument handling" section (around line 39), replace:

```
- Supported models: any model ID from OpenRouter (e.g., `anthropic/claude-sonnet-4`, `openai/gpt-4o`, `google/gemini-2.0-flash`).
```

with:

```
- Supported providers: `openrouter` (default), `baseten`, `custom`. Use `--provider <name>` to select.
- Supported models: any model ID supported by the selected provider.
```

- [ ] **Step 3: Update `setup.md`**

Replace the full content of `commands/setup.md` with:

```markdown
---
description: Check which providers are configured for BYOM code reviews
argument-hint: ''
allowed-tools: Bash(node:*), AskUserQuestion
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/byom-companion.mjs" setup --json $ARGUMENTS
```

Present the setup output to the user.

The setup command shows a dashboard of all configured providers (OpenRouter, Baseten, custom).

If no providers are configured:
- Explain that the user needs at least one provider API key.
- For OpenRouter: direct them to https://openrouter.ai/keys and suggest `export OPENROUTER_API_KEY=your-key-here`
- For Baseten: suggest `export BASETEN_API_KEY=your-key-here`
- For a custom OpenAI-compatible endpoint: suggest `export BYOM_CUSTOM_API_KEY=... and export BYOM_CUSTOM_BASE_URL=...`

Optional configuration:
- `BYOM_DEFAULT_PROVIDER` — set the default provider (defaults to `openrouter`).
- `BYOM_DEFAULT_MODEL` — set a default model (defaults to `minimax/minimax-m2.7`).
- The `--provider` flag on review commands overrides the default provider.
- The `--model` flag on review commands overrides the default model.
```

- [ ] **Step 4: Commit**

```bash
git add plugins/byom-review/commands/review.md plugins/byom-review/commands/adversarial-review.md plugins/byom-review/commands/setup.md
git commit -m "feat: add --provider flag to review commands, update setup for multi-provider"
```

---

### Task 5: Update Plugin Manifest and Tests

**Files:**
- Modify: `plugins/byom-review/.claude-plugin/plugin.json`
- Modify: `tests/commands.test.mjs`

- [ ] **Step 1: Update plugin.json description**

In `plugins/byom-review/.claude-plugin/plugin.json`, replace line 3:

```json
"description": "Bring Your Own Model — code review with any AI model via OpenRouter.",
```

with:

```json
"description": "Bring Your Own Model — code review with any AI model via OpenRouter, Baseten, or any OpenAI-compatible provider.",
```

- [ ] **Step 2: Update commands.test.mjs assertions**

In `tests/commands.test.mjs`, the tests assert that command files and the plugin manifest mention "OpenRouter". Some of these assertions need updating now that the commands are provider-neutral.

Replace the test `"review command uses AskUserQuestion and background Bash while staying review-only"` (lines 13-31). Remove the `assert.match(source, /OpenRouter/i);` line on line 31. Add instead:

```js
  assert.match(source, /--provider/);
```

Replace the test `"adversarial review command uses AskUserQuestion and background Bash while staying review-only"` (lines 33-51). Remove the `assert.match(source, /OpenRouter/i);` line on line 49. Add instead:

```js
  assert.match(source, /--provider/);
```

Replace the test `"setup command references OpenRouter API key"` (lines 62-68):

```js
test("setup command references provider configuration", () => {
  const setup = read("commands/setup.md");
  assert.match(setup, /OPENROUTER_API_KEY/);
  assert.match(setup, /BASETEN_API_KEY/);
  assert.match(setup, /BYOM_CUSTOM_API_KEY/);
  assert.match(setup, /byom-companion\.mjs" setup --json/);
  assert.match(setup, /BYOM_DEFAULT_MODEL/);
  assert.match(setup, /BYOM_DEFAULT_PROVIDER/);
});
```

Replace the test `"plugin manifest has correct name and description"` (lines 78-83):

```js
test("plugin manifest has correct name and description", () => {
  const plugin = JSON.parse(read(".claude-plugin/plugin.json"));
  assert.equal(plugin.name, "byom-review");
  assert.match(plugin.description, /OpenRouter/i);
  assert.match(plugin.description, /Baseten/i);
});
```

- [ ] **Step 3: Run all tests**

Run: `node --test tests/*.test.mjs`
Expected: All tests pass across all test files.

- [ ] **Step 4: Commit**

```bash
git add plugins/byom-review/.claude-plugin/plugin.json tests/commands.test.mjs
git commit -m "feat: update plugin manifest and test assertions for multi-provider"
```

---

### Task 6: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README.md**

Key changes to `README.md`:

1. Update the opening line (line 3) from:
   ```
   Code review with **any AI model** via [OpenRouter](https://openrouter.ai), as a [Claude Code](https://claude.ai/code) plugin.
   ```
   to:
   ```
   Code review with **any AI model** via [OpenRouter](https://openrouter.ai), [Baseten](https://www.baseten.co), or any OpenAI-compatible provider, as a [Claude Code](https://claude.ai/code) plugin.
   ```

2. Update the "Requirements" section (lines 15-17) from:
   ```
   - **OpenRouter API key** — get one at [openrouter.ai/keys](https://openrouter.ai/keys)
   ```
   to:
   ```
   - **At least one provider API key** — [OpenRouter](https://openrouter.ai/keys), [Baseten](https://www.baseten.co), or any OpenAI-compatible endpoint
   ```

3. Replace the "Configuration" section (lines 44-49) with:
   ```markdown
   ## Configuration

   ### Provider Selection

   | Variable | Required | Description |
   |---|---|---|
   | `BYOM_DEFAULT_PROVIDER` | No | Default provider: `openrouter` (default), `baseten`, or `custom` |
   | `BYOM_DEFAULT_MODEL` | No | Default model ID (default: `minimax/minimax-m2.7`) |

   You can also pass `--provider <name>` and `--model <id>` on any review command to override defaults.

   ### Provider API Keys

   | Provider | Variable | Base URL Override |
   |---|---|---|
   | OpenRouter | `OPENROUTER_API_KEY` | `OPENROUTER_BASE_URL` |
   | Baseten | `BASETEN_API_KEY` | `BASETEN_BASE_URL` |
   | Custom | `BYOM_CUSTOM_API_KEY` | `BYOM_CUSTOM_BASE_URL` (required) |
   ```

4. Update the "Usage" examples to show `--provider`:
   ```bash
   /byom-review:review --provider baseten --model deepseek-ai/DeepSeek-V3.1
   ```

5. Update the "Supported Models" section to note that model IDs are provider-specific and show examples per provider.

6. Update the "How It Works" section to replace "via OpenRouter's API" with "via the selected provider's API".

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README for multi-provider support"
```

---

### Task 7: Final Verification

- [ ] **Step 1: Run the full test suite**

Run: `node --test tests/*.test.mjs`
Expected: All tests pass — providers, provider-client, review-engine, commands.

- [ ] **Step 2: Run the companion script setup to verify it works**

Run: `node plugins/byom-review/scripts/byom-companion.mjs setup --json`
Expected: JSON output with `providers` object showing configuration status for all three providers.

- [ ] **Step 3: Run the companion script setup in human-readable mode**

Run: `node plugins/byom-review/scripts/byom-companion.mjs setup`
Expected: Multi-provider dashboard output.

- [ ] **Step 4: Verify no references to old openrouter.mjs remain**

Run: `grep -r "openrouter.mjs" plugins/ tests/`
Expected: No matches.

Run: `grep -r "OpenRouterClient" plugins/ tests/`
Expected: No matches.
