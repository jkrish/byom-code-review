# Multi-Model Simultaneous Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow `--models model1,model2,model3` to fan out reviews to multiple models in parallel and return individual results plus aggregate stats.

**Architecture:** A concurrency pool (`lib/concurrency.mjs`) limits parallel API calls to 3. A straggler timer aborts slow models once others have finished. `executeMultiModelReview` in `byom-companion.mjs` orchestrates the fan-out, reusing the existing `runReview` for each model. `renderMultiModelResult` in `render.mjs` formats per-model results plus an aggregate summary. `ProviderClient.chatCompletion` accepts an optional `signal` for abort support.

**Tech Stack:** Node.js (ESM), native `fetch`, `AbortController`, `node:test`. Zero npm dependencies preserved.

**Spec:** `docs/superpowers/specs/2026-03-31-multi-model-review-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/lib/concurrency.mjs` | **New** — `asyncPool` function: runs async tasks with bounded concurrency + straggler timeout |
| `scripts/lib/provider-client.mjs` | **Modified** — Add `signal` parameter to `chatCompletion` and `listModels`, passed through to `fetch` |
| `scripts/lib/review-engine.mjs` | **Modified** — Pass `signal` through to `client.chatCompletion` in `runReview` |
| `scripts/lib/render.mjs` | **Modified** — Add `renderMultiModelResult` function |
| `scripts/byom-companion.mjs` | **Modified** — `--models` validation, `executeMultiModelReview`, wiring |
| `commands/review.md` | **Modified** — Document `--models` flag and Claude synthesis instructions |
| `commands/adversarial-review.md` | **Modified** — Guard against `--models` |
| `tests/concurrency.test.mjs` | **New** — Tests for concurrency pool and straggler timeout |
| `tests/multi-model.test.mjs` | **New** — Tests for argument validation, render output, JSON shape |

### No changes to:
- `lib/providers.mjs` — provider-independent
- `lib/args.mjs` — `--models` already registered as `valueOption`
- `lib/git.mjs` — context collected once, reused
- `lib/prompts.mjs` — prompt built once, reused
- `schemas/review-output.schema.json` — individual review schema unchanged

---

### Task 1: Concurrency Pool with Straggler Timeout

**Files:**
- Create: `plugins/byom-review/scripts/lib/concurrency.mjs`
- Create: `tests/concurrency.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/concurrency.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";

import { asyncPool } from "../plugins/byom-review/scripts/lib/concurrency.mjs";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("asyncPool runs all tasks and returns results", async () => {
  const tasks = [
    { id: "a", run: async () => "result-a" },
    { id: "b", run: async () => "result-b" },
    { id: "c", run: async () => "result-c" }
  ];
  const results = await asyncPool(tasks, { concurrency: 2 });
  assert.equal(results.length, 3);
  assert.deepEqual(
    results.map((r) => r.id).sort(),
    ["a", "b", "c"]
  );
  for (const r of results) {
    assert.equal(r.status, "success");
    assert.equal(r.value, `result-${r.id}`);
    assert.equal(r.error, null);
    assert.ok(r.durationMs >= 0);
  }
});

test("asyncPool respects concurrency limit", async () => {
  let running = 0;
  let maxRunning = 0;

  const tasks = Array.from({ length: 6 }, (_, i) => ({
    id: `t${i}`,
    run: async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await delay(20);
      running--;
      return i;
    }
  }));

  await asyncPool(tasks, { concurrency: 3 });
  assert.ok(maxRunning <= 3, `max concurrent was ${maxRunning}, expected <= 3`);
});

test("asyncPool captures errors per-task without aborting others", async () => {
  const tasks = [
    { id: "ok", run: async () => "fine" },
    { id: "fail", run: async () => { throw new Error("boom"); } },
    { id: "ok2", run: async () => "also fine" }
  ];
  const results = await asyncPool(tasks, { concurrency: 3 });
  const ok = results.find((r) => r.id === "ok");
  const fail = results.find((r) => r.id === "fail");
  const ok2 = results.find((r) => r.id === "ok2");
  assert.equal(ok.status, "success");
  assert.equal(ok.value, "fine");
  assert.equal(fail.status, "error");
  assert.equal(fail.error, "boom");
  assert.equal(fail.value, null);
  assert.equal(ok2.status, "success");
});

test("asyncPool aborts stragglers after timeout", async () => {
  const tasks = [
    { id: "fast", run: async () => { await delay(10); return "done"; } },
    {
      id: "slow",
      run: async (signal) => {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 5000);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(signal.reason ?? new Error("aborted"));
          });
        });
        return "should not reach";
      }
    }
  ];
  const results = await asyncPool(tasks, { concurrency: 2, stragglerTimeoutMs: 50 });
  const fast = results.find((r) => r.id === "fast");
  const slow = results.find((r) => r.id === "slow");
  assert.equal(fast.status, "success");
  assert.equal(slow.status, "timeout");
});

test("asyncPool does not arm straggler timer until at least one success", async () => {
  const tasks = [
    { id: "err", run: async () => { throw new Error("fail"); } },
    {
      id: "slow",
      run: async () => {
        await delay(100);
        return "finished";
      }
    }
  ];
  const results = await asyncPool(tasks, { concurrency: 2, stragglerTimeoutMs: 30 });
  const slow = results.find((r) => r.id === "slow");
  assert.equal(slow.status, "success", "slow task should succeed because straggler timer only arms after a success");
});

test("asyncPool enforces global timeout", async () => {
  const tasks = [
    {
      id: "forever",
      run: async (signal) => {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 10000);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(signal.reason ?? new Error("aborted"));
          });
        });
        return "nope";
      }
    }
  ];
  const results = await asyncPool(tasks, { concurrency: 1, globalTimeoutMs: 50 });
  assert.equal(results[0].status, "timeout");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/concurrency.test.mjs`
