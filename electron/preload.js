// Preload script — runs in the renderer process with limited Node.js access.
// Currently no native APIs are exposed; the app is fully self-contained.
// Kept here so contextIsolation stays on and we can later add IPC if needed.
window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.classList.add("electron");
});
