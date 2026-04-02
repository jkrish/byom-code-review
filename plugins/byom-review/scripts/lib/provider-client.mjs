export class ProviderClient {
  constructor(provider, options = {}) {
    this.provider = provider;
    this.apiKey = options.apiKey || process.env[provider.apiKeyEnv] || "";
    this.baseUrl =
      options.baseUrl ||
      (provider.baseUrlEnv ? process.env[provider.baseUrlEnv] : undefined) ||
      provider.baseUrl;
    this.defaultModel = options.defaultModel || "";
  }

  get isConfigured() {
    return Boolean(this.apiKey);
  }

  async chatCompletion({ messages, model, responseFormat, temperature, maxTokens, signal }) {
    if (!this.apiKey) {
      throw new Error(
        `${this.provider.apiKeyEnv} is not set. Set it in your environment to use ${this.provider.label}.`
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

    const headers = {
      "Content-Type": "application/json",
      Authorization: this.provider.authHeader(this.apiKey),
      ...this.provider.extraHeaders
    };

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal
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
        `${this.provider.label} API error (${response.status}): ${detail}`
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
        Authorization: this.provider.authHeader(this.apiKey),
        ...this.provider.extraHeaders
      }
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`Failed to list models (${response.status})`);
    }

    const data = await response.json();
    return data.data ?? [];
  }

  async validateApiKey() {
    try {
      const models = await this.listModels();
      if (models === null) {
        return { valid: "unknown" };
      }
      return { valid: true, modelCount: models.length };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }
}
