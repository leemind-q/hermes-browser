const { app, BrowserWindow } = require('electron');
const path = require('path');

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

async function evalIn(win, code) {
  return win.webContents.executeJavaScript(code, true);
}

async function click(win, selector) {
  return evalIn(win, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { ok:false, error:'missing ' + ${JSON.stringify(selector)} };
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles:true, clientX:r.left+r.width/2, clientY:r.top+r.height/2 }));
    el.dispatchEvent(new MouseEvent('click', { bubbles:true, clientX:r.left+r.width/2, clientY:r.top+r.height/2 }));
    return { ok:true, rect:{ left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height } };
  })()`);
}

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
  await wait(300);

  const initial = await evalIn(win, `(() => {
    const q = s => document.querySelector(s);
    const rect = s => { const r = q(s).getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom }; };
    return {
      topbar: rect('.topbar'),
      address: rect('.address'),
      left: rect('#leftPanel'),
      right: rect('#rightPanel'),
      frame: rect('.browser-frame'),
      hasZoom: !!q('#zoomInBtn') || !!q('#zoomOutBtn'),
      hasMovedToolbarButtons: ['#printBtn','#downloadsBtn','#darkModeBtn','#readModeBtn','#historyBtn'].some(s => !!q(s)),
      settingsZ: getComputedStyle(q('#settingsPopover')).zIndex,
      actionGap: (() => { const a = q('#newTabTopBtn').getBoundingClientRect(); const b = q('#settingsBtn').getBoundingClientRect(); return Math.round(b.left - a.right); })(),
      settingsNoDrag: getComputedStyle(q('#settingsBtn')).webkitAppRegion,
      newTabNoDrag: getComputedStyle(q('#newTabTopBtn')).webkitAppRegion,
      optical: (() => {
        const top = getComputedStyle(q('.topbar'));
        const topBefore = getComputedStyle(q('.topbar'), '::before');
        const topAfter = getComputedStyle(q('.topbar'), '::after');
        const btn = getComputedStyle(q('#settingsBtn'));
        const btnBefore = getComputedStyle(q('#settingsBtn'), '::before');
        const popBefore = getComputedStyle(q('#settingsPopover'), '::before');
        return {
          backdrop: top.backdropFilter || top.webkitBackdropFilter,
          topBeforeFilter: topBefore.filter,
          topBeforeBlend: topBefore.mixBlendMode,
          topAfterBlend: topAfter.mixBlendMode,
          btnBackdrop: btn.backdropFilter || btn.webkitBackdropFilter,
          btnBeforeFilter: btnBefore.filter,
          popBeforeFilter: popBefore.filter,
          lensSurface: getComputedStyle(document.documentElement).getPropertyValue('--lens-surface').trim(),
          lensDepth: getComputedStyle(document.documentElement).getPropertyValue('--lens-depth').trim(),
          lensRim: getComputedStyle(document.documentElement).getPropertyValue('--lens-rim').trim(),
        };
      })(),
    };
  })()`);
  assert(initial.topbar.height <= 42 && initial.topbar.height >= 36, 'topbar height not compact');
  assert(initial.address.height >= 30 && initial.address.height <= 34, 'address height not readable');
  assert(initial.left.width === 144, 'left sidebar width expected 144');
  assert(initial.right.width === 248, 'right sidebar width expected 248');
  assert(!initial.hasZoom, 'zoom buttons still present');
  assert(!initial.hasMovedToolbarButtons, 'moved feature buttons still present in toolbar');
  assert(Number(initial.settingsZ) >= 200, 'settings popover z-index too low');
  assert(initial.actionGap >= 0, 'new tab/settings overlap');
  assert(initial.settingsNoDrag === 'no-drag' && initial.newTabNoDrag === 'no-drag', 'top action buttons are draggable, clicks can be swallowed');

  let r = await click(win, '#settingsBtn');
  assert(r.ok, r.error || 'settings click failed');
  await wait(220);
  const opened = await evalIn(win, `(() => {
    const p = document.querySelector('#settingsPopover'); const b = document.querySelector('#settingsBtn'); const r = p.getBoundingClientRect();
    return { visible:p.classList.contains('visible'), hidden:p.getAttribute('aria-hidden'), expanded:b.getAttribute('aria-expanded'), rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}, labels:[...p.querySelectorAll('.settings-item-name')].map(n=>n.textContent), above: document.elementFromPoint(r.left + r.width - 12, r.top + 12)?.id || document.elementFromPoint(r.left + r.width - 12, r.top + 12)?.className || '' };
  })()`);
  assert(opened.visible && opened.hidden === 'false' && opened.expanded === 'true', 'settings popover did not open');
  assert(opened.rect.right <= 1280 && opened.rect.bottom <= 760 && opened.rect.left >= 0 && opened.rect.top >= 0, 'settings popover out of viewport');
  for (const label of ['인쇄','다운로드','읽기모드','다크모드','방문기록']) assert(opened.labels.includes(label), 'missing settings item ' + label);

  await click(win, '#settingsBtn');
  await wait(180);
  const closedByToggle = await evalIn(win, `document.querySelector('#settingsPopover').classList.contains('visible')`);
  assert(!closedByToggle, 'settings popover did not close by toggle');

  await click(win, '#settingsBtn');
  await wait(180);
  await evalIn(win, `document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles:true, clientX:20, clientY:120 }))`);
  await wait(180);
  const closedByOutside = await evalIn(win, `document.querySelector('#settingsPopover').classList.contains('visible')`);
  assert(!closedByOutside, 'settings popover did not close by outside click');

  await click(win, '#settingsBtn');
  await wait(180);
  await evalIn(win, `document.dispatchEvent(new KeyboardEvent('keydown', { bubbles:true, key:'Escape' }))`);
  await wait(180);
  const closedByEsc = await evalIn(win, `document.querySelector('#settingsPopover').classList.contains('visible')`);
  assert(!closedByEsc, 'settings popover did not close by ESC');

  await click(win, '#newTabTopBtn');
  await wait(120);
  const tabState = await evalIn(win, `({ calls: window.__testState.newTabCalls.length, tabCount: window.__testState.tabs.length, active: window.__testState.activeTabId, activeText: document.querySelector('#tabList .tab.active .tab-title')?.textContent || '' })`);
  assert(tabState.calls === 1 && tabState.tabCount === 2 && tabState.active === 2, 'new tab did not create and activate');
  assert(tabState.activeText.includes('New Tab'), 'active new tab not rendered');

  await click(win, '#settingsBtn');
  await wait(180);
  await click(win, '[data-setting-action="print"]');
  await click(win, '[data-setting-action="read"]');
  await click(win, '[data-setting-action="dark"]');
  const quickState = await evalIn(win, `({ print: window.__testState.printCalls, read: window.__testState.readModeEnabled, dark: window.__testState.darkModeEnabled, readActive: document.querySelector('[data-setting-action="read"]')?.classList.contains('active'), darkActive: document.querySelector('[data-setting-action="dark"]')?.classList.contains('active') })`);
  assert(quickState.print === 1, 'print did not run from settings');
  assert(quickState.read && quickState.readActive, 'read mode did not toggle from settings');
  assert(quickState.dark && quickState.darkActive, 'dark mode did not toggle from settings');

  await click(win, '[data-setting-action="downloads"]');
  await wait(160);
  const downloadsState = await evalIn(win, `({ opened: window.__testState.downloadsOpened, visible: document.querySelector('#downloadsModal').classList.contains('visible') })`);
  assert(downloadsState.opened >= 1 && downloadsState.visible, 'downloads did not open from settings');
  await click(win, '#downloadsCancel');
  await wait(120);

  await click(win, '#settingsBtn');
  await wait(160);
  await click(win, '[data-setting-action="history"]');
  await wait(160);
  const historyState = await evalIn(win, `({ opened: window.__testState.historyOpened, visible: document.querySelector('#historyModal').classList.contains('visible') })`);
  assert(historyState.opened >= 1 && historyState.visible, 'history did not open from settings');

  await evalIn(win, `document.querySelector('#addressInput').value = 'example.com'; document.querySelector('#addressInput').dispatchEvent(new KeyboardEvent('keydown', { bubbles:true, key:'Enter' }));`);
  await wait(120);
  const navState = await evalIn(win, `window.__testState.actions.some(a => a.action === 'navigate' && a.params.url === 'example.com')`);
  assert(navState, 'address input navigate broke');

  win.setSize(920, 620);
  await wait(250);
  await click(win, '#settingsBtn');
  await wait(180);
  const responsive = await evalIn(win, `(() => { const p = document.querySelector('#settingsPopover'); const r = p.getBoundingClientRect(); return { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height, vw:innerWidth, vh:innerHeight }; })()`);
  assert(responsive.left >= 0 && responsive.top >= 0 && responsive.right <= responsive.vw && responsive.bottom <= responsive.vh, 'popover out of viewport after resize');

  console.log(JSON.stringify({
    ok: true,
    initial,
    opened,
    tabState,
    quickState,
    downloadsState,
    historyState,
    responsive,
  }, null, 2));
  await win.close();
  app.quit();
}

main().catch(async err => {
  console.error(err.stack || err.message);
  app.exit(1);
});
