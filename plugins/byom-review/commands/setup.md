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
