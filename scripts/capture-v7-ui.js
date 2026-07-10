const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function main() {
  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 760,
    webPreferences: {
      preload: path.join(__dirname, 'verify-v7-preload.js'),
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  await win.loadFile(path.join(__dirname, '..', 'src', 'chrome.html'));
  await wait(500);
  await win.webContents.executeJavaScript(`document.querySelector('#settingsBtn').click()`, true);
  await wait(250);
  const image = await win.webContents.capturePage();
  const outDir = path.join(__dirname, '..', 'screenshots');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, 'v7-toolbar-popover.png');
  fs.writeFileSync(out, image.toPNG());
  console.log(out);
  await win.close();
  app.quit();
}
main().catch(err => { console.error(err.stack || err.message); app.exit(1); });
