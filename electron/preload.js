// Preload script — runs in the renderer process with limited Node.js access.
// Exposes AI, versioning, and Confluence APIs to the renderer via contextBridge.

const { contextBridge, ipcRenderer } = require("electron");

// Mark that we're in Electron (for CSS adjustments)
window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.classList.add("electron");
});

contextBridge.exposeInMainWorld("ai", {
  // Config
  getConfig: () => ipcRenderer.invoke("ai:config:get"),
  saveConfig: (config) => ipcRenderer.invoke("ai:config:save", config),
  getConfigPath: () => ipcRenderer.invoke("ai:config:path"),

  // Chat (streaming)
  chat: (messages, systemPrompt, requestId) =>
    ipcRenderer.invoke("ai:chat", { messages, systemPrompt, requestId }),

  // Generate project from text (streaming)
  generate: (description, requestId) =>
    ipcRenderer.invoke("ai:generate", { description, requestId }),

  // Stream events
  onStreamChunk: (callback) =>
    ipcRenderer.on("ai:stream", (_e, data) => callback(data)),
  onStreamEnd: (callback) =>
    ipcRenderer.on("ai:stream-end", (_e, data) => callback(data)),
  onStreamError: (callback) =>
    ipcRenderer.on("ai:stream-error", (_e, data) => callback(data)),
});

contextBridge.exposeInMainWorld("versions", {
  // Push a new XML version onto the undo stack
  push: (xml, fileName, label) =>
    ipcRenderer.invoke("version:push", { xml, fileName, label }),
  // List all stored versions (newest first)
  list: (fileName) =>
    ipcRenderer.invoke("version:list", { fileName }),
  // Get a specific version's XML
  get: (fileName, versionId) =>
    ipcRenderer.invoke("version:get", { fileName, versionId }),
  // Get the most recent previous version
  previous: (fileName) =>
    ipcRenderer.invoke("version:previous", { fileName }),
  // Clear all versions
  clear: (fileName) =>
    ipcRenderer.invoke("version:clear", { fileName }),
});

contextBridge.exposeInMainWorld("confluence", {
  // Fetch vacations from Confluence via MCP
  fetchVacations: (params) =>
    ipcRenderer.invoke("confluence:vacations", params),
});

contextBridge.exposeInMainWorld("electron", {
  // Mark that there are unsaved changes (for close dialog)
  setUnsavedChanges: (hasChanges) => {
    // We can't directly set the flag, but we can invoke an IPC
    ipcRenderer.invoke("app:set-unsaved", { hasChanges });
  },
  // Confirm quit (called by renderer after saving)
  confirmQuit: () => {
    ipcRenderer.invoke("app:confirm-quit");
  },
  // Listen for save-before-quit signal from main process
  onSaveBeforeQuit: (callback) =>
    ipcRenderer.on("app:save-before-quit", () => callback()),
});
