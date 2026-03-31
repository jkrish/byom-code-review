import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderReviewResult } from "./render.mjs";

const defaults = { reviewLabel: "Review", targetLabel: "test", model: "test/model", usage: null };

describe("renderReviewResult", () => {
  it("renders a complete review with all fields", () => {
    const parsed = {
      parsed: {
        verdict: "approve",
        summary: "Looks good",
        findings: [],
        next_steps: [],
      },
      parseError: null,
    };
    const output = renderReviewResult(parsed, defaults);
    assert.ok(output.includes("Verdict: approve"));
    assert.ok(!output.includes("(inferred)"));
    assert.ok(output.includes("Summary: Looks good"));
  });

  it("infers needs-attention when verdict is missing", () => {
    const parsed = {
      parsed: { summary: "Some summary", findings: [], next_steps: [] },
      parseError: null,
    };
    const output = renderReviewResult(parsed, defaults);
    assert.ok(output.includes("Verdict: needs-attention (inferred)"));
  });

  it("infers needs-attention when verdict is empty string", () => {
    const parsed = {
      parsed: { verdict: "", summary: "Summary", findings: [], next_steps: [] },
      parseError: null,
    };
    const output = renderReviewResult(parsed, defaults);
    assert.ok(output.includes("Verdict: needs-attention (inferred)"));
  });

  it("handles finding with all fields missing", () => {
    const parsed = {
      parsed: {
        verdict: "needs-attention",
        summary: "Issues found",
        findings: [{}],
        next_steps: [],
      },
      parseError: null,
    };
    const output = renderReviewResult(parsed, defaults);
    assert.ok(output.includes("[UNKNOWN] Untitled finding"));
    assert.ok(!output.includes("File:"));
    assert.ok(!output.includes("Confidence:"));
  });

  it("handles finding with null severity", () => {
    const parsed = {
      parsed: {
        verdict: "needs-attention",
        summary: "Issues",
        findings: [{ severity: null, title: "Bug" }],
        next_steps: [],
      },
      parseError: null,
    };
    const output = renderReviewResult(parsed, defaults);
    assert.ok(output.includes("[UNKNOWN] Bug"));
  });

  it("handles finding with missing body", () => {
    const parsed = {
      parsed: {
        verdict: "needs-attention",
        summary: "Issues",
        findings: [{ severity: "high", title: "Bug", file: "a.js", line_start: 1, line_end: 5, confidence: 0.9 }],
        next_steps: [],
      },
      parseError: null,
    };
    const output = renderReviewResult(parsed, defaults);
    assert.ok(output.includes("[HIGH] Bug"));
    assert.ok(output.includes("File: a.js:1-5"));
    assert.ok(output.includes("Confidence: 0.9"));
    assert.ok(!output.includes("undefined"));
  });

  it("handles finding with missing file", () => {
    const parsed = {
      parsed: {
        verdict: "needs-attention",
        summary: "Issues",
        findings: [{ severity: "medium", title: "Issue", body: "Details here" }],
        next_steps: [],
      },
      parseError: null,
    };
    const output = renderReviewResult(parsed, defaults);
    assert.ok(output.includes("[MEDIUM] Issue"));
    assert.ok(!output.includes("File:"));
    assert.ok(output.includes("Details here"));
  });

  it("handles finding with file but missing line numbers", () => {
    const parsed = {
      parsed: {
        verdict: "needs-attention",
        summary: "Issues",
        findings: [{ severity: "low", title: "Issue", file: "b.js" }],
        next_steps: [],
      },
      parseError: null,
    };
    const output = renderReviewResult(parsed, defaults);
    assert.ok(output.includes("File: b.js:?-?"));
  });

  it("renders cost when present in usage", () => {
    const parsed = {
      parsed: { verdict: "approve", summary: "OK", findings: [], next_steps: [] },
      parseError: null,
    };
    const usage = { prompt_tokens: 100, completion_tokens: 50, cost: 0.001234 };
    const output = renderReviewResult(parsed, { ...defaults, usage });
    assert.ok(output.includes("Tokens: 100 prompt, 50 completion"));
    assert.ok(output.includes("Cost: $0.001234"));
  });

  it("omits cost line when cost is not in usage", () => {
    const parsed = {
      parsed: { verdict: "approve", summary: "OK", findings: [], next_steps: [] },
      parseError: null,
    };
    const usage = { prompt_tokens: 100, completion_tokens: 50 };
    const output = renderReviewResult(parsed, { ...defaults, usage });
    assert.ok(output.includes("Tokens: 100 prompt, 50 completion"));
    assert.ok(!output.includes("Cost:"));
  });

  it("renders parse error", () => {
    const parsed = { parsed: null, parseError: "bad json", rawOutput: "{broken" };
    const output = renderReviewResult(parsed, defaults);
    assert.ok(output.includes("⚠ Failed to parse structured output: bad json"));
    assert.ok(output.includes("{broken"));
  });

  it("no undefined appears anywhere in output for sparse findings", () => {
    const parsed = {
      parsed: {
        summary: "Review",
        findings: [
          {},
          { severity: null, title: null, file: null, body: null, confidence: null, recommendation: null },
        ],
        next_steps: [],
      },
      parseError: null,
    };
    const output = renderReviewResult(parsed, defaults);
    assert.ok(!output.includes("undefined"), `Output should not contain 'undefined': ${output}`);
  });
});
