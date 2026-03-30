import test from "node:test";
import assert from "node:assert/strict";

import { parseStructuredOutput } from "../plugins/byom-review/scripts/lib/review-engine.mjs";

test("parseStructuredOutput parses valid JSON", () => {
  const result = parseStructuredOutput(
    JSON.stringify({ verdict: "approve", summary: "LGTM", findings: [], next_steps: [] })
  );
  assert.equal(result.parsed.verdict, "approve");
  assert.equal(result.parseError, null);
});

test("parseStructuredOutput handles null input", () => {
  const result = parseStructuredOutput(null);
  assert.equal(result.parsed, null);
  assert.match(result.parseError, /No response received/);
});

test("parseStructuredOutput handles empty string", () => {
  const result = parseStructuredOutput("");
  assert.equal(result.parsed, null);
  assert.match(result.parseError, /No response received/);
});

test("parseStructuredOutput extracts JSON from markdown code blocks", () => {
  const raw = '```json\n{"verdict": "needs-attention", "summary": "Issues found", "findings": [], "next_steps": []}\n```';
  const result = parseStructuredOutput(raw);
  assert.equal(result.parsed.verdict, "needs-attention");
  assert.equal(result.parseError, null);
});

test("parseStructuredOutput extracts JSON with surrounding text", () => {
  const raw = 'Here is the review:\n{"verdict": "approve", "summary": "OK", "findings": [], "next_steps": []}\nEnd of review.';
  const result = parseStructuredOutput(raw);
  assert.equal(result.parsed.verdict, "approve");
  assert.equal(result.parseError, null);
});

test("parseStructuredOutput returns error for invalid JSON", () => {
  const result = parseStructuredOutput("not json at all");
  assert.equal(result.parsed, null);
  assert.ok(result.parseError);
});

test("parseStructuredOutput preserves fallback fields", () => {
  const result = parseStructuredOutput(null, { status: 1, failureMessage: "Model timeout" });
  assert.equal(result.status, 1);
  assert.match(result.parseError, /Model timeout/);
});
