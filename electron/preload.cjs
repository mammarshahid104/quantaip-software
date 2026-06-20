// Preload script — runs in an isolated context before the page loads.
// Kept intentionally minimal; a place to expose safe APIs later via
// contextBridge if the desktop app ever needs native capabilities.
window.addEventListener("DOMContentLoaded", () => {
  console.log("QUANTAIP EduOS Desktop Ready");
});
