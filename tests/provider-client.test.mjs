import test from "node:test";
import assert from "node:assert/strict";

import { ProviderClient } from "../plugins/byom-review/scripts/lib/provider-client.mjs";
import { getProvider } from "../plugins/byom-review/scripts/lib/providers.mjs";

test("ProviderClient uses provider config for defaults", () => {
  const provider = getProvider("openrouter");
  const client = new ProviderClient(provider, { apiKey: "sk-test" });
  assert.equal(client.apiKey, "sk-test");
  assert.equal(client.baseUrl, "https://openrouter.ai/api/v1");
  assert.ok(client.isConfigured);
});

test("ProviderClient reads API key from provider env var", () => {
  const provider = getProvider("baseten");
  const orig = process.env.BASETEN_API_KEY;
  process.env.BASETEN_API_KEY = "bt-test-key";
  try {
    const client = new ProviderClient(provider);
    assert.equal(client.apiKey, "bt-test-key");
    assert.equal(client.baseUrl, "https://inference.baseten.co/v1");
    assert.ok(client.isConfigured);
  } finally {
    if (orig) {
      process.env.BASETEN_API_KEY = orig;
    } else {
      delete process.env.BASETEN_API_KEY;
    }
  }
});

test("ProviderClient reads base URL override from provider env var", () => {
  const provider = getProvider("openrouter");
  const orig = process.env.OPENROUTER_BASE_URL;
  process.env.OPENROUTER_BASE_URL = "https://custom.openrouter/v1";
  try {
    const client = new ProviderClient(provider, { apiKey: "sk-test" });
    assert.equal(client.baseUrl, "https://custom.openrouter/v1");
  } finally {
    if (orig) {
      process.env.OPENROUTER_BASE_URL = orig;
    } else {
      delete process.env.OPENROUTER_BASE_URL;
    }
  }
});

test("ProviderClient reports not configured when no key", () => {
  const provider = getProvider("openrouter");
  const orig = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    const client = new ProviderClient(provider, { apiKey: "" });
    assert.ok(!client.isConfigured);
  } finally {
    if (orig) {
      process.env.OPENROUTER_API_KEY = orig;
    }
  }
});

test("ProviderClient accepts explicit baseUrl override", () => {
  const provider = getProvider("baseten");
  const client = new ProviderClient(provider, {
    apiKey: "bt-key",
    baseUrl: "https://override.example/v1"
  });
  assert.equal(client.baseUrl, "https://override.example/v1");
});

test("chatCompletion throws with provider-specific error when no API key", async () => {
  const provider = getProvider("baseten");
  const orig = process.env.BASETEN_API_KEY;
  delete process.env.BASETEN_API_KEY;
  try {
    const client = new ProviderClient(provider, { apiKey: "" });
    await assert.rejects(
      () => client.chatCompletion({ messages: [{ role: "user", content: "hi" }] }),
      /BASETEN_API_KEY is not set/
    );
  } finally {
    if (orig) {
      process.env.BASETEN_API_KEY = orig;
    }
  }
});

test("chatCompletion throws with provider-specific error for openrouter", async () => {
  const provider = getProvider("openrouter");
  const orig = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    const client = new ProviderClient(provider, { apiKey: "" });
    await assert.rejects(
      () => client.chatCompletion({ messages: [{ role: "user", content: "hi" }] }),
      /OPENROUTER_API_KEY is not set/
    );
  } finally {
    if (orig) {
      process.env.OPENROUTER_API_KEY = orig;
    }
  }
});

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
