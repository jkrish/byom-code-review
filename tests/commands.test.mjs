import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const PLUGIN_ROOT = path.join(ROOT, "plugins", "byom-review");

function read(relativePath) {
  return fs.readFileSync(path.join(PLUGIN_ROOT, relativePath), "utf8");
}

test("review command uses AskUserQuestion and background Bash while staying review-only", () => {
  const source = read("commands/review.md");
  assert.match(source, /AskUserQuestion/);
  assert.match(source, /\bBash\(/);
  assert.match(source, /Do not fix issues/i);
  assert.match(source, /review-only/i);
  assert.match(source, /return the output verbatim to the user/i);
  assert.match(source, /```bash/);
  assert.match(source, /```typescript/);
  assert.match(source, /byom-companion\.mjs" review/);
  assert.match(source, /\[--scope auto\|working-tree\|branch\]/);
  assert.match(source, /run_in_background:\s*true/);
  assert.match(source, /Return the command stdout verbatim, exactly as-is/i);
  assert.match(source, /git status --short --untracked-files=all/);
  assert.match(source, /git diff --shortstat/);
  assert.match(source, /When in doubt, run the review/i);
  assert.match(source, /\(Recommended\)/);
  assert.match(source, /OpenRouter/i);
});

test("adversarial review command uses AskUserQuestion and background Bash while staying review-only", () => {
  const source = read("commands/adversarial-review.md");
  assert.match(source, /AskUserQuestion/);
  assert.match(source, /\bBash\(/);
  assert.match(source, /Do not fix issues/i);
  assert.match(source, /review-only/i);
  assert.match(source, /return the output verbatim to the user/i);
  assert.match(source, /```bash/);
  assert.match(source, /```typescript/);
  assert.match(source, /byom-companion\.mjs" adversarial-review/);
  assert.match(source, /\[--scope auto\|working-tree\|branch\] \[focus \.\.\.\]/);
  assert.match(source, /run_in_background:\s*true/);
  assert.match(source, /Return the command stdout verbatim, exactly as-is/i);
  assert.match(source, /git status --short --untracked-files=all/);
  assert.match(source, /When in doubt, run the review/i);
  assert.match(source, /\(Recommended\)/);
  assert.match(source, /OpenRouter/i);
  assert.match(source, /can take extra focus text after the flags/i);
});

test("only review commands are exposed", () => {
  const commandFiles = fs.readdirSync(path.join(PLUGIN_ROOT, "commands")).sort();
  assert.deepEqual(commandFiles, [
    "adversarial-review.md",
    "review.md",
    "setup.md"
  ]);
});

test("setup command references OpenRouter API key", () => {
  const setup = read("commands/setup.md");
  assert.match(setup, /OPENROUTER_API_KEY/);
  assert.match(setup, /byom-companion\.mjs" setup --json/);
  assert.match(setup, /openrouter\.ai\/keys/);
  assert.match(setup, /BYOM_DEFAULT_MODEL/);
});

test("hooks are configured for session lifecycle only", () => {
  const source = read("hooks/hooks.json");
  assert.match(source, /SessionStart/);
  assert.match(source, /SessionEnd/);
  assert.match(source, /session-lifecycle-hook\.mjs/);
  assert.doesNotMatch(source, /stop-review-gate/);
});

test("plugin manifest has correct name and description", () => {
  const plugin = JSON.parse(read(".claude-plugin/plugin.json"));
  assert.equal(plugin.name, "byom-review");
  assert.match(plugin.description, /OpenRouter/i);
});

test("review output schema has required fields", () => {
  const schema = JSON.parse(read("schemas/review-output.schema.json"));
  assert.deepEqual(schema.required, ["verdict", "summary", "findings", "next_steps"]);
  assert.deepEqual(schema.properties.verdict.enum, ["approve", "needs-attention"]);
  assert.equal(schema.properties.findings.type, "array");
});

test("adversarial review prompt template has required placeholders", () => {
  const template = read("prompts/adversarial-review.md");
  assert.match(template, /\{\{TARGET_LABEL\}\}/);
  assert.match(template, /\{\{USER_FOCUS\}\}/);
  assert.match(template, /\{\{REVIEW_INPUT\}\}/);
  assert.match(template, /adversarial/i);
  assert.doesNotMatch(template, /Codex/);
});

test("standard review prompt template has required placeholders", () => {
  const template = read("prompts/code-review.md");
  assert.match(template, /\{\{TARGET_LABEL\}\}/);
  assert.match(template, /\{\{REVIEW_INPUT\}\}/);
  assert.match(template, /code review/i);
});
