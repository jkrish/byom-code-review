#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseArgs, splitRawArgumentString } from "./lib/args.mjs";
import { collectReviewContext, ensureGitRepository, resolveReviewTarget } from "./lib/git.mjs";
import { loadPromptTemplate, interpolateTemplate } from "./lib/prompts.mjs";
import { resolveProvider, listProviders } from "./lib/providers.mjs";
import { ProviderClient } from "./lib/provider-client.mjs";
import { readOutputSchema, runReview } from "./lib/review-engine.mjs";
import { renderReviewResult } from "./lib/render.mjs";

const DEFAULT_MODEL_ENV = "BYOM_DEFAULT_MODEL";
const DEFAULT_MODEL = "minimax/minimax-m2.7";

const ROOT_DIR = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const REVIEW_SCHEMA_PATH = path.join(ROOT_DIR, "schemas", "review-output.schema.json");

function printUsage() {
  console.log(
    [
      "Usage:",
      "  node scripts/byom-companion.mjs setup [--json]",
      "  node scripts/byom-companion.mjs review [--provider <name>] [--model <id>] [--base <ref>] [--scope <auto|working-tree|branch>]",
      "  node scripts/byom-companion.mjs adversarial-review [--provider <name>] [--model <id>] [--base <ref>] [--scope <auto|working-tree|branch>] [focus text]"
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

function ensureProviderReady(provider) {
  if (!process.env[provider.apiKeyEnv]) {
    throw new Error(
      `${provider.apiKeyEnv} is not set. Set it in your environment to use ${provider.label}.`
    );
  }
  if (provider.name === "custom" && !process.env[provider.baseUrlEnv]) {
    throw new Error(
      `${provider.baseUrlEnv} is required when using the custom provider.`
    );
  }
}

function buildSetupReport() {
  const providers = {};
  let anyConfigured = false;

  for (const provider of listProviders()) {
    const hasKey = Boolean(process.env[provider.apiKeyEnv]);
    const hasBaseUrl = provider.name !== "custom" || Boolean(process.env[provider.baseUrlEnv]);
    const configured = hasKey && hasBaseUrl;

    if (configured) {
      anyConfigured = true;
    }

    providers[provider.name] = {
      label: provider.label,
      configured,
      apiKeyEnv: provider.apiKeyEnv,
      ...(provider.baseUrlEnv ? { baseUrlEnv: provider.baseUrlEnv } : {})
    };

    if (provider.name === "openrouter" && configured) {
      providers[provider.name].defaultModel =
        process.env[DEFAULT_MODEL_ENV] || DEFAULT_MODEL;
    }
  }

  const defaultProvider = process.env.BYOM_DEFAULT_PROVIDER || "openrouter";
  const nextSteps = [];

  for (const [name, info] of Object.entries(providers)) {
    if (!info.configured) {
      if (name === "custom") {
        nextSteps.push(
          `To use a custom provider: export ${info.apiKeyEnv}=... and export ${info.baseUrlEnv}=...`
        );
      } else {
        nextSteps.push(`To use ${info.label}: export ${info.apiKeyEnv}=your-key-here`);
      }
    }
  }

  return {
    ready: anyConfigured,
    defaultProvider,
    providers,
    nextSteps
  };
}

function renderSetupReport(report) {
  const lines = [];
  lines.push("BYOM Code Review Setup");
  lines.push("─────────────────────");
  lines.push("Providers:");

  for (const [name, info] of Object.entries(report.providers)) {
    const status = info.configured ? "✓" : "✗";
    let detail;
    if (info.configured) {
      detail = "API key configured";
      if (info.defaultModel) {
        detail += `, default model: ${info.defaultModel}`;
      }
    } else if (name === "custom") {
      detail = `not configured (${info.apiKeyEnv} + ${info.baseUrlEnv})`;
    } else {
      detail = `API key not set (${info.apiKeyEnv})`;
    }
    lines.push(`  ${status} ${name.padEnd(14)}— ${detail}`);
  }

  lines.push("");
  lines.push(`Default provider: ${report.defaultProvider}`);
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


async function executeReviewRun(request) {
  const provider = request.provider;
  ensureProviderReady(provider);
  ensureGitRepository(request.cwd);

  const target = resolveReviewTarget(request.cwd, {
    base: request.base,
    scope: request.scope
  });

  const context = collectReviewContext(request.cwd, target);
  const schema = readOutputSchema(REVIEW_SCHEMA_PATH);
  const client = new ProviderClient(provider, {
    defaultModel: process.env[DEFAULT_MODEL_ENV] || DEFAULT_MODEL
  });

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
    valueOptions: ["base", "scope", "model", "provider", "cwd"],
    booleanOptions: ["json", "wait"],
    aliasMap: {
      m: "model",
      p: "provider"
    }
  });

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
