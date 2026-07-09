/**
 * MCP Confluence Handler — runs mcp-atlassian as a subprocess,
 * communicates via JSON-RPC stdio, and fetches vacation data.
 *
 * Uses MCP protocol (Model Context Protocol) to talk to the
 * Atlassian MCP server configured in ai-config.json.
 */

const { spawn } = require("child_process");

/**
 * Read the MCP config for Atlassian from ai-config.json.
 * Returns the environment variables needed for mcp-atlassian.
 */
function getMcpConfig() {
  try {
    const versionManager = require("./version-manager");
    // We can't call version-manager functions that need app.getPath here
    // directly in some contexts, but readConfigPath is fine.
    const path = require("path");
    const { app } = require("electron");
    const fs = require("fs");

    const home = app.getPath("home");
    const configPath = path.join(home, ".config", "gantt-viewer", "ai-config.json");

    if (!fs.existsSync(configPath)) return null;

    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const mcp = config.provider?.mcp;
    if (!mcp) return null;

    return mcp;
  } catch {
    return null;
  }
}

/**
 * Start a single MCP server process and return a client for it.
 * @param {object} mcpConfig — the `mcp` section from ai-config.json
 * @returns {McpClient}
 */
function createMcpClient(mcpConfig) {
  const servers = Object.entries(mcpConfig).filter(([, v]) => v.enabled !== false);
  if (servers.length === 0) return null;

  const [name, cfg] = servers[0];
  const command = cfg.command[0];
  const args = cfg.command.slice(1);
  const env = { ...process.env, ...cfg.environment };

  const proc = spawn(command, args, {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let msgId = 0;
  const pending = new Map();

  let buffer = "";

  proc.stdout.on("data", (data) => {
    buffer += data.toString();
    // MCP uses newline-delimited JSON-RPC
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        if (msg.id != null && pending.has(msg.id)) {
          const { resolve, reject } = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.error) {
            reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          } else {
            resolve(msg.result);
          }
        }
      } catch {
        // Incomplete JSON, ignore
      }
    }
  });

  let stderrBuffer = "";
  proc.stderr.on("data", (data) => {
    stderrBuffer += data.toString();
    if (stderrBuffer.length > 5000) stderrBuffer = stderrBuffer.slice(-5000);
  });

  proc.on("error", (err) => {
    // Reject all pending requests
    for (const [, { reject }] of pending) {
      reject(new Error(`Failed to start MCP server: ${err.message}`));
    }
    pending.clear();
  });

  /**
   * Send a JSON-RPC request and await the response.
   */
  function request(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++msgId;
      pending.set(id, { resolve, reject });

      const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      proc.stdin.write(msg + "\n");

      // Timeout after 30s
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`MCP request timed out: ${method}`));
        }
      }, 30000);
    });
  }

  /** Close the MCP server process. */
  function close() {
    try { proc.kill(); } catch {}
  }

  /** Get stderr for debugging. */
  function getStderr() {
    return stderrBuffer;
  }

  return { request, close, getStderr, name };
}

/**
 * Initialize the MCP connection (handshake).
 */
async function initMcp(client) {
  // Initialize handshake
  await client.request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "gantt-viewer", version: "1.0.0" },
  });

  // Send initialized notification (no response expected)
  // Some servers need this before accepting tool calls
}

/**
 * Fetch a Confluence page by title or CQL query and extract vacation info.
 *
 * @param {object} params — { query: string }  (CQL or page title)
 * @returns {array} [{ resource, start, end, note }]
 */
