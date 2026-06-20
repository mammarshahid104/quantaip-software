// One-off: rasterize public/favicon.svg into a 512x512 public/icon.png
// using Electron's Chromium (offscreen rendering). Run with:
//   electron electron/gen-icon.cjs
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

app.disableHardwareAcceleration();

const SIZE = 512;
const svg = fs.readFileSync(
  path.join(__dirname, "../public/favicon.svg"),
  "utf8"
);

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;width:${SIZE}px;height:${SIZE}px;background:transparent;}
  .wrap{width:${SIZE}px;height:${SIZE}px;display:flex;align-items:center;justify-content:center;}
  svg{width:78%;height:78%;}
</style></head><body><div class="wrap">${svg}</div></body></html>`;

function save(image) {
  // Capture runs at the display's devicePixelRatio, so force an exact square
  // 512x512 — electron-builder rejects non-square Windows icons.
  const squared = image.resize({ width: SIZE, height: SIZE, quality: "best" });
  const out = path.join(__dirname, "../public/icon.png");
  fs.writeFileSync(out, squared.toPNG());
  console.log("Wrote", out, JSON.stringify(squared.getSize()));
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    webPreferences: { offscreen: true },
  });
  win.setBackgroundColor("#00000000");

  let done = false;
  const finish = async () => {
    if (done) return;
    done = true;
    const image = await win.capturePage();
    save(image);
    app.quit();
  };

  // Offscreen emits 'paint'; capturePage gives us the composited frame.
  win.webContents.on("paint", () => {
    setTimeout(finish, 300);
  });
  win.webContents.once("did-finish-load", () => {
    setTimeout(finish, 800); // fallback if no paint event fires
  });

  await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
});
