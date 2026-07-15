/**
 * MCP Atlassian Handler — runs mcp-atlassian as a subprocess,
 * communicates via JSON-RPC stdio.
 *
 * Supports both Confluence (vacation parsing) and Jira (issue search).
 * Config read from ~/.config/gantt-viewer/ai-config.json → provider.mcp.atlassian
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

/**
 * Read the MCP config for Atlassian from ai-config.json.
 */
function getMcpConfig() {
  try {
    const { app } = require("electron");
    const home = app.getPath("home");
    const configPath = path.join(home, ".config", "gantt-viewer", "ai-config.json");
    if (!fs.existsSync(configPath)) return null;

    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    // Try both locations: provider.mcp and top-level mcp
    const mcp = config.provider?.mcp || config.mcp;
    if (!mcp) return null;
    return mcp;
  } catch {
    return null;
  }
}

/**
 * Start a single MCP server process and return a client for it.
 */
function createMcpClient(mcpConfig) {
  const servers = Object.entries(mcpConfig).filter(([, v]) => v.enabled !== false);
  if (servers.length === 0) return null;

  const [name, cfg] = servers[0];

  // Command can be array (command + args) or string
  let command, args;
  if (Array.isArray(cfg.command)) {
    command = cfg.command[0];
    args = cfg.command.slice(1);
  } else if (typeof cfg.command === "string") {
    command = cfg.command;
    args = [];
  } else {
    return null;
  }

  // Environment — merge process.env with configured environment
  const env = { ...process.env, ...cfg.environment };

  // Some configs use cfg.options instead of top-level
  if (cfg.options) {
    const opts = cfg.options;
    for (const [k, v] of Object.entries(opts)) {
      // Convert option keys to env vars if they look like URLs/tokens
      if (typeof v === "string") env[k.toUpperCase()] = v;
    }
  }

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
    for (const [, { reject }] of pending) {
      reject(new Error(`Failed to start MCP server: ${err.message}`));
    }
    pending.clear();
  });

  function request(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++msgId;
      pending.set(id, { resolve, reject });
      const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      proc.stdin.write(msg + "\n");
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`MCP request timed out: ${method}`));
        }
      }, 30000);
    });
  }

  function close() {
    try { proc.kill(); } catch {}
  }

  function getStderr() {
    return stderrBuffer;
  }

  return { request, close, getStderr, name };
}

/**
 * Initialize the MCP connection (handshake).
 */
async function initMcp(client) {
  await client.request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "gantt-viewer", version: "1.0.0" },
  });
  // Send initialized notification
  try {
    client.request("notifications/initialized", {}).catch(() => {});
  } catch {}
}

/**
 * List available tools on the MCP server.
 */
async function listTools(client) {
  const result = await client.request("tools/list", {});
  return result?.tools || [];
}

/**
 * Call a tool by name with arguments.
 */
async function callTool(client, toolName, args) {
  return await client.request("tools/call", {
    name: toolName,
    arguments: args,
  });
}

// ── Confluence: fetch vacations ────────────────────────────────────

