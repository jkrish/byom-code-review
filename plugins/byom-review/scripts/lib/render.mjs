export function renderReviewResult(parsed, { reviewLabel, targetLabel, model, usage }) {
  const lines = [];
  lines.push(`${reviewLabel} — ${targetLabel}`);
  if (model) {
    lines.push(`Model: ${model}`);
  }
  lines.push(`─────────────────────`);

  if (parsed.parseError) {
    lines.push(`⚠ Failed to parse structured output: ${parsed.parseError}`);
    if (parsed.rawOutput) {
      lines.push("");
      lines.push("Raw output:");
      lines.push(parsed.rawOutput);
    }
    lines.push("");
    return lines.join("\n");
  }

  const result = parsed.parsed;
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

  if (usage) {
    lines.push("");
    lines.push(`Tokens: ${usage.prompt_tokens ?? "?"} prompt, ${usage.completion_tokens ?? "?"} completion`);
    if (usage.cost != null) {
      lines.push(`Cost: $${usage.cost.toFixed(6)}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

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
