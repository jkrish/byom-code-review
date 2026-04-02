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