async function fetchVacations(params = {}) {
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
    const tools = await listTools(client);
    const toolNames = tools.map((t) => t.name);

    // Build CQL query
    const cql = params.query
      ? params.query
      : 'type = page AND (title ~ "отпуск" OR title ~ "vacation" OR title ~ "отпуска" OR title ~ "отсутствие")';

    let results = [];

    // Try confluence_search first
    if (toolNames.includes("confluence_search")) {
      const searchResult = await callTool(client, "confluence_search", { cql, limit: 10 });
      results = extractResultsArray(searchResult);
    }

    // For each result, get full page and parse vacations
    const allVacations = [];
    let rawPages = [];

    for (const r of results) {
      const pageId = r.id || r.pageId || r.content?.id;
      const title = r.title || "";
      let pageText = "";

      if (pageId && toolNames.includes("confluence_get_page")) {
        try {
          const cleanId = String(pageId).replace("page-", "").split("-")[0];
          const pageResult = await callTool(client, "confluence_get_page", { page_id: cleanId });
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

    // Direct page fetch if pageId provided
    if (results.length === 0 && params.pageId && toolNames.includes("confluence_get_page")) {
      const pageResult = await callTool(client, "confluence_get_page", { page_id: params.pageId });
      const pageText = extractTextFromResult(pageResult);
      rawPages.push({ title: "Direct fetch", text: pageText });
      const vacs = parseVacationsFromText(pageText);
      allVacations.push(...vacs);
    }

    // Deduplicate
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

// ── Jira: search issues ────────────────────────────────────────────

async function searchJira(params = {}) {
  const mcpConfig = getMcpConfig();
  if (!mcpConfig) {
    throw new Error("MCP Atlassian не настроен в ai-config.json.");
  }

  const client = createMcpClient(mcpConfig);
  if (!client) {
    throw new Error("Нет активных MCP серверов в конфигурации");
  }

  try {
    await initMcp(client);
    const tools = await listTools(client);
    const toolNames = tools.map((t) => t.name);

    const jql = params.jql || "assignee = currentUser() AND statusCategory != done ORDER BY updated DESC";
    const limit = params.limit || 20;

    let issues = [];

    // Try jira_search / jira_search_issues
    const searchTool = toolNames.find((n) => n.includes("jira") && n.includes("search"));
    if (searchTool) {
      const result = await callTool(client, searchTool, { jql, limit });
      issues = extractResultsArray(result);
    } else {
      throw new Error(`Jira search tool не найден. Доступные tools: ${toolNames.join(", ")}`);
    }

    // Parse issues into structured format
    const parsed = issues.map((issue) => parseJiraIssue(issue)).filter(Boolean);

    return {
      issues: parsed,
      total: parsed.length,
      jql,
      stderr: client.getStderr(),
    };
  } finally {
    client.close();
  }
}

/**
 * Get a single Jira issue by key.
 */
async function getJiraIssue(issueKey) {
  const mcpConfig = getMcpConfig();
  if (!mcpConfig) throw new Error("MCP Atlassian не настроен.");

  const client = createMcpClient(mcpConfig);
  if (!client) throw new Error("Нет активных MCP серверов.");

  try {
    await initMcp(client);
    const tools = await listTools(client);
    const toolNames = tools.map((t) => t.name);

    const getTool = toolNames.find((n) => n.includes("jira") && (n.includes("get_issue") || n.includes("get")));
    if (!getTool) throw new Error(`Jira get tool не найден. Tools: ${toolNames.join(", ")}`);

    const result = await callTool(client, getTool, { issue_key: issueKey, issueIdOrKey: issueKey });
    const text = extractTextFromResult(result);
    try {
      const parsed = JSON.parse(text);
      return { issue: parseJiraIssue(parsed), raw: text };
    } catch {
      return { issue: null, raw: text };
    }
  } finally {
    client.close();
  }
}

/**
 * Create a Jira issue.
 */
async function createJiraIssue(params = {}) {
  const mcpConfig = getMcpConfig();
  if (!mcpConfig) throw new Error("MCP Atlassian не настроен.");

  const client = createMcpClient(mcpConfig);
  if (!client) throw new Error("Нет активных MCP серверов.");

  try {
    await initMcp(client);
    const tools = await listTools(client);
    const toolNames = tools.map((t) => t.name);

    const createTool = toolNames.find((n) => n.includes("jira") && n.includes("create"));
    if (!createTool) throw new Error(`Jira create tool не найден. Tools: ${toolNames.join(", ")}`);

    const result = await callTool(client, createTool, {
      project: params.project,
      issuetype: params.issuetype || "Task",
      summary: params.summary,
      description: params.description || "",
      assignee: params.assignee,
    });

    return { result: extractTextFromResult(result), stderr: client.getStderr() };
  } finally {
    client.close();
  }
}

// ── Parsing helpers ────────────────────────────────────────────────

function extractTextFromResult(result) {
  if (!result) return null;
  if (result.content && Array.isArray(result.content)) {
    const texts = result.content.filter((c) => c.type === "text").map((c) => c.text);
    if (texts.length > 0) return texts.join("\n");
  }
  if (typeof result === "string") return result;
  return JSON.stringify(result);
}

function extractResultsArray(result) {
  const text = extractTextFromResult(result);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (parsed.results) return parsed.results;
    if (parsed.issues) return parsed.issues;
    return [parsed];
  } catch {
    return [{ title: "Search results", content: text }];
  }
}

/**
 * Parse vacation entries from Confluence page text.
 */
function parseVacationsFromText(text) {
  const vacations = [];
  if (!text) return vacations;

  // Pattern 1: Name followed by date range
  const dateRangeRegex = /([А-Яа-яЁё][А-Яа-яЁё\s.]{2,40}?)\s*[:|,\-—]*\s*(\d{1,2}\.\d{1,2}\.\d{4})\s*[—\-–по until]*\s*(?:до\s+)?(\d{1,2}\.\d{1,2}\.\d{4})/g;
  let match;
  while ((match = dateRangeRegex.exec(text)) !== null) {
    const resource = match[1].trim().replace(/\s+/g, " ");
    const start = normalizeDate(match[2]);
    const end = normalizeDate(match[3]);
    if (resource && start && end) vacations.push({ resource, start, end, note: "Confluence" });
  }

  // Pattern 2: Table format | Name | date | date | note |
  const tableRegex = /\|\s*([А-Яа-яЁё][А-Яа-яЁё\s.]{2,40}?)\s*\|\s*(\d{1,2}\.\d{1,2}\.\d{4})\s*\|\s*(\d{1,2}\.\d{1,2}\.\d{4})\s*(?:\|\s*([^|\n]+))?/g;
  while ((match = tableRegex.exec(text)) !== null) {
    const resource = match[1].trim().replace(/\s+/g, " ");
    const start = normalizeDate(match[2]);
    const end = normalizeDate(match[3]);
    const note = match[4]?.trim() || "Confluence";
    if (resource && start && end) vacations.push({ resource, start, end, note });
  }

  // Pattern 3: "с DD.MM по DD.MM.YYYY"
  const rangeFromRegex = /([А-Яа-яЁё][А-Яа-яЁё\s.]{2,40}?)\s*[:|,\-—]*\s*с\s+(\d{1,2}\.\d{1,2}(?:\.\d{4})?)\s+по\s+(\d{1,2}\.\d{1,2}\.\d{4})/g;
  while ((match = rangeFromRegex.exec(text)) !== null) {
    const resource = match[1].trim().replace(/\s+/g, " ");
    let start = normalizeDate(match[2]);
    const end = normalizeDate(match[3]);
    if (!match[2].includes(".") || match[2].split(".").length < 3) {
      const year = match[3].split(".")[2];
      start = normalizeDate(match[2] + "." + year);
    }
    if (resource && start && end) vacations.push({ resource, start, end, note: "Confluence" });
  }

  return vacations;
}

/**
 * Parse a Jira issue from API response into structured format.
 */
function parseJiraIssue(issue) {
  if (!issue) return null;

  // Handle different response shapes
  const fields = issue.fields || issue;

  return {
    key: issue.key || issue.issueKey || fields.key,
    id: issue.id || fields.id,
    summary: fields.summary || issue.summary || issue.name || "",
    status: fields.status?.name || fields.status || issue.status || "",
    issueType: fields.issuetype?.name || fields.issuetype || issue.issueType || "",
    priority: fields.priority?.name || fields.priority || "",
    assignee: fields.assignee?.displayName || fields.assignee?.name || fields.assignee || "",
    reporter: fields.reporter?.displayName || fields.reporter?.name || "",
    created: fields.created || issue.created || "",
    updated: fields.updated || issue.updated || "",
    duedate: fields.duedate || issue.duedate || "",
    description: fields.description || issue.description || "",
    project: fields.project?.key || fields.project?.name || issue.project || "",
  };
}

function normalizeDate(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.trim().split(".");
  if (parts.length < 3) return null;
  const [d, m, y] = parts;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

module.exports = {
  fetchVacations,
  searchJira,
  getJiraIssue,
  createJiraIssue,
  parseVacationsFromText,
  getMcpConfig,
};
