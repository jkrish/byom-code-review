#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseArgs, splitRawArgumentString } from "./lib/args.mjs";
import { collectReviewContext, ensureGitRepository, resolveReviewTarget } from "./lib/git.mjs";
import { loadPromptTemplate, interpolateTemplate } from "./lib/prompts.mjs";
import { OpenRouterClient, API_KEY_ENV, DEFAULT_MODEL_ENV, DEFAULT_MODEL } from "./lib/openrouter.mjs";
import { readOutputSchema, runReview } from "./lib/review-engine.mjs";

const ROOT_DIR = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const REVIEW_SCHEMA_PATH = path.join(ROOT_DIR, "schemas", "review-output.schema.json");

function printUsage() {
  console.log(
    [
      "Usage:",
      "  node scripts/byom-companion.mjs setup [--json]",
      "  node scripts/byom-companion.mjs review [--model <id>] [--base <ref>] [--scope <auto|working-tree|branch>]",
      "  node scripts/byom-companion.mjs adversarial-review [--model <id>] [--base <ref>] [--scope <auto|working-tree|branch>] [focus text]"
    ].join("\n")
  );
}

function outputResult(value, asJson) {
  if (asJson) {
    console.log(JSON.stringify(value, null, 2));
  } else {
    process.stdout.write(typeof value === "string" ? value : JSON.stringify(value, null, 2));
  }
}

function normalizeArgv(argv) {
  if (argv.length === 1) {
    const [raw] = argv;
    if (!raw || !raw.trim()) {
      return [];
    }
    return splitRawArgumentString(raw);
  }
  return argv;
}

function parseCommandInput(argv, config = {}) {
  return parseArgs(normalizeArgv(argv), {
    ...config,
    aliasMap: {
      C: "cwd",
      ...(config.aliasMap ?? {})
    }
  });
}

function resolveCommandCwd(options = {}) {
  return options.cwd ? path.resolve(process.cwd(), options.cwd) : process.cwd();
}

function firstMeaningfulLine(text, fallback) {
  const line = String(text ?? "")
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find(Boolean);
  return line ?? fallback;
}

function ensureApiKeyReady() {
  if (!process.env[API_KEY_ENV]) {
    throw new Error(
      `${API_KEY_ENV} is not set. Get an API key at https://openrouter.ai/keys and export it in your environment.`
    );
  }
}

function buildSetupReport() {
  const apiKey = process.env[API_KEY_ENV] ?? "";
  const defaultModel = process.env[DEFAULT_MODEL_ENV] || DEFAULT_MODEL;
  const hasKey = Boolean(apiKey);

  const nextSteps = [];
  if (!hasKey) {
    nextSteps.push(`Set ${API_KEY_ENV} with your OpenRouter API key from https://openrouter.ai/keys`);
  }

  return {
    ready: hasKey,
    apiKeyConfigured: hasKey,
    defaultModel,
    nextSteps
  };
}

function renderSetupReport(report) {
  const lines = [];
  lines.push(`BYOM Code Review Setup`);
  lines.push(`─────────────────────`);
  lines.push(`API Key: ${report.apiKeyConfigured ? "✓ configured" : "✗ not set"}`);
  lines.push(`Default Model: ${report.defaultModel}`);
  lines.push(`Ready: ${report.ready ? "yes" : "no"}`);
  if (report.nextSteps.length > 0) {
    lines.push("");
    lines.push("Next steps:");
    for (const step of report.nextSteps) {
      lines.push(`  • ${step}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function handleSetup(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });

  const report = buildSetupReport();
  outputResult(options.json ? report : renderSetupReport(report), options.json);
}

function buildAdversarialReviewPrompt(context, focusText) {
  const template = loadPromptTemplate(ROOT_DIR, "adversarial-review");
  return interpolateTemplate(template, {
    REVIEW_KIND: "Adversarial Review",
    TARGET_LABEL: context.target.label,
    USER_FOCUS: focusText || "No extra focus provided.",
    REVIEW_INPUT: context.content
  });
}

function buildStandardReviewPrompt(context) {
  const template = loadPromptTemplate(ROOT_DIR, "code-review");
  return interpolateTemplate(template, {
    TARGET_LABEL: context.target.label,
    REVIEW_INPUT: context.content
  });
}

function renderReviewResult(parsed, { reviewLabel, targetLabel, model, usage }) {
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
  lines.push(`Verdict: ${result.verdict}`);
  lines.push("");
  lines.push(`Summary: ${result.summary}`);

  if (result.findings?.length > 0) {
    lines.push("");
    lines.push(`Findings (${result.findings.length}):`);
    for (const finding of result.findings) {
      lines.push("");
      lines.push(`  [${finding.severity.toUpperCase()}] ${finding.title}`);
      lines.push(`  File: ${finding.file}:${finding.line_start}-${finding.line_end}`);
      lines.push(`  Confidence: ${finding.confidence}`);
      lines.push(`  ${finding.body}`);
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

async function executeReviewRun(request) {
  ensureApiKeyReady();
  ensureGitRepository(request.cwd);

  const target = resolveReviewTarget(request.cwd, {
    base: request.base,
    scope: request.scope
  });

  const context = collectReviewContext(request.cwd, target);
  const schema = readOutputSchema(REVIEW_SCHEMA_PATH);
  const client = new OpenRouterClient();

  const focusText = request.focusText?.trim() ?? "";
  const reviewName = request.reviewName ?? "Review";
  const systemPrompt =
    reviewName === "Adversarial Review"
      ? buildAdversarialReviewPrompt(context, focusText)
      : buildStandardReviewPrompt(context);

  const reviewResult = await runReview({
    client,
    gitContext: context,
    systemPrompt,
    schema,
    model: request.model
  });

  const parsed = reviewResult.result;
  const payload = {
    review: reviewName,
    target,
    context: {
      repoRoot: context.repoRoot,
      branch: context.branch,
      summary: context.summary
    },
    model: reviewResult.model,
    usage: reviewResult.usage,
    result: parsed.parsed,
    rawOutput: parsed.rawOutput,
    parseError: parsed.parseError
  };

  return {
    exitStatus: reviewResult.status,
    payload,
    rendered: renderReviewResult(parsed, {
      reviewLabel: reviewName,
      targetLabel: context.target.label,
      model: reviewResult.model,
      usage: reviewResult.usage
    }),
    summary: parsed.parsed?.summary ?? parsed.parseError ?? firstMeaningfulLine(parsed.rawOutput, `${reviewName} finished.`)
  };
}

async function handleReview(argv, reviewName = "Review") {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["base", "scope", "model", "cwd"],
    booleanOptions: ["json", "wait"],
    aliasMap: {
      m: "model"
    }
  });

  const cwd = resolveCommandCwd(options);
  const focusText = positionals.join(" ").trim();

  const execution = await executeReviewRun({
    cwd,
    base: options.base,
    scope: options.scope,
    model: options.model,
    focusText,
    reviewName
  });

  outputResult(options.json ? execution.payload : execution.rendered, options.json);
  if (execution.exitStatus !== 0) {
    process.exitCode = execution.exitStatus;
  }
}

async function main() {
  const [subcommand, ...argv] = process.argv.slice(2);
  if (!subcommand || subcommand === "help" || subcommand === "--help") {
    printUsage();
    return;
  }

  switch (subcommand) {
    case "setup":
      handleSetup(argv);
      break;
    case "review":
      await handleReview(argv, "Review");
      break;
    case "adversarial-review":
      await handleReview(argv, "Adversarial Review");
      break;
    default:
      throw new Error(`Unknown subcommand: ${subcommand}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
