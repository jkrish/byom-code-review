# Multi-Model Simultaneous Code Review

**Date:** 2026-03-31
**Status:** Approved
**Scope:** `/byom-review:review` command only (not adversarial-review)

## Overview

Allow users to run code reviews across multiple OpenRouter models in parallel and receive both individual results and a Claude-synthesized comparative analysis.

## CLI Interface

### New flag: `--models`

```
/byom-review:review --models openai/gpt-4o,anthropic/claude-sonnet-4,google/gemini-2.0-flash
```

- Accepts a comma-separated list of OpenRouter model IDs (no spaces)
- Each model ID is trimmed of whitespace; duplicates are removed
- Minimum 2 unique models, maximum 5
- Mutually exclusive with `--model`:
  - Both present: error `"Cannot use --model and --models together. Use --models for multi-model comparison."`
  - Fewer than 2: error `"--models requires at least 2 models for comparison."`
  - More than 5: error `"Maximum 5 models allowed for comparison. You provided N."`
- Not supported on `adversarial-review`. If passed there: error `"--models is not supported for adversarial reviews yet."`

### Parsing

`--models` is parsed as a regular `valueOption` in the existing arg parser. The companion script splits the value on commas. No changes to `args.mjs`.

## Execution Engine

### Function: `executeMultiModelReview`

New function in `byom-companion.mjs` alongside existing `executeReviewRun`.

**Flow:**

1. Parse `--models` string into array, validate count (2-5)
2. Collect git context once (reuse `resolveReviewTarget` + `collectReviewContext`)
3. Build review prompt once (reuse `buildStandardReviewPrompt`)
4. Read output schema once
5. Fan out API calls — one `runReview()` per model, bounded by concurrency pool (max 3 concurrent)
6. Each call wrapped in per-model try/catch
7. Collect results into structured array, sorted alphabetically by model ID

### Concurrency

Simple in-process semaphore in a new `lib/concurrency.mjs` (~15 lines). No external dependencies — the project has zero npm deps and this is preserved.

### Timeout Strategy: Straggler Detection

No fixed per-model timeout. Instead, a relative timeout triggers when a model falls behind the pack:

1. All models run until completion with no fixed per-model deadline
2. On each model completion (success or error), check: is there at least one success AND at least one model still pending?
3. If yes, start (or re-arm) a **straggler timer** for 60s from the most recent completion
4. If the straggler timer fires, abort all still-pending models via `AbortController` with status `"timeout"`
5. If no model has succeeded yet, no straggler timer is armed — all models keep running up to the global timeout
6. **Global timeout** (`BYOM_GLOBAL_TIMEOUT_MS`, default: 300000 / 5 minutes) acts as an absolute safeguard. If the entire multi-model run exceeds this, all pending models are aborted. This prevents indefinite hangs when no model ever succeeds.
7. Straggler timeout configurable via `BYOM_STRAGGLER_TIMEOUT_MS` environment variable (default: 60000)
8. The straggler timer only considers **dispatched** models (those that have actually started their API call), not models still queued behind the concurrency pool

### Per-Model Result Shape

```json
{
  "model": "openai/gpt-4o",
  "status": "success | error | timeout",
  "review": { "verdict": "...", "summary": "...", "findings": [...], "next_steps": [...] },
  "usage": { "prompt_tokens": 1200, "completion_tokens": 800, "cost": 0.0032 },
  "error": null,
  "durationMs": 4523,
  "_note": "durationMs = wall-clock ms from dispatch to completion/abort. usage may be null for error/timeout. aggregate.failed = error count + timeout count."
}
```

### Partial Failure Handling

- Some succeed, some fail: render successful reviews + "Failed Models" section. Claude synthesizes from what's available.
- All fail: exit with status 1, render error summary.

## Output Format

### Human-readable output (default)