async function fetchConfluencePage(params) {
  const mcpConfig = getMcpConfig();
  if (!mcpConfig) {
    throw new Error("MCP Atlassian не настроен в ai-config.json");
  }

  const client = createMcpClient(mcpConfig);
  if (!client) {
    throw new Error("Не найден активный MCP сервер");
  }

  try {
    await initMcp(client);

    // List available tools to find the right one
    const toolsResult = await client.request("tools/list", {});
    const tools = toolsResult?.tools || [];
    const toolNames = tools.map((t) => t.name);

    // Try to find and call the Confluence search/get tool
    // The mcp-atlassian package typically exposes:
    //   - confluence_search (CQL query)
    //   - confluence_get_page (by ID or title)

    let pageContent = null;

    // Strategy 1: Use confluence_search with CQL
    if (toolNames.includes("confluence_search")) {
      const cql = params.query || 'type = page AND title ~ "отпуск" OR title ~ "vacation" OR title ~ "отпуска"';
      const result = await client.request("tools/call", {
        name: "confluence_search",
        arguments: { cql },
      });
      pageContent = extractTextFromResult(result);
    }

    // Strategy 2: If search returned results, try to get full page content
    if (!pageContent && toolNames.includes("confluence_get_page")) {
      const result = await client.request("tools/call", {
        name: "confluence_get_page",
        arguments: { page_id: params.pageId || "", title: params.query || "" },
      });
      pageContent = extractTextFromResult(result);
    }

    if (!pageContent) {
      throw new Error("Не удалось получить страницу Confluence. Проверьте CQL запрос.");
    }

    // Parse vacations from page content
    const vacations = parseVacationsFromText(pageContent);
    return { vacations, rawContent: pageContent };
  } finally {
    client.close();
  }
}

/**
 * Fetch ALL pages matching a CQL query and extract vacations.
 * @param {object} params — { query: string }
 */
