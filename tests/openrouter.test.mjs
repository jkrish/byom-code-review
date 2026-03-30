import test from "node:test";
import assert from "node:assert/strict";

import { OpenRouterClient, API_KEY_ENV, DEFAULT_MODEL } from "../plugins/byom-review/scripts/lib/openrouter.mjs";

test("OpenRouterClient uses environment variables for configuration", () => {
  const originalKey = process.env[API_KEY_ENV];
  process.env[API_KEY_ENV] = "test-key-123";

  try {
    const client = new OpenRouterClient();
    assert.equal(client.apiKey, "test-key-123");
    assert.equal(client.defaultModel, DEFAULT_MODEL);
    assert.ok(client.isConfigured);
  } finally {
    if (originalKey) {
      process.env[API_KEY_ENV] = originalKey;
    } else {
      delete process.env[API_KEY_ENV];
    }
  }
});

test("OpenRouterClient reports not configured when no key", () => {
  const client = new OpenRouterClient({ apiKey: "" });
  assert.ok(!client.isConfigured);
});

test("OpenRouterClient accepts constructor options", () => {
  const client = new OpenRouterClient({
    apiKey: "sk-or-test",
    baseUrl: "https://custom.endpoint/v1",
    defaultModel: "openai/gpt-4o"
  });
  assert.equal(client.apiKey, "sk-or-test");
  assert.equal(client.baseUrl, "https://custom.endpoint/v1");
  assert.equal(client.defaultModel, "openai/gpt-4o");
});

test("chatCompletion throws when no API key", async () => {
  const client = new OpenRouterClient({ apiKey: "" });
  await assert.rejects(
    () => client.chatCompletion({ messages: [{ role: "user", content: "hi" }] }),
    /OPENROUTER_API_KEY is not set/
  );
});