Expected: All tests fail — module does not exist.

- [ ] **Step 3: Implement the concurrency pool**

Create `plugins/byom-review/scripts/lib/concurrency.mjs`:

```js
export async function asyncPool(tasks, options = {}) {
  const concurrency = options.concurrency ?? 3;
  const stragglerTimeoutMs = options.stragglerTimeoutMs ?? 60000;
  const globalTimeoutMs = options.globalTimeoutMs ?? 300000;

  const results = new Map();
  const controllers = new Map();
  let hasSuccess = false;
  let stragglerTimer = null;
  let globalTimer = null;

  function abortPending(reason) {
    for (const [id, controller] of controllers) {
      if (!results.has(id)) {
        controller.abort(new Error(reason));
      }
    }
  }

  function armStragglerTimer() {
    if (stragglerTimer) clearTimeout(stragglerTimer);
    stragglerTimer = setTimeout(() => {
      abortPending("straggler timeout");
    }, stragglerTimeoutMs);
  }

  function onTaskComplete(id, result) {
    results.set(id, result);
    controllers.delete(id);

    if (result.status === "success") {
      hasSuccess = true;
    }

    const hasPending = tasks.some((t) => !results.has(t.id));
    if (hasSuccess && hasPending) {
      armStragglerTimer();
    }
  }

  function cleanup() {
    if (stragglerTimer) clearTimeout(stragglerTimer);
    if (globalTimer) clearTimeout(globalTimer);
  }

  async function executeTask(task) {
    const controller = new AbortController();
    controllers.set(task.id, controller);
    const start = Date.now();

    try {
      const value = await task.run(controller.signal);
      const result = {
        id: task.id,
        status: "success",
        value,
        error: null,
        durationMs: Date.now() - start
      };
      onTaskComplete(task.id, result);
    } catch (error) {
      const isAbort = error.name === "AbortError" || controller.signal.aborted;
      const result = {
        id: task.id,
        status: isAbort ? "timeout" : "error",
        value: null,
        error: error.message ?? String(error),
        durationMs: Date.now() - start
      };
      onTaskComplete(task.id, result);
    }
  }

  return new Promise((resolve) => {
    globalTimer = setTimeout(() => {
      abortPending("global timeout");
    }, globalTimeoutMs);

    let nextIndex = 0;
    let active = 0;

    function tryNext() {
      while (active < concurrency && nextIndex < tasks.length) {
        const task = tasks[nextIndex++];
        active++;
        executeTask(task).then(() => {
          active--;
          if (results.size === tasks.length) {
            cleanup();
            resolve(tasks.map((t) => results.get(t.id)));
          } else {
            tryNext();
          }
        });
      }
    }

    tryNext();
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/concurrency.test.mjs`
Expected: All 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/byom-review/scripts/lib/concurrency.mjs tests/concurrency.test.mjs
git commit -m "feat: add concurrency pool with straggler and global timeout"
```

---

### Task 2: Add AbortSignal Support to ProviderClient and Review Engine

**Files:**
- Modify: `plugins/byom-review/scripts/lib/provider-client.mjs`
- Modify: `plugins/byom-review/scripts/lib/review-engine.mjs`
- Modify: `tests/provider-client.test.mjs`

- [ ] **Step 1: Add signal test to provider-client tests**

Add to `tests/provider-client.test.mjs`:

```js
test("chatCompletion passes signal to fetch (abort throws)", async () => {
  const provider = getProvider("openrouter");
  const client = new ProviderClient(provider, { apiKey: "sk-test" });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => client.chatCompletion({
      messages: [{ role: "user", content: "hi" }],
      model: "test",
      signal: controller.signal
    }),
    (error) => error.name === "AbortError" || error.message.includes("abort")
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/provider-client.test.mjs`
Expected: New test fails — `signal` not accepted/passed.

- [ ] **Step 3: Add signal parameter to ProviderClient.chatCompletion**

In `plugins/byom-review/scripts/lib/provider-client.mjs`, update `chatCompletion` signature and `fetch` call.

Change line 16:
```js
  async chatCompletion({ messages, model, responseFormat, temperature, maxTokens }) {
```
to:
```js
  async chatCompletion({ messages, model, responseFormat, temperature, maxTokens, signal }) {
```

Change the `fetch` call (around line 44) to include `signal`:
```js
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal
    });
```

- [ ] **Step 4: Pass signal through in review-engine.mjs**

In `plugins/byom-review/scripts/lib/review-engine.mjs`, update `runReview` to accept and pass `signal`.

Change line 66:
```js
export async function runReview({ client, gitContext, systemPrompt, schema, model, useJsonSchema = true }) {
```
to:
```js
export async function runReview({ client, gitContext, systemPrompt, schema, model, useJsonSchema = true, signal }) {
```

Update the `client.chatCompletion` call (around line 96) to pass `signal`:
```js
    result = await client.chatCompletion({
      messages,
      model,
      responseFormat,
      signal
    });
```

Update the recursive fallback calls (lines 103 and 109) to also pass `signal`:
```js
      return runReview({ client, gitContext, systemPrompt, schema, model, useJsonSchema: false, signal });
```

- [ ] **Step 5: Run all tests**

Run: `node --test tests/*.test.mjs`
Expected: All tests pass (including the new signal test).

- [ ] **Step 6: Commit**

```bash
git add plugins/byom-review/scripts/lib/provider-client.mjs plugins/byom-review/scripts/lib/review-engine.mjs tests/provider-client.test.mjs
git commit -m "feat: add AbortSignal support to ProviderClient and review engine"
```

---

### Task 3: Add Multi-Model Render Function

**Files:**
- Modify: `plugins/byom-review/scripts/lib/render.mjs`
- Create: `tests/multi-model.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/multi-model.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";

import { renderMultiModelResult } from "../plugins/byom-review/scripts/lib/render.mjs";

test("renderMultiModelResult renders successful models", () => {
  const data = {
    reviewLabel: "Review",
    targetLabel: "branch diff against main",
    models: [
      {
        model: "anthropic/claude-sonnet-4",
        status: "success",
        review: { verdict: "approve", summary: "LGTM", findings: [], next_steps: [] },
        usage: { prompt_tokens: 1000, completion_tokens: 500 },
        durationMs: 3000
      },
      {
        model: "openai/gpt-4o",
        status: "success",
        review: { verdict: "needs-attention", summary: "Found issues", findings: [{ severity: "high", title: "Bug" }], next_steps: [] },
        usage: { prompt_tokens: 1200, completion_tokens: 600, cost: 0.005 },
        durationMs: 5000
      }
    ],
    aggregate: { requested: 2, completed: 2, failed: 0, totalDurationMs: 5000 }
  };
  const output = renderMultiModelResult(data);
  assert.ok(output.includes("Review — branch diff against main"));
  assert.ok(output.includes("Model: anthropic/claude-sonnet-4"));
  assert.ok(output.includes("Model: openai/gpt-4o"));
  assert.ok(output.includes("Verdict: approve"));
  assert.ok(output.includes("Verdict: needs-attention"));
  assert.ok(output.includes("Duration: 3.0s"));
  assert.ok(output.includes("Multi-Model Summary"));
  assert.ok(output.includes("Models: 2 requested, 2 completed, 0 failed"));
});

test("renderMultiModelResult renders failed models section", () => {
  const data = {
    reviewLabel: "Review",
    targetLabel: "working tree diff",
    models: [
      {
        model: "openai/gpt-4o",
        status: "success",
        review: { verdict: "approve", summary: "OK", findings: [], next_steps: [] },
        usage: { prompt_tokens: 100, completion_tokens: 50 },
        durationMs: 2000
      },
      {
        model: "google/gemini-2.0-flash",
        status: "timeout",
        review: null,
        error: "straggler timeout",
        usage: null,
        durationMs: 62000
      }
    ],
    aggregate: { requested: 2, completed: 1, failed: 1, totalDurationMs: 62000 }
  };
  const output = renderMultiModelResult(data);
  assert.ok(output.includes("Failed Models:"));
  assert.ok(output.includes("✗ google/gemini-2.0-flash"));
  assert.ok(output.includes("Models: 2 requested, 1 completed, 1 failed"));
});

test("renderMultiModelResult renders error status", () => {
  const data = {
    reviewLabel: "Review",
    targetLabel: "test",
    models: [
      {
        model: "bad/model",
        status: "error",
        review: null,
        error: "API error (404)",
        usage: null,
        durationMs: 500
      }
    ],
    aggregate: { requested: 1, completed: 0, failed: 1, totalDurationMs: 500 }
  };
  const output = renderMultiModelResult(data);
  assert.ok(output.includes("Failed Models:"));
  assert.ok(output.includes("✗ bad/model — API error (404)"));
});

test("renderMultiModelResult renders total cost when available", () => {
  const data = {
    reviewLabel: "Review",
    targetLabel: "test",
    models: [
      {
        model: "a",
        status: "success",
        review: { verdict: "approve", summary: "OK", findings: [], next_steps: [] },
        usage: { prompt_tokens: 100, completion_tokens: 50, cost: 0.003 },
        durationMs: 1000
      },
      {
        model: "b",
        status: "success",
        review: { verdict: "approve", summary: "Fine", findings: [], next_steps: [] },
        usage: { prompt_tokens: 200, completion_tokens: 100, cost: 0.005 },
        durationMs: 2000
      }
    ],
    aggregate: { requested: 2, completed: 2, failed: 0, totalCost: 0.008, totalDurationMs: 2000 }
  };
  const output = renderMultiModelResult(data);
  assert.ok(output.includes("Total cost: $0.008000"));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/multi-model.test.mjs`
Expected: Fails — `renderMultiModelResult` not exported.

- [ ] **Step 3: Implement renderMultiModelResult**

Add to the bottom of `plugins/byom-review/scripts/lib/render.mjs`:

```js
export function renderMultiModelResult(data) {
  const lines = [];
  const successModels = data.models.filter((m) => m.status === "success");
  const failedModels = data.models.filter((m) => m.status !== "success");

  for (const entry of successModels) {
    lines.push(`${data.reviewLabel} — ${data.targetLabel}`);
    lines.push(`Model: ${entry.model}`);
    lines.push("─────────────────────");

    const result = entry.review;
    let verdict = result.verdict;
    let verdictInferred = false;
    if (!verdict) {
      verdictInferred = true;
      verdict = "needs-attention";
    }
    lines.push(`Verdict: ${verdict}${verdictInferred ? " (inferred)" : ""}`);
    lines.push("");
    lines.push(`Summary: ${result.summary}`);

    if (result.findings?.length > 0) {
      lines.push("");
      lines.push(`Findings (${result.findings.length}):`);
      for (const finding of result.findings) {
        lines.push("");
        const severity = (finding.severity ?? "unknown").toUpperCase();
        lines.push(`  [${severity}] ${finding.title ?? "Untitled finding"}`);
        if (finding.file) {
          lines.push(`  File: ${finding.file}:${finding.line_start ?? "?"}-${finding.line_end ?? "?"}`);
        }
        if (finding.confidence != null) {
          lines.push(`  Confidence: ${finding.confidence}`);
        }
        if (finding.body) {
          lines.push(`  ${finding.body}`);
        }
        if (finding.recommendation) {
          lines.push(`  → ${finding.recommendation}`);
        }
      }
    }

    if (result.next_steps?.length > 0) {
      lines.push("");
      lines.push("Next steps:");
      for (const step of result.next_steps) {
        lines.push(`  • ${step}`);
      }
    }

    if (entry.usage) {
      lines.push("");
      lines.push(`Tokens: ${entry.usage.prompt_tokens ?? "?"} prompt, ${entry.usage.completion_tokens ?? "?"} completion`);
      if (entry.usage.cost != null) {
        lines.push(`Cost: $${entry.usage.cost.toFixed(6)}`);
      }
    }

    lines.push(`Duration: ${(entry.durationMs / 1000).toFixed(1)}s`);
    lines.push("");
  }

  if (failedModels.length > 0) {
    lines.push("─────────────────────");
    lines.push("Failed Models:");
    for (const entry of failedModels) {
      lines.push(`  ✗ ${entry.model} — ${entry.error || entry.status}`);
    }
    lines.push("");
  }

  lines.push("─────────────────────");
  lines.push("Multi-Model Summary:");
  lines.push(`  Models: ${data.aggregate.requested} requested, ${data.aggregate.completed} completed, ${data.aggregate.failed} failed`);
  if (data.aggregate.totalCost != null) {
    lines.push(`  Total cost: $${data.aggregate.totalCost.toFixed(6)}`);
  }
  lines.push(`  Total duration: ${(data.aggregate.totalDurationMs / 1000).toFixed(1)}s`);
  lines.push("");

  return lines.join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/multi-model.test.mjs`
Expected: All 4 tests pass.

- [ ] **Step 5: Run full test suite**

Run: `node --test tests/*.test.mjs`
Expected: All tests pass (existing render tests unaffected).

- [ ] **Step 6: Commit**

```bash
git add plugins/byom-review/scripts/lib/render.mjs tests/multi-model.test.mjs
git commit -m "feat: add renderMultiModelResult for multi-model comparison output"
```

---

### Task 4: Implement Multi-Model Review in Companion Script

**Files:**
- Modify: `plugins/byom-review/scripts/byom-companion.mjs`

- [ ] **Step 1: Add imports**

At line 12, add the concurrency import:
```js
import { asyncPool } from "./lib/concurrency.mjs";
```

Update the render import at line 13:
```js
import { renderReviewResult, renderMultiModelResult } from "./lib/render.mjs";
```

- [ ] **Step 2: Add --models validation function**

Add after the `ensureProviderReady` function (after line 84):

```js
function parseModelsFlag(value) {
  const models = value.split(",").map((m) => m.trim()).filter(Boolean);
  const unique = [...new Set(models)];
  if (unique.length < 2) {
    throw new Error("--models requires at least 2 models for comparison.");
  }
  if (unique.length > 5) {
    throw new Error(`Maximum 5 models allowed for comparison. You provided ${unique.length}.`);
  }
  return unique;
}
```

- [ ] **Step 3: Add executeMultiModelReview function**

Add after `executeReviewRun` (after line 260):

```js
async function executeMultiModelReview(request) {
  const provider = request.provider;
  ensureProviderReady(provider);
  ensureGitRepository(request.cwd);

  const target = resolveReviewTarget(request.cwd, {
    base: request.base,
    scope: request.scope
  });

  const context = collectReviewContext(request.cwd, target);
  const schema = readOutputSchema(REVIEW_SCHEMA_PATH);
  const systemPrompt = buildStandardReviewPrompt(context);

  const stragglerTimeoutMs = Number(process.env.BYOM_STRAGGLER_TIMEOUT_MS) || 60000;
  const globalTimeoutMs = Number(process.env.BYOM_GLOBAL_TIMEOUT_MS) || 300000;

  const tasks = request.models.map((model) => ({
    id: model,
    run: async (signal) => {
      const client = new ProviderClient(provider, {
        defaultModel: model
      });
      return runReview({
        client,
        gitContext: context,
        systemPrompt,
        schema,
        model,
        signal
      });
    }
  }));

  const poolResults = await asyncPool(tasks, {
    concurrency: 3,
    stragglerTimeoutMs,
    globalTimeoutMs
  });

  const modelResults = poolResults.map((r) => {
    if (r.status === "success") {
      const reviewResult = r.value;
      return {
        model: r.id,
        status: "success",
        review: reviewResult.result.parsed,
        usage: reviewResult.usage,
        durationMs: r.durationMs
      };
    }
    return {
      model: r.id,
      status: r.status,
      review: null,
      error: r.error,
      usage: null,
      durationMs: r.durationMs
    };
  });

  modelResults.sort((a, b) => a.model.localeCompare(b.model, undefined, { sensitivity: "base" }));

  const completed = modelResults.filter((m) => m.status === "success").length;
  const failed = modelResults.length - completed;
  const totalCost = modelResults.reduce((sum, m) => sum + (m.usage?.cost ?? 0), 0);
  const totalDurationMs = Math.max(...modelResults.map((m) => m.durationMs));

  const aggregate = {
    requested: modelResults.length,
    completed,
    failed,
    totalCost: totalCost > 0 ? totalCost : null,
    totalDurationMs
  };

  const payload = {
    review: "Review",
    target,
    context: {
      repoRoot: context.repoRoot,
      branch: context.branch,
      summary: context.summary
    },
    models: modelResults,
    aggregate
  };

  const rendered = renderMultiModelResult({
    reviewLabel: "Review",
    targetLabel: target.label,
    models: modelResults,
    aggregate
  });

  return {
    exitStatus: completed > 0 ? 0 : 1,
    payload,
    rendered
  };
}
```

- [ ] **Step 4: Update handleReview to dispatch multi-model when --models is present**

Replace the `--models` guard and the rest of `handleReview` (lines 272-294):

```js
  if (options.models && options.model) {
    throw new Error("Cannot use --model and --models together. Use --models for multi-model comparison.");
  }

  if (options.models) {
    if (reviewName === "Adversarial Review") {
      throw new Error("--models is not supported for adversarial reviews yet.");
    }
    const models = parseModelsFlag(options.models);
    const provider = resolveProvider({ provider: options.provider });
    const cwd = resolveCommandCwd(options);

    const execution = await executeMultiModelReview({
      cwd,
      base: options.base,
      scope: options.scope,
      models,
      provider
    });

    outputResult(options.json ? execution.payload : execution.rendered, options.json);
    if (execution.exitStatus !== 0) {
      process.exitCode = execution.exitStatus;
    }
    return;
  }

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
```

- [ ] **Step 5: Update printUsage to show --models**

Update the review usage line (line 26) to include `--models`:
```js
      "  node scripts/byom-companion.mjs review [--provider <name>] [--model <id>] [--models <id,id,...>] [--base <ref>] [--scope <auto|working-tree|branch>]",
```

- [ ] **Step 6: Run all tests**

Run: `node --test tests/*.test.mjs`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add plugins/byom-review/scripts/byom-companion.mjs
git commit -m "feat: implement multi-model review with --models flag"
```

---

### Task 5: Update Slash Commands for Multi-Model

**Files:**
- Modify: `plugins/byom-review/commands/review.md`
- Modify: `plugins/byom-review/commands/adversarial-review.md`

- [ ] **Step 1: Update review.md**

Update the argument-hint (line 3):
```
argument-hint: '[--provider <name>] [--model <id>] [--models <id,id,...>] [--base <ref>] [--scope auto|working-tree|branch]'
```

Add after the "Argument handling" section (after line 38), a new section:

```markdown

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
```

- [ ] **Step 2: Update adversarial-review.md**

Add after the "Argument handling" section (after line 42):

```markdown

Multi-model mode:
- `--models` is not supported for adversarial reviews. If present, the companion will return an error.
```

- [ ] **Step 3: Commit**

```bash
git add plugins/byom-review/commands/review.md plugins/byom-review/commands/adversarial-review.md
git commit -m "feat: document --models flag in review commands"
```

---

### Task 6: Final Verification

- [ ] **Step 1: Run the full test suite**

Run: `node --test tests/*.test.mjs`
Expected: All tests pass.

- [ ] **Step 2: Test argument validation**

```bash
# --model and --models together
node plugins/byom-review/scripts/byom-companion.mjs review --model foo --models foo,bar --base main
# Expected: "Cannot use --model and --models together."

# Fewer than 2 models
node plugins/byom-review/scripts/byom-companion.mjs review --models single-model --base main
# Expected: "--models requires at least 2 models for comparison."

# More than 5 models
node plugins/byom-review/scripts/byom-companion.mjs review --models a,b,c,d,e,f --base main
# Expected: "Maximum 5 models allowed for comparison. You provided 6."

# --models on adversarial-review
node plugins/byom-review/scripts/byom-companion.mjs adversarial-review --models foo,bar --base main
# Expected: "--models is not supported for adversarial reviews yet."
```

- [ ] **Step 3: Test multi-model review end-to-end (requires API key)**

```bash
node plugins/byom-review/scripts/byom-companion.mjs review --models openai/gpt-4o,anthropic/claude-sonnet-4 --base main
```
Expected: Individual reviews per model, failed models section (if any), aggregate summary.

- [ ] **Step 4: Verify no references to old --models guard remain**

Run: `grep -n "not yet implemented" plugins/byom-review/scripts/byom-companion.mjs`
Expected: No matches.
