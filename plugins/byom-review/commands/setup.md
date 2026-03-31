---
description: Check whether the BYOM review plugin is configured with an OpenRouter API key
argument-hint: ''
allowed-tools: Bash(node:*), AskUserQuestion
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/byom-companion.mjs" setup --json $ARGUMENTS
```

Present the setup output to the user.

If the API key is not configured:
- Explain that the user needs to set `OPENROUTER_API_KEY` in their environment.
- Direct them to https://openrouter.ai/keys to get a key.
- Suggest: `export OPENROUTER_API_KEY=your-key-here`

Optional configuration:
- `BYOM_DEFAULT_MODEL` — set a default model (defaults to `minimax/minimax-m2.7`).
- The `--model` flag on review commands overrides the default.
- Any model available on OpenRouter can be used (e.g., `openai/gpt-4o`, `google/gemini-2.0-flash`, `meta-llama/llama-3.1-405b-instruct`).
