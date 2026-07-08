/**
 * AI Handler — runs in Electron main process.
 * Handles OpenAI-compatible API calls, config read/write, and streaming.
 */

const fs = require("fs");
const path = require("path");
const { app } = require("electron");

// ── Config ────────────────────────────────────────────────────────────────

function getConfigPath() {
  const home = app.getPath("home");
  const dir = path.join(home, ".config", "gantt-viewer");
  return path.join(dir, "ai-config.json");
}

const DEFAULT_CONFIG = {
  activeProvider: "openai",
  activeModel: "gpt-4o",
  provider: {
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
  },
};

function readConfig() {
  try {
    const p = getConfigPath();
    if (!fs.existsSync(p)) return DEFAULT_CONFIG;
    const user = JSON.parse(fs.readFileSync(p, "utf8"));

    // Deep merge: user overrides built-in providers
    const merged = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    merged.activeProvider = user.activeProvider ?? merged.activeProvider;
    merged.activeModel = user.activeModel ?? merged.activeModel;
    if (user.provider) {
      for (const [id, prov] of Object.entries(user.provider)) {
        if (merged.provider[id]) {
          merged.provider[id] = {
            ...merged.provider[id],
            ...prov,
            models: { ...merged.provider[id].models, ...(prov.models || {}) },
          };
        } else {
          merged.provider[id] = prov;
        }
      }
    }
    return merged;
  } catch {
    return DEFAULT_CONFIG;
  }
}

function saveConfig(config) {
  const p = getConfigPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(config, null, 2), "utf8");
}

function getActiveProvider(config) {
  return config.provider[config.activeProvider] ?? null;
}

// ── API call (OpenAI-compatible, streaming) ───────────────────────────────

/**
 * Call the chat completions endpoint with streaming.
 * Calls onChunk(text) for each text delta.
 * Returns the full accumulated text on completion.
 */
async function streamChatCompletion(
  { baseURL, apiKey, model },
  messages,
  onChunk
) {
  const url = `${baseURL.replace(/\/+$/, "")}/chat/completions`;

  const body = JSON.stringify({
    model,
    messages,
    stream: true,
    temperature: 0.7,
  });

  const headers = {
    "Content-Type": "application/json",
  };

  // Anthropic uses a different header format but the /v1/chat/completions
  // OpenAI-compat endpoint on their side works with Bearer.
  if (apiKey && apiKey !== "ollama") {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const res = await fetch(url, { method: "POST", headers, body });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`API error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;

      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          onChunk(delta);
        }
      } catch {
        // skip malformed chunks
      }
    }
  }

  return full;
}

// ── Public handlers (called from IPC) ─────────────────────────────────────

async function handleChat(event, { messages, systemPrompt, requestId }) {
  const config = readConfig();
  const provider = getActiveProvider(config);
  if (!provider) throw new Error("Нет активного провайдера. Настройте в конфигурации.");
  if (!provider.apiKey && provider.baseURL.includes("localhost")) {
    // local server, ok
  } else if (!provider.apiKey) {
    throw new Error(`Нет API-ключа для провайдера "${provider.name}". Добавьте ключ в настройках.`);
  }

  const model = config.activeModel || Object.keys(provider.models)[0];
  const allMessages = [{ role: "system", content: systemPrompt }, ...messages];

  const win = require("electron").BrowserWindow.fromWebContents(event.sender);

  await streamChatCompletion(
    { baseURL: provider.baseURL, apiKey: provider.apiKey, model },
    allMessages,
    (chunk) => {
      win?.webContents.send("ai:stream", { requestId, chunk });
    }
  );

  win?.webContents.send("ai:stream-end", { requestId });
}

async function handleGenerate(event, { description, requestId }) {
  const config = readConfig();
  const provider = getActiveProvider(config);
  if (!provider) throw new Error("Нет активного провайдера.");

  const model = config.activeModel || Object.keys(provider.models)[0];

  const systemPrompt = `Ты — генератор проектов для MS Project. По описанию создай XML в формате MSPDI (Microsoft Project XML Interchange).

Требования к XML:
- Корневой элемент <Project> с <StartDate>, <FinishDate>
- Внутри <Tasks> — элементы <Task> с: UID, ID, Name, Start, Finish, Duration, OutlineLevel, OutlineNumber, Summary, Milestone, PercentComplete
- Даты ISO 8601: 2024-01-15T08:00:00
- Duration: PT<n>H (часы работы)
- <Resources> с <Resource> (UID, Name)
- <Assignments> со связями TaskUID → ResourceUID
- Суммарные задачи: Summary=1
- Вехи: Milestone=1, Duration PT0H
- Связи: <PredecessorLink> с PredecessorUID и Type (1=FS)

Верни ТОЛЬКО валидный XML, без markdown, без объяснений.`;

  const win = require("electron").BrowserWindow.fromWebContents(event.sender);

  await streamChatCompletion(
    { baseURL: provider.baseURL, apiKey: provider.apiKey, model },
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Создай проект: ${description}` },
    ],
    (chunk) => {
      win?.webContents.send("ai:stream", { requestId, chunk });
    }
  );

  win?.webContents.send("ai:stream-end", { requestId });
}

module.exports = {
  readConfig,
  saveConfig,
  handleChat,
  handleGenerate,
  getConfigPath,
};
