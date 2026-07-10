const { app, BrowserWindow } = require('electron');
const path = require('path');
const wait = ms => new Promise(r => setTimeout(r, ms));
async function main() {
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 1280, height: 760, webPreferences: { preload: path.join(__dirname, 'verify-v7-preload.js'), contextIsolation: false, sandbox: false } });
  await win.loadFile(path.join(__dirname, '..', 'src', 'chrome.html'));
  await wait(300);
  await win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector('#settingsBtn');
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('click', { bubbles:true, clientX:r.left+r.width/2, clientY:r.top+r.height/2 }));
  })()`);
  await wait(220);
  const data = await win.webContents.executeJavaScript(`(() => {
    const p = document.querySelector('#settingsPopover');
    const s = getComputedStyle(p);
    const r = p.getBoundingClientRect();
    const before = getComputedStyle(p, '::before');
    const after = getComputedStyle(p, '::after');
    return { innerWidth, innerHeight, rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}, style:{left:s.left,top:s.top,right:s.right,bottom:s.bottom,position:s.position,transform:s.transform,maxHeight:s.maxHeight,boxSizing:s.boxSizing}, before:{inset:before.inset, filter:before.filter}, after:{inset:after.inset, padding:after.padding} };
  })()`, true);
  console.log(JSON.stringify(data, null, 2));
  await win.close(); app.quit();
}
main().catch(e => { console.error(e.stack || e.message); app.exit(1); });
