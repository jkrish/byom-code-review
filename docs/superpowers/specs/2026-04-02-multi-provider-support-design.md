# Multi-Provider Support

**Date:** 2026-04-02
**Status:** Approved
**Scope:** All review commands and setup

## Overview

Add support for multiple LLM inference providers beyond OpenRouter. The plugin ships with three built-in providers — OpenRouter, Baseten, and a generic custom provider for any OpenAI-compatible endpoint. Users select a provider via `--provider` flag or `BYOM_DEFAULT_PROVIDER` env var.

## Provider Registry (`lib/providers.mjs`)

A new module that exports a registry of provider definitions. Each provider is a plain object:

```js
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
}
```

### Built-in Providers

**openrouter:**
- Base URL: `https://openrouter.ai/api/v1`
- Auth: `Bearer <key>`
- API key env: `OPENROUTER_API_KEY`
- Base URL env: `OPENROUTER_BASE_URL`
- Extra headers: `HTTP-Referer`, `X-Title`

**baseten:**
- Base URL: `https://inference.baseten.co/v1`
- Auth: `Api-Key <key>`
- API key env: `BASETEN_API_KEY`
- Base URL env: `BASETEN_BASE_URL`
- Extra headers: none

**custom:**
- Base URL: from `BYOM_CUSTOM_BASE_URL` (required)
- Auth: `Bearer <key>`
- API key env: `BYOM_CUSTOM_API_KEY`
- Base URL env: `BYOM_CUSTOM_BASE_URL`
- Extra headers: none

### Registry API

- `getProvider(name)` — returns the provider config or throws `"Unknown provider: <name>. Available: openrouter, baseten, custom"`
- `listProviders()` — returns all provider configs
- `resolveProvider(options)` — checks `--provider` flag, then `BYOM_DEFAULT_PROVIDER` env, then falls back to `"openrouter"`

## Generic Provider Client (`lib/provider-client.mjs`)

Replaces `lib/openrouter.mjs`. The `OpenRouterClient` class becomes `ProviderClient`, taking a provider config at construction:

```js
const client = new ProviderClient(provider, { apiKey, baseUrl });
```

### Behavior

- Same `chatCompletion({ messages, model, responseFormat, temperature, maxTokens })` signature as today
- Same response shape: `{ content, model, usage, id }`
- Auth header comes from `provider.authHeader(key)`
- Extra headers come from `provider.extraHeaders`
- Base URL from provider config with env var override
- Error messages include provider label (e.g., "Baseten API error (400): ...")
- `listModels()` stays but becomes best-effort — if `/models` returns 404, `validateApiKey()` returns `{ valid: "unknown" }` instead of failing

### Removed Exports

The named exports `API_KEY_ENV`, `DEFAULT_MODEL_ENV`, `DEFAULT_MODEL` from `openrouter.mjs` are removed. `DEFAULT_MODEL` (`minimax/minimax-m2.7`) and `DEFAULT_MODEL_ENV` (`BYOM_DEFAULT_MODEL`) move to `byom-companion.mjs`. Provider-specific env var names live in the provider registry.

## CLI & Argument Changes

### New flag: `--provider`

Added as a `valueOption` in the arg parser for both `review` and `adversarial-review` commands.

### Resolution order

1. `--provider` flag (explicit per-review)
2. `BYOM_DEFAULT_PROVIDER` env var
3. Falls back to `"openrouter"`

### Validation

- Unknown provider name: error `"Unknown provider: <name>. Available: openrouter, baseten, custom"`
- No API key for resolved provider: error pointing to the right env var (e.g., `"BASETEN_API_KEY is not set. Set it in your environment to use Baseten."`)
- `--provider custom` without `BYOM_CUSTOM_BASE_URL`: error `"BYOM_CUSTOM_BASE_URL is required when using the custom provider."`

### Interaction with `--model`

`--model` passes the model ID directly to whichever provider is resolved. Model IDs are provider-specific — the plugin does not validate whether a model exists on a given provider.

### Interaction with `--models` (multi-model spec)

`--models` sends all models to the resolved provider. No cross-provider mixing. `--provider` applies to the whole batch.

## Setup Command Changes

`/byom-review:setup` becomes a provider dashboard that always reports all providers.

### Human-readable output:

```
BYOM Code Review Setup
─────────────────────
Providers:
  ✓ openrouter    — API key configured, default model: minimax/minimax-m2.7
  ✗ baseten       — API key not set (BASETEN_API_KEY)
  ✗ custom        — not configured (BYOM_CUSTOM_API_KEY + BYOM_CUSTOM_BASE_URL)

Default provider: openrouter
Ready: yes

Next steps:
  • To use Baseten: export BASETEN_API_KEY=your-key-here
  • To use a custom provider: export BYOM_CUSTOM_API_KEY=... and BYOM_CUSTOM_BASE_URL=...
```

