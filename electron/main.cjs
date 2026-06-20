const { app, BrowserWindow, shell } = require("electron");
const path = require("path");

// Dev = running against the Vite dev server (electron:dev sets NODE_ENV).
// The packaged app and electron:preview load the built files from dist/.
const isDev = process.env.NODE_ENV === "development";

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
    },
    icon: path.join(__dirname, "../public/icon.png"),
    title: "QUANTAIP EduOS",
    show: false, // don't show until ready
  });

  // Load app
  if (isDev) {
    win.loadURL("http://localhost:5173");
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  // Show when ready (no white flash)
  win.once("ready-to-show", () => {
    win.show();
    win.focus();
  });

  // Surface load failures (wrong path, missing assets) instead of a blank window
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error("Failed to load:", code, desc, url);
  });

  // Open external links in the user's default browser, not inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
