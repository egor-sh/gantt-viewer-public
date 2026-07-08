// Electron main process.
// Loads the Next.js static export (`out/index.html`) inside a native window.

const { app, BrowserWindow, shell, protocol, net, ipcMain } = require("electron");
const path = require("path");
const { pathToFileURL } = require("node:url");

const aiHandler = require("./ai-handler");

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

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

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
