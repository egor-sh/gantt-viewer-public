// Preload script — runs in the renderer process with limited Node.js access.
// Exposes AI and window APIs to the renderer via contextBridge.

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
