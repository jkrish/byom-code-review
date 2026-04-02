import test from "node:test";
import assert from "node:assert/strict";

import { getProvider, listProviders, resolveProvider } from "../plugins/byom-review/scripts/lib/providers.mjs";

test("getProvider returns openrouter config", () => {
  const p = getProvider("openrouter");
  assert.equal(p.name, "openrouter");
  assert.equal(p.label, "OpenRouter");
  assert.equal(p.baseUrl, "https://openrouter.ai/api/v1");
  assert.equal(p.apiKeyEnv, "OPENROUTER_API_KEY");
  assert.equal(typeof p.authHeader, "function");
  assert.equal(p.authHeader("sk-123"), "Bearer sk-123");
  assert.ok(p.extraHeaders["HTTP-Referer"]);
  assert.ok(p.extraHeaders["X-Title"]);
});

test("getProvider returns baseten config", () => {
  const p = getProvider("baseten");
  assert.equal(p.name, "baseten");
  assert.equal(p.label, "Baseten");
  assert.equal(p.baseUrl, "https://inference.baseten.co/v1");
  assert.equal(p.apiKeyEnv, "BASETEN_API_KEY");
  assert.equal(p.authHeader("bt-key"), "Api-Key bt-key");
});

test("getProvider returns custom config", () => {
  const p = getProvider("custom");
  assert.equal(p.name, "custom");
  assert.equal(p.apiKeyEnv, "BYOM_CUSTOM_API_KEY");
  assert.equal(p.baseUrlEnv, "BYOM_CUSTOM_BASE_URL");
  assert.equal(p.authHeader("ck"), "Bearer ck");
});

test("getProvider throws for unknown provider", () => {
  assert.throws(
    () => getProvider("foobar"),
    /Unknown provider: foobar\. Available: openrouter, baseten, custom/
  );
});

test("listProviders returns all three providers", () => {
  const all = listProviders();
  const names = all.map((p) => p.name);
  assert.deepEqual(names, ["openrouter", "baseten", "custom"]);
});

test("resolveProvider uses explicit provider option first", () => {
  const p = resolveProvider({ provider: "baseten" });
  assert.equal(p.name, "baseten");
});

test("resolveProvider falls back to BYOM_DEFAULT_PROVIDER env", () => {
  const orig = process.env.BYOM_DEFAULT_PROVIDER;
  process.env.BYOM_DEFAULT_PROVIDER = "baseten";
  try {
    const p = resolveProvider({});
    assert.equal(p.name, "baseten");
  } finally {
    if (orig) {
      process.env.BYOM_DEFAULT_PROVIDER = orig;
    } else {
      delete process.env.BYOM_DEFAULT_PROVIDER;
    }
  }
});

test("resolveProvider defaults to openrouter", () => {
  const orig = process.env.BYOM_DEFAULT_PROVIDER;
  delete process.env.BYOM_DEFAULT_PROVIDER;
  try {
    const p = resolveProvider({});
    assert.equal(p.name, "openrouter");
  } finally {
    if (orig) {
      process.env.BYOM_DEFAULT_PROVIDER = orig;
    } else {
      delete process.env.BYOM_DEFAULT_PROVIDER;
    }
  }
});

test("resolveProvider throws for unknown provider in option", () => {
  assert.throws(
    () => resolveProvider({ provider: "nope" }),
    /Unknown provider: nope/
  );
});