### Logic

- Iterates `listProviders()`, checks if each has its API key set
- For custom, also checks `BYOM_CUSTOM_BASE_URL`
- "Ready" is true if at least one provider is configured
- "Default provider" shows the resolved default
- Next steps only lists unconfigured providers

### JSON output (`--json`):

```json
{
  "ready": true,
  "defaultProvider": "openrouter",
  "providers": {
    "openrouter": { "configured": true, "defaultModel": "minimax/minimax-m2.7" },
    "baseten": { "configured": false, "apiKeyEnv": "BASETEN_API_KEY" },
    "custom": { "configured": false, "apiKeyEnv": "BYOM_CUSTOM_API_KEY", "baseUrlEnv": "BYOM_CUSTOM_BASE_URL" }
  },
  "nextSteps": ["..."]
}
```

### `commands/setup.md` changes

Updated to reflect multi-provider output. Guides user to configure whichever provider they need rather than only OpenRouter.

## File Changes

| File | Change |
|---|---|
| `scripts/lib/providers.mjs` | **New** — provider registry with openrouter, baseten, custom definitions |
| `scripts/lib/provider-client.mjs` | **New** — generic `ProviderClient` class |
| `scripts/lib/openrouter.mjs` | **Deleted** — replaced by `providers.mjs` + `provider-client.mjs` |
| `scripts/byom-companion.mjs` | `--provider` parsing, provider resolution, imports updated, `ensureApiKeyReady` becomes provider-aware, setup report rewritten |
| `commands/setup.md` | Updated for multi-provider dashboard |
| `commands/review.md` | Add `--provider` to argument-hint and supported flags |
| `commands/adversarial-review.md` | Add `--provider` to argument-hint and supported flags |
| `.claude-plugin/plugin.json` | Update description — no longer "via OpenRouter" only |
| `README.md` | Document multi-provider support, new env vars, `--provider` flag |
| `tests/providers.test.mjs` | **New** — registry resolution, provider config validation, custom provider requirements |
| `tests/provider-client.test.mjs` | **New** — auth header generation, extra headers, error messages per provider |

### No changes to:
- `lib/args.mjs` — `--provider` parsed as standard `valueOption`
- `lib/git.mjs` — provider-independent
- `lib/prompts.mjs` — provider-independent
- `lib/render.mjs` — already receives model as a string, provider-agnostic
- `lib/review-engine.mjs` — calls `client.chatCompletion()` which stays the same interface
- `schemas/review-output.schema.json` — unchanged

**Total: 2 new files, 1 deleted file, 5 modified files, 2 new test files.**

## Configuration

| Variable | Default | Description |
|---|---|---|
| `BYOM_DEFAULT_PROVIDER` | `"openrouter"` | Default provider when `--provider` not specified |
| `BYOM_DEFAULT_MODEL` | `minimax/minimax-m2.7` | Default model (unchanged, applies to default provider) |
| `OPENROUTER_API_KEY` | — | OpenRouter API key (unchanged) |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | OpenRouter base URL override (unchanged) |
| `BASETEN_API_KEY` | — | Baseten API key |
| `BASETEN_BASE_URL` | `https://inference.baseten.co/v1` | Baseten base URL override |
| `BYOM_CUSTOM_API_KEY` | — | Custom provider API key |
| `BYOM_CUSTOM_BASE_URL` | — | Custom provider base URL (required for custom) |

## Backward Compatibility

- Existing `OPENROUTER_API_KEY` users are unaffected — openrouter remains the default provider
- `BYOM_DEFAULT_MODEL` continues to work as before
- All existing CLI flags (`--model`, `--base`, `--scope`, `--wait`) are unchanged
- Review output format is unchanged — the only new information is the provider name may appear in verbose/debug output

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Breaking existing users who import from `openrouter.mjs` | Plugin scripts are internal — no external consumers. `review-engine.mjs` calls `client.chatCompletion()` which keeps the same interface. |
| Provider with non-OpenAI-compatible API | Out of scope — all three built-in providers are OpenAI-compatible. Future non-compatible providers would need a different adapter pattern. |
| Custom provider misconfiguration | Clear error messages for missing `BYOM_CUSTOM_BASE_URL`. Setup dashboard shows configuration status. |
| `listModels()` / `validateApiKey()` not available on all providers | Best-effort — 404 returns `{ valid: "unknown" }` instead of failing. |
| Auth header format varies across providers | Each provider defines its own `authHeader(key)` function in the registry. |
