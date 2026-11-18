/**
 * AI Handler — runs in Electron main process.
 * Handles OpenAI-compatible API calls, config read/write, and streaming.
 */

const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const activeStreams = new Map();

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
    custom-gateway: {
      name: "Custom LLM gateway (OpenAI-совместимый)",
      baseURL: "",
      apiKey: "",
      models: {
        "DeepSeek-V4-Flash": { name: "DeepSeek-V4-Flash" },
        "GLM-5.2": { name: "GLM-5.2" },
      },
    },
  },
};

function readConfig() {
  const p = getConfigPath();
  // Create default config file on first run
  if (!fs.existsSync(p)) {
    try {
      saveConfig(DEFAULT_CONFIG);
      return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    } catch {}
    return DEFAULT_CONFIG;
  }
  try {
    const user = JSON.parse(fs.readFileSync(p, "utf8"));
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
        // Normalize opencode-style options -> top-level baseURL/apiKey.
        // Top-level is the source of truth: options only as fallback,
        // promoted keys are stripped so stale values can't override
        // user edits after a save/reload round-trip (v0.0.14 fix).
        const np = merged.provider[id];
        if (np.options) {
          if (!np.baseURL && np.options.baseURL) np.baseURL = np.options.baseURL;
          if (!np.apiKey && np.options.apiKey) np.apiKey = np.options.apiKey;
          if (np.baseURL) delete np.options.baseURL;
          if (np.apiKey) delete np.options.apiKey;
          if (Object.keys(np.options).length === 0) delete np.options;
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
  const p = config.provider[config.activeProvider] ?? null;
  if (!p) return null;
  // Normalize opencode-style config: baseURL/apiKey may live inside .options
  if (p.options && !p.baseURL) {
    p.baseURL = p.options.baseURL || p.options.base_url;
  }
  if (p.options && !p.apiKey) {
    p.apiKey = p.options.apiKey || p.options.api_key;
  }
  return p;
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
  onChunk,
  onReasoning,
  requestId
) {
  const base = baseURL.replace(/\/+$/, "");
  // If baseURL already ends with /v1 or /v1/..., append /chat/completions directly.
  // Otherwise add /v1/chat/completions (standard OpenAI-compatible path).
  const url = /\/v\d+$/.test(base)
    ? `${base}/chat/completions`
    : `${base}/v1/chat/completions`;

  const body = JSON.stringify({
    model,
    messages,
    stream: true,
    temperature: 0.7,
    max_tokens: 16384,
  });

  const headers = {
    "Content-Type": "application/json",
  };

  // Anthropic uses a different header format but the /v1/chat/completions
  // OpenAI-compat endpoint on their side works with Bearer.
  if (apiKey && apiKey !== "ollama") {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  return await httpsStreamRequest(url, headers, body, onChunk, onReasoning, requestId);
}

/**
 * Streaming HTTPS request via Node's https module.
 * Uses rejectUnauthorized: false so corporate self-signed
 * certificates (SSL inspection in VPN) work — Electron's built-in
 * fetch ignores NODE_TLS_REJECT_UNAUTHORIZED.
 */
function httpsStreamRequest(url, headers, body, onChunk, onReasoning, requestId) {
  return new Promise((resolve, reject) => {
    const https = require("https");
    const urlObj = new URL(url);

    const req = https.request(
      {
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method: "POST",
        headers,
        rejectUnauthorized: false, // corporate SSL inspection
      },
      (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          let errText = "";
          res.on("data", (c) => { errText += c; });
          res.on("end", () => {
            reject(new Error(`API error ${res.statusCode}: ${errText.slice(0, 200) || res.statusMessage}`));
          });
          return;
        }

        let buffer = "";
        let full = "";
        let fullReasoning = "";
        const decoder = new TextDecoder();

        const consumeLine = (line) => {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data:")) return;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") return;
          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta || {};
            if (delta.reasoning_content) {
              fullReasoning += delta.reasoning_content;
              if (onReasoning) onReasoning(delta.reasoning_content);
            }
            if (delta.content) {
              full += delta.content;
              onChunk(delta.content);
            }
          } catch {
            // skip malformed chunks
          }
        };

        res.on("data", (chunk) => {
          buffer += decoder.decode(chunk, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) consumeLine(line);
        });

        // SSE-серверы могут завершить поток без финального \n —
        // иначе последний токен (например "</Project>") теряется.
        res.on("end", () => {
          if (buffer) {
            for (const line of buffer.split("\n")) consumeLine(line);
            buffer = "";
          }
          if (requestId) activeStreams.delete(requestId);
          resolve(full);
        });
        res.on("error", (e) => { if (requestId) activeStreams.delete(requestId); reject(e); });
      }
    );

    if (requestId) activeStreams.set(requestId, req);
    req.on("error", reject);
    req.setTimeout(120000, () => {
      req.destroy(new Error("Таймаут запроса к AI-провайдеру (120 сек)"));
    });
    req.write(body);
    req.end();
  });
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
    },
    (rchunk) => {
      win?.webContents.send("ai:stream-reasoning", { requestId, chunk: rchunk });
    },
    requestId
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
    },
    (rchunk) => {
      win?.webContents.send("ai:stream-reasoning", { requestId, chunk: rchunk });
    },
    requestId
  );

  win?.webContents.send("ai:stream-end", { requestId });
}

function stopStream(requestId) {
  const req = activeStreams.get(requestId);
  if (req) { activeStreams.delete(requestId); req.destroy(new Error("Остановлено пользователем")); return true; }
  return false;
}

module.exports = {
  stopStream,
  readConfig,
  saveConfig,
  handleChat,
  handleGenerate,
  getConfigPath,
};