**Part 1 — Individual reviews** (rendered exactly as today's single-model format, repeated per model):

```
Review — working tree diff
Model: openai/gpt-4o
─────────────────────
Verdict: needs-attention

Summary: ...
Findings (3):
  [HIGH] ...

Tokens: 1200 prompt, 800 completion
Cost: $0.003200
Duration: 4.5s
```

**Part 2 — Failed models** (only if any):

```
─────────────────────
Failed Models:
  ✗ google/gemini-2.0-flash — Aborted: did not complete within 60s of other models finishing
```

**Part 3 — Aggregate stats:**

```
─────────────────────
Multi-Model Summary:
  Models: 3 requested, 2 completed, 1 timed out
  Total cost: $0.008400
  Total duration: 12.3s
```

### JSON output (`--json`)

```json
{
  "review": "Review",
  "target": { "mode": "working-tree", "label": "working tree diff" },
  "context": { "repoRoot": "...", "branch": "...", "summary": "..." },
  "models": [
    { "model": "openai/gpt-4o", "status": "success", "review": { ... }, "usage": { ... }, "durationMs": 4523 },
    { "model": "anthropic/claude-sonnet-4", "status": "success", "review": { ... }, "usage": { ... }, "durationMs": 6100 },
    { "model": "google/gemini-2.0-flash", "status": "timeout", "review": null, "error": "...", "durationMs": 72000 }
  ],
  "aggregate": {
    "requested": 3,
    "completed": 2,
    "failed": 1,
    "totalCost": 0.0084,
    "totalDurationMs": 12300
  }
}
```

## Slash Command Changes

### `commands/review.md`

When `--models` is present in `$ARGUMENTS`:

1. Follow same execution mode rules (size estimation, foreground/background recommendation)
2. Run the companion script as today
3. After output, Claude synthesizes a comparative analysis covering:
   - **Verdict consensus:** did models agree or disagree?
   - **Finding overlap:** issues flagged by multiple models (higher confidence) vs. unique findings
   - **Severity alignment:** did models rate the same issues at the same severity?
   - **Notable disagreements:** where models contradicted each other, with reasoning about which is likely correct
   - **Combined recommendation:** ship / don't ship based on weight of evidence

When `--models` is NOT present: behavior identical to today.

Command remains review-only — Claude does not fix issues or propose patches.

### `commands/adversarial-review.md`

Add guard that returns an error if `--models` is present in arguments.

## File Changes

| File | Change |
|---|---|
| `scripts/lib/concurrency.mjs` | **New** — `asyncPoolWithStragglerTimeout` utility |
| `scripts/lib/render.mjs` | Add `renderMultiModelResult` function |
| `scripts/byom-companion.mjs` | `--models` parsing, validation, `executeMultiModelReview`, rendering wiring |
| `commands/review.md` | Multi-model detection + synthesis instructions |
| `commands/adversarial-review.md` | Guard against `--models` |
| `tests/multi-model.test.mjs` | **New** — argument validation, concurrency pool, straggler timeout, partial failure, render output, JSON shape |

### Small change:

- `lib/openrouter.mjs` — add optional `signal` (AbortSignal) parameter to `chatCompletion()`, passed through to `fetch()`. Required for straggler/global timeout abort.

### No changes to:
- `lib/git.mjs` — context collected once, reused
- `lib/prompts.mjs` — prompt built once, reused
- `schemas/review-output.schema.json` — individual review schema unchanged
- `hooks/hooks.json` — no lifecycle changes
- `lib/args.mjs` — `--models` parsed as standard `valueOption`

**Total: 1 new file, 5 modified files, 1 new test file.**

## Configuration

| Variable | Default | Description |
|---|---|---|
| `BYOM_STRAGGLER_TIMEOUT_MS` | `60000` | Time in ms to wait for straggler models after others complete |
| `BYOM_GLOBAL_TIMEOUT_MS` | `300000` | Absolute max time in ms for the entire multi-model run |

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Rate limit breaches from parallel calls | Concurrency pool capped at 3 concurrent requests |
| Token context explosion in Claude synthesis | Individual reviews are rendered text (not raw JSON), naturally bounded |
| `--model` / `--models` flag collision | Mutual exclusion enforced at parse time with clear error |
| Single model failure blocks all results | Straggler detection + partial failure rendering |
| Cost surprise from 5 simultaneous models | Max 5 cap + per-model cost shown + aggregate total |
| Non-deterministic output ordering | Results sorted alphabetically by model ID (case-insensitive) |
| Indefinite hang if no model succeeds | Global timeout (5 min) as absolute safeguard |
| Straggler timer kills queued (not-yet-started) models | Timer only considers dispatched models |
| AbortController not threaded to fetch | Small change to `openrouter.mjs` to accept `signal` |