async function fetchVacations(params) {
  const mcpConfig = getMcpConfig();
  if (!mcpConfig) {
    throw new Error("MCP Atlassian не настроен в ai-config.json. Добавьте секцию provider.mcp.atlassian.");
  }

  const client = createMcpClient(mcpConfig);
  if (!client) {
    throw new Error("Нет активных MCP серверов в конфигурации");
  }

  try {
    await initMcp(client);

    // List tools
    const toolsResult = await client.request("tools/list", {});
    const tools = toolsResult?.tools || [];
    const toolNames = tools.map((t) => t.name);

    // Build CQL — user can provide custom query, or we use vacation-related terms
    const cql = params.query
      ? params.query
      : 'type = page AND (title ~ "отпуск" OR title ~ "vacation" OR title ~ "отпуска" OR title ~ "отсутствие")';

    let results = [];

    // Use confluence_search
    if (toolNames.includes("confluence_search")) {
      const searchResult = await client.request("tools/call", {
        name: "confluence_search",
        arguments: { cql, limit: 10 },
      });
      results = extractResultsArray(searchResult);
    }

    // For each result, try to get the full page and parse vacations
    const allVacations = [];
    let rawPages = [];

    for (const r of results) {
      const pageId = r.id || r.pageId || r.content?.id;
      const title = r.title || "";
      let pageText = "";

      if (pageId && toolNames.includes("confluence_get_page")) {
        try {
          const pageResult = await client.request("tools/call", {
            name: "confluence_get_page",
            arguments: { page_id: String(pageId).replace("page-", "") },
          });
          pageText = extractTextFromResult(pageResult);
        } catch {
          pageText = typeof r === "string" ? r : JSON.stringify(r);
        }
      } else {
        pageText = typeof r === "string" ? r : JSON.stringify(r);
      }

      rawPages.push({ title, text: pageText });

      const vacs = parseVacationsFromText(pageText);
      allVacations.push(...vacs);
    }

    // If no results from search, try direct page fetch if pageId provided
    if (results.length === 0 && params.pageId && toolNames.includes("confluence_get_page")) {
      const pageResult = await client.request("tools/call", {
        name: "confluence_get_page",
        arguments: { page_id: params.pageId },
      });
      const pageText = extractTextFromResult(pageResult);
      rawPages.push({ title: "Direct fetch", text: pageText });
      const vacs = parseVacationsFromText(pageText);
      allVacations.push(...vacs);
    }

    // Deduplicate vacations
    const seen = new Set();
    const deduped = allVacations.filter((v) => {
      const key = `${v.resource}|${v.start}|${v.end}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return {
      vacations: deduped,
      pagesFound: rawPages.length,
      rawPages,
      stderr: client.getStderr(),
    };
  } finally {
    client.close();
  }
}

/**
 * Extract text content from an MCP tool call result.
 * MCP results can be { content: [{ type: "text", text: "..." }] }
 */
function extractTextFromResult(result) {
  if (!result) return null;

  // MCP standard format
  if (result.content && Array.isArray(result.content)) {
    const texts = result.content
      .filter((c) => c.type === "text")
      .map((c) => c.text);
    if (texts.length > 0) return texts.join("\n");
  }

  // Fallback: if it's already a string
  if (typeof result === "string") return result;

  // Fallback: JSON stringify
  return JSON.stringify(result);
}

/**
 * Extract array of results from MCP search result.
 */
function extractResultsArray(result) {
  const text = extractTextFromResult(result);
  if (!text) return [];

  // Try to parse as JSON array first
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (parsed.results) return parsed.results;
    // Single object — treat as one result
    return [parsed];
  } catch {
    // Not JSON — return as single text result
    return [{ title: "Search results", content: text }];
  }
}

/**
 * Parse vacation entries from Confluence page text.
 *
 * Supports formats like:
 *   - Иванов Иван: 01.07.2025 - 14.07.2025
 *   - Иванов Иван | 01.07.2025 — 14.07.2025 | ежегодный
 *   - Петров П.П. отпуск с 03.07 по 28.07.2025
 *   - Table rows: | Name | Start | End | Note |
 */
function parseVacationsFromText(text) {
  const vacations = [];

  if (!text) return vacations;

  // Pattern 1: Name followed by dates (DD.MM.YYYY - DD.MM.YYYY)
  // Matches: "Иванов Иван: 01.07.2025 - 14.07.2025"
  const dateRangeRegex = /([А-Яа-яЁё][А-Яа-яЁё\s.]{2,40}?)\s*[:|,\-—]*\s*(\d{1,2}\.\d{1,2}\.\d{4})\s*[—\-–по until]*\s*(?:до\s+)?(\d{1,2}\.\d{1,2}\.\d{4})/g;

  let match;
  while ((match = dateRangeRegex.exec(text)) !== null) {
    const resource = match[1].trim().replace(/\s+/g, " ");
    const start = normalizeDate(match[2]);
    const end = normalizeDate(match[3]);
    if (resource && start && end) {
      vacations.push({ resource, start, end, note: "Confluence" });
    }
  }

  // Pattern 2: Name | date | date | note (table format)
  // Matches markdown or plain text table rows
  const tableRegex = /\|\s*([А-Яа-яЁё][А-Яа-яЁё\s.]{2,40}?)\s*\|\s*(\d{1,2}\.\d{1,2}\.\d{4})\s*\|\s*(\d{1,2}\.\d{1,2}\.\d{4})\s*(?:\|\s*([^|\n]+))?/g;

  while ((match = tableRegex.exec(text)) !== null) {
    const resource = match[1].trim().replace(/\s+/g, " ");
    const start = normalizeDate(match[2]);
    const end = normalizeDate(match[3]);
    const note = match[4]?.trim() || "Confluence";
    if (resource && start && end) {
      vacations.push({ resource, start, end, note });
    }
  }

  // Pattern 3: "с DD.MM по DD.MM.YYYY" or "с DD.MM.YYYY по DD.MM.YYYY"
  const rangeFromRegex = /([А-Яа-яЁё][А-Яа-яЁё\s.]{2,40}?)\s*[:|,\-—]*\s*с\s+(\d{1,2}\.\d{1,2}(?:\.\d{4})?)\s+по\s+(\d{1,2}\.\d{1,2}\.\d{4})/g;

  while ((match = rangeFromRegex.exec(text)) !== null) {
    const resource = match[1].trim().replace(/\s+/g, " ");
    let start = normalizeDate(match[2]);
    const end = normalizeDate(match[3]);
    // If start year is missing, infer from end
    if (!match[2].includes(".") || match[2].split(".").length < 3) {
      const year = match[3].split(".")[2];
      start = normalizeDate(match[2] + "." + year);
    }
    if (resource && start && end) {
      vacations.push({ resource, start, end, note: "Confluence" });
    }
  }

  return vacations;
}

/**
 * Convert DD.MM.YYYY to YYYY-MM-DD (ISO format).
 */
function normalizeDate(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.trim().split(".");
  if (parts.length < 3) return null;
  const [d, m, y] = parts;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

module.exports = {
  fetchVacations,
  fetchConfluencePage,
  parseVacationsFromText,
  getMcpConfig,
};
