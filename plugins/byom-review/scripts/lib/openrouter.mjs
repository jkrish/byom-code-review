const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "anthropic/claude-sonnet-4";
const API_KEY_ENV = "OPENROUTER_API_KEY";
const DEFAULT_MODEL_ENV = "BYOM_DEFAULT_MODEL";

export { API_KEY_ENV, DEFAULT_MODEL_ENV, DEFAULT_MODEL };

export class OpenRouterClient {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env[API_KEY_ENV] || "";
    this.baseUrl = options.baseUrl || process.env.OPENROUTER_BASE_URL || DEFAULT_BASE_URL;
    this.defaultModel = options.defaultModel || process.env[DEFAULT_MODEL_ENV] || DEFAULT_MODEL;
  }

  get isConfigured() {
    return Boolean(this.apiKey);
  }

  async chatCompletion({ messages, model, responseFormat, temperature, maxTokens }) {
    if (!this.apiKey) {
      throw new Error(
        `OPENROUTER_API_KEY is not set. Get one at https://openrouter.ai/keys and set it in your environment.`
      );
    }

    const body = {
      model: model || this.defaultModel,
      messages
    };

    if (responseFormat) {
      body.response_format = responseFormat;
    }
    if (temperature != null) {
      body.temperature = temperature;
    }
    if (maxTokens != null) {
      body.max_tokens = maxTokens;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        "HTTP-Referer": "https://github.com/jkrish/byom-code-review",
        "X-Title": "byom-code-review"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      let detail = "";
      try {
        const parsed = JSON.parse(errorBody);
        detail = parsed.error?.message || parsed.error || errorBody;
      } catch {
        detail = errorBody;
      }
      throw new Error(
        `OpenRouter API error (${response.status}): ${detail}`
      );
    }

    const data = await response.json();
    return {
      content: data.choices?.[0]?.message?.content ?? "",
      model: data.model ?? body.model,
      usage: data.usage ?? null,
      id: data.id ?? null
    };
  }

  async listModels() {
    const response = await fetch(`${this.baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "HTTP-Referer": "https://github.com/jkrish/byom-code-review",
        "X-Title": "byom-code-review"
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to list models (${response.status})`);
    }

    const data = await response.json();
    return data.data ?? [];
  }

  async validateApiKey() {
    try {
      const models = await this.listModels();
      return { valid: true, modelCount: models.length };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }
}
