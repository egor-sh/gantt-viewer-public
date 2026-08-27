// Electron main process.
// Loads the Next.js static export (`out/index.html`) inside a native window.

// Allow corporate self-signed certificates (SSL inspection in VPN).
// Must be set before any fetch() call in Node.js context.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const { app, BrowserWindow, shell, protocol, net, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("node:url");

const aiHandler = require("./ai-handler");
const versionManager = require("./version-manager");
const confluenceHandler = require("./mcp-confluence");

// ---------------------------------------------------------------------------
// Custom protocol: app://
//
// Next.js static export emits absolute asset paths (/_next/...).  When the page
// is loaded via file:// those paths resolve to the filesystem root instead of
// the app directory, so JavaScript / CSS never load and the UI is dead.
//
// Registering a standard, secure custom scheme lets us serve files from the
// bundled `out/` directory so absolute paths work correctly.
//
// MUST be called before app.whenReady().
// ---------------------------------------------------------------------------
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

// Single-instance lock — prevents multiple Gantt Viewer windows.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

/** @type {BrowserWindow | null} */
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: "Просмотрщик диаграммы Ганта",
    backgroundColor: "#f8fafc",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Load via the custom protocol so absolute paths (/_next/...) resolve
  // to the bundled out/ directory instead of the filesystem root.
  mainWindow.loadURL("app://ganttviewer/");

  // Block any user-initiated top-level navigation (e.g. dropping a file on
  // the window would otherwise navigate Electron to that file).
  mainWindow.webContents.on("will-navigate", (e) => {
    const url = e.url;
    if (!url.startsWith("app://")) {
      e.preventDefault();
    }
  });

  // Open external links in the user's default browser, not inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  // ── Intercept window close to ask about saving changes ──
  mainWindow.on("close", (e) => {
    if (mainWindow._unsavedChanges) {
      e.preventDefault();
      mainWindow._unsavedChanges = false; // prevent re-trigger

      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: "question",
        buttons: ["Сохранить", "Не сохранять", "Отмена"],
        defaultId: 0,
        cancelId: 2,
        title: "Несохранённые изменения",
        message: "У вас есть несохранённые изменения в проекте.",
        detail: "Сохранить перед выходом?",
      });

      if (choice === 0) {
        // Save — tell renderer to save, then close
        mainWindow.webContents.send("app:save-before-quit");
        // Renderer will call window.electron.confirmQuit() after saving
      } else if (choice === 1) {
        // Don't save — just close
        mainWindow._unsavedChanges = false;
        mainWindow.close();
      }
      // choice === 2 → cancel, do nothing (preventDefault already called)
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Trust corporate self-signed certificates (e.g. AlfaGen SSL inspection).
// This allows fetch() in ai-handler.js to work inside corporate VPN.
app.on("certificate-error", (event, _webContents, _url, _error, _certificate, callback) => {
  event.preventDefault();
  callback(true);
});

app.whenReady().then(() => {
  // ---- Register the app:// protocol handler ----
  // Serves static files from the bundled Next.js export (out/ directory).
  const outDir = path.resolve(__dirname, "..", "out");

  protocol.handle("app", async (request) => {
    const url = new URL(request.url);
    let pathname = decodeURIComponent(url.pathname);

    // Serve index.html for the root path.
    if (pathname === "/" || pathname === "") {
      pathname = "/index.html";
    }

    const filePath = path.join(outDir, pathname);
    const resolved = path.resolve(filePath);

    // Guard against path traversal (../../../etc/passwd etc.).
    if (!resolved.startsWith(outDir)) {
      return new Response("Forbidden", { status: 403 });
    }

    try {
      return await net.fetch(pathToFileURL(resolved).toString());
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });

  // ── AI IPC handlers ────────────────────────────────────────────
  ipcMain.handle("ai:config:get", () => aiHandler.readConfig());
  ipcMain.handle("ai:config:save", (_e, config) => { aiHandler.saveConfig(config); return true; });
  ipcMain.handle("ai:config:path", () => aiHandler.getConfigPath());

  ipcMain.handle("ai:chat", async (event, { messages, systemPrompt, requestId }) => {
    try {
      await aiHandler.handleChat(event, { messages, systemPrompt, requestId });
    } catch (err) {
      const win = BrowserWindow.fromWebContents(event.sender);
      win?.webContents.send("ai:stream-error", { requestId, error: err.message });
    }
  });

  ipcMain.handle("ai:generate", async (event, { description, requestId }) => {
    try {
      await aiHandler.handleGenerate(event, { description, requestId });
    } catch (err) {
      const win = BrowserWindow.fromWebContents(event.sender);
      win?.webContents.send("ai:stream-error", { requestId, error: err.message });
    }
  });

  // ── Versioning IPC handlers ──────────────────────────────────────
  ipcMain.handle("version:push", (_e, { xml, fileName, label }) => {
    return versionManager.pushVersion(xml, fileName, label);
  });

  ipcMain.handle("version:list", (_e, { fileName }) => {
    return versionManager.getVersions(fileName);
  });

  ipcMain.handle("version:get", (_e, { fileName, versionId }) => {
    return versionManager.getVersion(fileName, versionId);
  });

  ipcMain.handle("version:previous", (_e, { fileName }) => {
    return versionManager.getPreviousVersion(fileName);
  });

  ipcMain.handle("version:clear", (_e, { fileName }) => {
    versionManager.clearVersions(fileName);
    return true;
  });

  // ── Atlassian MCP (Confluence + Jira) ────────────────────────────
  ipcMain.handle("confluence:vacations", async (_e, params) => {
    return await confluenceHandler.fetchVacations(params);
  });

  ipcMain.handle("jira:search", async (_e, params) => {
    return await confluenceHandler.searchJira(params);
  });

  ipcMain.handle("jira:getIssue", async (_e, { issueKey }) => {
    return await confluenceHandler.getJiraIssue(issueKey);
  });

  ipcMain.handle("jira:create", async (_e, params) => {
    return await confluenceHandler.createJiraIssue(params);
  });

  // ── Save file to disk ────────────────────────────────────────────
  // saveAs: always shows dialog, returns new path
  ipcMain.handle("file:saveAs", async (_e, { xml, defaultName }) => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    const result = await dialog.showSaveDialog(win, {
      title: "Сохранить как…",
      defaultPath: defaultName || "project.xml",
      filters: [
        { name: "MS Project XML", extensions: ["xml"] },
        { name: "Все файлы", extensions: ["*"] },
      ],
    });
    if (result.canceled || !result.filePath) return { saved: false };
    try {
      fs.writeFileSync(result.filePath, xml, "utf8");
      return { saved: true, path: result.filePath };
    } catch (err) {
      return { saved: false, error: err.message };
    }
  });

  // save: writes to filePath if known, otherwise falls back to saveAs
  ipcMain.handle("file:save", async (_e, { xml, filePath }) => {
    if (!filePath) return { saved: false, needDialog: true };
    try {
      fs.writeFileSync(filePath, xml, "utf8");
      return { saved: true, path: filePath };
    } catch (err) {
      return { saved: false, error: err.message };
    }
  });

  // ── Unsaved changes tracking ─────────────────────────────────────
  ipcMain.handle("app:set-unsaved", (_e, { hasChanges }) => {
    if (mainWindow) mainWindow._unsavedChanges = hasChanges;
    return true;
  });

  // Renderer calls this after saving — closes the window for real.
  ipcMain.handle("app:confirm-quit", () => {
    if (mainWindow) {
      mainWindow._unsavedChanges = false;
      mainWindow.close();
    }
    return true;
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// Suppress runtime errors silently in production (they're already logged to console).
process.on("uncaughtException", (err) => {
  console.error("Uncaught:", err);
});
