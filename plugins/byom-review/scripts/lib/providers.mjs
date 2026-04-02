const PROVIDERS = [
  {
    name: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
    baseUrlEnv: "OPENROUTER_BASE_URL",
    authHeader: (key) => `Bearer ${key}`,
    extraHeaders: {
      "HTTP-Referer": "https://github.com/jkrish/byom-code-review",
      "X-Title": "byom-code-review"
    }
  },
  {
    name: "baseten",
    label: "Baseten",
    baseUrl: "https://inference.baseten.co/v1",
    apiKeyEnv: "BASETEN_API_KEY",
    baseUrlEnv: "BASETEN_BASE_URL",
    authHeader: (key) => `Api-Key ${key}`,
    extraHeaders: {}
  },
  {
    name: "custom",
    label: "Custom",
    baseUrl: "",
    apiKeyEnv: "BYOM_CUSTOM_API_KEY",
    baseUrlEnv: "BYOM_CUSTOM_BASE_URL",
    authHeader: (key) => `Bearer ${key}`,
    extraHeaders: {}
  }
];

const PROVIDER_MAP = new Map(PROVIDERS.map((p) => [p.name, p]));

function providerNames() {
  return PROVIDERS.map((p) => p.name).join(", ");
}

export function getProvider(name) {
  const provider = PROVIDER_MAP.get(name);
  if (!provider) {
    throw new Error(`Unknown provider: ${name}. Available: ${providerNames()}`);
  }
  return provider;
}

export function listProviders() {
  return [...PROVIDERS];
}

export function resolveProvider(options = {}) {
  const name = options.provider || process.env.BYOM_DEFAULT_PROVIDER || "openrouter";
  return getProvider(name);
}
