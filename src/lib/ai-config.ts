/**
 * AI Provider Configuration — types and utilities.
 *
 * Config format is inspired by opencode (https://opencode.ai):
 * a JSON file with providers, each having baseURL, apiKey and models.
 *
 * Config file location:
 *   macOS:  ~/.config/gantt-viewer/ai-config.json
 */

export interface ModelConfig {
  name: string;
  limit?: {
    context?: number;
    output?: number;
  };
}

export interface ProviderConfig {
  name: string;
  baseURL: string;
  apiKey: string;
  models: Record<string, ModelConfig>;
}

export interface AIConfig {
  activeProvider: string;
  activeModel?: string;
  provider: Record<string, ProviderConfig>;
}

/** Default built-in providers (user can extend or override in config file). */
export const DEFAULT_PROVIDERS: Record<string, ProviderConfig> = {
  openai: {
    name: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    apiKey: "",
    models: {
      "gpt-4o": { name: "GPT-4o", limit: { context: 128000, output: 16384 } },
      "gpt-4o-mini": { name: "GPT-4o Mini", limit: { context: 128000, output: 16384 } },
    },
  },
  anthropic: {
    name: "Anthropic",
    baseURL: "https://api.anthropic.com/v1",
    apiKey: "",
    models: {
      "claude-sonnet-4-20250514": { name: "Claude Sonnet 4", limit: { context: 200000, output: 8192 } },
    },
  },
  ollama: {
    name: "Ollama (local)",
    baseURL: "http://localhost:11434/v1",
    apiKey: "ollama",
    models: {
      "llama3.1:8b": { name: "Llama 3.1 8B", limit: { context: 128000 } },
      "qwen2.5:14b": { name: "Qwen 2.5 14B", limit: { context: 128000 } },
    },
  },
};

export function defaultConfig(): AIConfig {
  return {
    activeProvider: "openai",
    activeModel: "gpt-4o",
    provider: { ...DEFAULT_PROVIDERS },
  };
}

/** Deep-merge user config over defaults so built-in providers are always available. */
export function mergeConfig(user: Partial<AIConfig> | null): AIConfig {
  const base = defaultConfig();
  if (!user) return base;

  const merged: AIConfig = {
    activeProvider: user.activeProvider ?? base.activeProvider,
    activeModel: user.activeModel ?? base.activeModel,
    provider: { ...base.provider },
  };

  if (user.provider) {
    for (const [id, p] of Object.entries(user.provider)) {
      if (merged.provider[id]) {
        // Override / extend existing provider
        merged.provider[id] = {
          ...merged.provider[id],
          ...p,
          models: { ...merged.provider[id].models, ...(p.models || {}) },
        };
      } else {
        merged.provider[id] = p;
      }
    }
  }

  return merged;
}

export function getActiveProvider(config: AIConfig): ProviderConfig | null {
  return config.provider[config.activeProvider] ?? null;
}

export function getActiveModel(config: AIConfig): string {
  return config.activeModel ?? Object.keys(getActiveProvider(config)?.models || {})[0] ?? "";
}
