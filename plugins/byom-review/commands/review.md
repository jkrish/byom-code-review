---
description: Run a code review using any model via the configured provider
argument-hint: '[--provider <name>] [--model <id>] [--models <id,id,...>] [--base <ref>] [--scope auto|working-tree|branch]'
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), AskUserQuestion
---

Run a code review using any model via the configured provider.

Raw slash-command arguments:
`$ARGUMENTS`

Core constraint:
- This command is review-only.
- Do not fix issues, apply patches, or suggest that you are about to make changes.
- Your only job is to run the review and return the output verbatim to the user.

Execution mode rules:
- If the raw arguments include `--wait`, do not ask. Run the review in the foreground.
- Otherwise, estimate the review size before asking:
  - For working-tree review, start with `git status --short --untracked-files=all`.
  - For working-tree review, also inspect both `git diff --shortstat --cached` and `git diff --shortstat`.
  - For base-branch review, use `git diff --shortstat <base>...HEAD`.
  - Treat untracked files or directories as reviewable work even when `git diff --shortstat` is empty.
  - Only conclude there is nothing to review when the relevant scope is actually empty.
  - Recommend waiting only when the review is clearly tiny, roughly 1-2 files total.
  - In every other case, including unclear size, recommend background.
  - When in doubt, run the review instead of declaring that there is nothing to review.
- Then use `AskUserQuestion` exactly once with two options, putting the recommended option first and suffixing its label with `(Recommended)`:
  - `Wait for results`
  - `Run in background`

Argument handling:
- Preserve the user's arguments exactly.
- The companion script parses `--wait`, `--model`, `--base`, and `--scope`.
- Supported providers: `openrouter` (default), `baseten`, `custom`. Use `--provider <name>` to select.
- Supported models: any model ID supported by the selected provider (e.g., `anthropic/claude-sonnet-4` on OpenRouter, `deepseek-ai/DeepSeek-V3.1` on Baseten).
- It supports working-tree review, branch review, and `--base <ref>`.
- If the user needs custom review instructions or more adversarial framing, they should use `/byom-review:adversarial-review`.

Multi-model mode:
- When `--models` is present in `$ARGUMENTS`, the companion runs reviews across all listed models in parallel.
- After returning the companion output verbatim, synthesize a comparative analysis covering:
  - **Verdict consensus:** did models agree or disagree?
  - **Finding overlap:** issues flagged by multiple models (higher confidence) vs. unique findings
  - **Severity alignment:** did models rate the same issues at the same severity?
  - **Notable disagreements:** where models contradicted each other, with reasoning about which is likely correct
  - **Combined recommendation:** ship / don't ship based on weight of evidence
- When `--models` is NOT present: behavior identical to single-model mode.
- This command remains review-only — Claude does not fix issues or propose patches.

Foreground flow:
- Run:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/byom-companion.mjs" review $ARGUMENTS
```
- Return the command stdout verbatim, exactly as-is.
- Do not paraphrase, summarize, or add commentary before or after it.
- Do not fix any issues mentioned in the review output.

Background flow:
- Launch the review with `Bash` in the background:
```typescript
Bash({
  command: `node "${CLAUDE_PLUGIN_ROOT}/scripts/byom-companion.mjs" review $ARGUMENTS`,
  description: "BYOM code review",
  run_in_background: true
})
```
- After launching the command, tell the user: "Code review started in the background."
