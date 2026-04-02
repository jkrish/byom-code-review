# BYOM Code Review — Bring Your Own Model

Code review with **any AI model** via [OpenRouter](https://openrouter.ai), [Baseten](https://www.baseten.co), or any OpenAI-compatible provider, as a [Claude Code](https://claude.ai/code) plugin.

Forked from [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc) and adapted to use multiple inference providers, so you can review code with Claude, GPT, Gemini, Llama, DeepSeek, or any other model available on your chosen provider.

## What You Get

- `/byom-review:review` — standard code review against your local git state
- `/byom-review:adversarial-review` — steerable challenge review that questions design choices
- `/byom-review:setup` — check configuration status

## Requirements

- **At least one provider API key** — [OpenRouter](https://openrouter.ai/keys), [Baseten](https://www.baseten.co), or any OpenAI-compatible endpoint
- **Node.js 18.18 or later**

## Install

Add the plugin in Claude Code:

```bash
/plugin install byom-review
```

> **Note:** While the plugin is pending marketplace review, you can install directly from the repo:
> ```bash
> /plugin marketplace add jkrish/byom-code-review
> /plugin install byom-review
> ```

Then set your provider API key (at least one):

```bash
export OPENROUTER_API_KEY=sk-or-v1-your-key-here
# or
export BASETEN_API_KEY=your-baseten-key-here
```

Run setup to verify:

```bash
/byom-review:setup
```

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

## Usage

### `/byom-review:review`

Runs a code review on your current work using any model via OpenRouter.

```bash
/byom-review:review
/byom-review:review --base main
/byom-review:review --model openai/gpt-4o
/byom-review:review --model google/gemini-2.0-flash --scope branch
/byom-review:review --provider baseten --model deepseek-ai/DeepSeek-V3.1
```

Supports:
- `--model <id>` — any OpenRouter model
- `--base <ref>` — branch review against a base ref
- `--scope <auto|working-tree|branch>` — review scope
- `--wait` — run in foreground

### `/byom-review:adversarial-review`

Runs a **steerable** review that challenges the implementation and design.

```bash
/byom-review:adversarial-review
/byom-review:adversarial-review --base main challenge whether this was the right caching design
/byom-review:adversarial-review --model anthropic/claude-sonnet-4 look for race conditions
```

Uses the same target selection as `/byom-review:review`. Unlike the standard review, it accepts extra focus text after the flags.

### `/byom-review:setup`

Checks whether the plugin is configured with an OpenRouter API key.

```bash
/byom-review:setup
```

## Supported Models

Model IDs are provider-specific. Here are popular choices per provider:

### OpenRouter

| Model | ID |
|---|---|
| Claude Sonnet 4 | `anthropic/claude-sonnet-4` |
| GPT-4o | `openai/gpt-4o` |
| Gemini 2.0 Flash | `google/gemini-2.0-flash` |
| Llama 3.1 405B | `meta-llama/llama-3.1-405b-instruct` |
| DeepSeek R1 | `deepseek/deepseek-r1` |

See the full list at [openrouter.ai/models](https://openrouter.ai/models).

### Baseten

| Model | ID |
|---|---|
| DeepSeek V3.1 | `deepseek-ai/DeepSeek-V3.1` |

See available models at [baseten.co](https://www.baseten.co).

### Custom Provider

Use any model ID supported by your endpoint.

## Review Output

Reviews produce structured JSON output with:

- **verdict**: `approve` or `needs-attention`
- **summary**: concise assessment
- **findings**: array of issues with severity, file, line numbers, confidence, and recommendation
- **next_steps**: suggested follow-up actions

## How It Works

1. Collects git context (diffs, commit logs, untracked files) from your working tree or branch
2. Sends context + review prompt to the selected model via the configured provider's API
3. Parses structured JSON output matching the review schema
4. Returns the review result

The plugin uses OpenAI-compatible APIs with structured output support. For models that don't support `json_schema` response format, it falls back to embedding the schema in the system prompt.

## Local Development

### Setup

Clone the repo and start Claude Code with the `--plugin-dir` flag pointing to the plugins directory:

```bash
git clone https://github.com/jkrish/byom-code-review.git
cd byom-code-review
claude --plugin-dir ./plugins
```

This loads all plugins under `plugins/` (including `byom-review`) without needing to install them from a registry. Changes to plugin files take effect on the next Claude Code restart.

### Project Structure

```
plugins/byom-review/
├── commands/          # Slash command definitions (Markdown)
│   ├── review.md
│   ├── adversarial-review.md
│   └── setup.md
├── hooks/
│   └── hooks.json     # Lifecycle hooks configuration
├── prompts/           # Prompt templates used by review commands
├── schemas/           # JSON schemas for structured review output
├── scripts/
│   ├── byom-companion.mjs        # Main companion script (setup, review logic)
│   ├── session-lifecycle-hook.mjs # Session hook entry point
│   └── lib/                       # Shared utilities
├── CHANGELOG.md
├── LICENSE
└── NOTICE
```

### Debugging

**Check plugin registration:**

```bash
/plugin
```

Verify `byom-review` appears in the list.

**Run setup diagnostics:**

```bash
/byom-review:setup
```

This checks API key configuration and reports any issues as JSON.

**Run the companion script directly:**

You can invoke the companion script outside of Claude Code for faster iteration:

```bash
# Check setup status
node plugins/byom-review/scripts/byom-companion.mjs setup --json

# Run a review (requires OPENROUTER_API_KEY in env)
node plugins/byom-review/scripts/byom-companion.mjs review --json

# Run with a specific model
node plugins/byom-review/scripts/byom-companion.mjs review --model openai/gpt-4o --json
```

**Enable verbose output:**

Set `DEBUG=byom` to see request/response details:

```bash
DEBUG=byom node plugins/byom-review/scripts/byom-companion.mjs review --json
```

**Common issues:**

| Problem | Fix |
|---|---|
| `OPENROUTER_API_KEY not set` | Export the key: `export OPENROUTER_API_KEY=sk-or-v1-...` |
| Plugin not found after launch | Ensure `--plugin-dir` points to the `plugins/` directory |
| Changes not reflected | Restart Claude Code with `--plugin-dir` — plugin files are loaded at startup |
| Model returns malformed JSON | Try a different model — not all models handle `json_schema` response format reliably |
| Node version errors | Requires Node.js 18.18+. Check with `node --version` |

## License

Apache-2.0 — see [LICENSE](LICENSE).
