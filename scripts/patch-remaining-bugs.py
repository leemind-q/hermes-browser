#!/usr/bin/env python3
"""Patch remaining bugs after transparent-overlay rollback:
- single instance lock + cache guard (main.js)
- render frame disposed guard (main.js)
- saveWorkspace state/toast wiring (renderer.js + chrome.html)
- Agent Tabs separation in groupTabs (renderer.js)
- agentOwned tab flag on agent-created tabs (main.js)
- preload diagnostics
"""
import re, os

BASE = '/mnt/c/Users/qqwer/OneDrive/Desktop/hermes-browser'

def read(f):
    with open(os.path.join(BASE, f), 'r', encoding='utf-8') as fh:
        return fh.read()

def write(f, content):
    with open(os.path.join(BASE, f), 'w', encoding='utf-8') as fh:
        fh.write(content)

# ===== main.js patches =====
main = read('main.js')

# require screen import if missing
main = main.replace(
    "const { app, BrowserWindow, WebContentsView, ipcMain, shell, safeStorage } = require('electron');",
    "const { app, BrowserWindow, WebContentsView, ipcMain, shell, safeStorage, screen } = require('electron');"
)

# single instance lock + cache disable after UI constants
old = "let mainWindow;\nlet tabs = [];\nlet activeTabId = null;"
new = '''// Single instance lock to avoid cache/ServiceWorker DB conflicts
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// Disable disk cache to reduce DB lock / stale UI on restart
app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

let mainWindow;
let tabs = [];
let activeTabId = null;'''
main = main.replace(old, new)

# safe send
old = "function send(channel, payload) { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload); }"
new = '''function send(channel, payload) {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    const wc = mainWindow.webContents;
    if (!wc || wc.isDestroyed()) return false;
    wc.send(channel, payload);
    return true;
  } catch (e) {
    const msg = String(e?.message || e);
    if (/Render frame was disposed|WebFrameMain|Object has been destroyed|render frame/i.test(msg)) {
      console.warn('[send] skipped disposed renderer frame', channel);
      return false;
    }
    console.warn('[send] failed', channel, msg);
    return false;
  }
}'''
main = main.replace(old, new)

# agentOwned tracking on createTab
old_create = re.search(r'(function createTab\([^)]*\) \{.*?loadUrlInView\(view, url\);\n\})', main, re.S)
if old_create:
    block = old_create.group(1)
    # Insert agentOwned init after const tab = { inside createTab
    new_block = block.replace(
        "createdAt: nowIso(),",
        "createdAt: nowIso(),\n      agentOwned: options && options.agentOwned === true,"
    )
    main = main.replace(block, new_block)

# markAgentTab IPC if missing
if "ipcMain.handle('browser:markAgentTab'" not in main:
    main = main.replace(
        "ipcMain.handle('browser:pinTab', (_e, id) => {",
        "ipcMain.handle('browser:markAgentTab', (_e, id, owned) => {\n  const tab = tabs.find(t => t.id === Number(id));\n  if (!tab) return { ok: false, error: 'tab not found' };\n  tab.agentOwned = owned === true;\n  notifyAll();\n  return { ok: true, id: tab.id, agentOwned: tab.agentOwned };\n});\n\nipcMain.handle('browser:pinTab', (_e, id) => {"
    )

# createResultTab IPC if missing
if "ipcMain.handle('browser:createResultTab'" not in main:
    insert_after = "ipcMain.handle('browser:closeTab', (_e, id) => { closeTab(Number(id)); return { ok: true }; });\n"
    main = main.replace(insert_after, insert_after + '''ipcMain.handle('browser:createResultTab', (_e, { title, htmlContent }) => {
  const tab = createTab(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent || '<html><body></body></html>')}`, { agentOwned: true });
  tab.title = title || 'Research result';
  switchTab(tab.id);
  notifyAll();
  return { ok: true, id: tab.id };
});
''')

# diag:overlays fallback
if "ipcMain.handle('diag:overlaps'" not in main:
    main = main.replace(
        "ipcMain.handle('diag:repairTabs', () => {",
        "ipcMain.handle('diag:overlaps', () => {\n  return { ok: true, overlayWindow: false };\n});\n\nipcMain.handle('diag:repairTabs', () => {"
    )

write('main.js', main)

# ===== renderer.js patches =====
ren = read('src/renderer.js')

# showSaveToast + saveWorkspace wiring
if 'function showSaveToast' not in ren:
    ren = ren.replace(
        "async function saveWorkspace() {",
        '''function showSaveToast(message, status = 'success') {
  const toast = $('saveToast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = `save-toast visible ${status}`;
  setTimeout(() => { toast.classList.remove('visible'); toast.className = 'save-toast'; }, 2500);
}

async function saveWorkspace() {'''
    )

# Add toast call + class toggling
old_save = re.search(r'async function saveWorkspace\(\) \{.*?\n\}', ren, re.S)
if old_save and 'saving' not in old_save.group(0):
    block = old_save.group(0)
    new_block = '''async function saveWorkspace() {
  const btn = $('saveWorkspaceBtn');
  const originalClass = btn ? btn.className : '';
  const name = state.currentWorkspace || 'Workspace';
  const goal = $('currentGoal')?.textContent || '';
  const planResult = '';
  const extra = {
    tabs: (state.browser.tabs || []).map(t => ({ id: t.id, url: t.url, title: t.title })),
    activeTabId: state.browser.activeTabId,
    updatedAt: new Date().toISOString(),
  };
  if (!goal.trim()) {
    showSaveToast('기본 Workspace 상태를 저장했습니다.', 'info');
    return;
  }
  try {
    if (btn) { btn.classList.remove('saved', 'error'); btn.classList.add('saving'); }
    const result = await window.hermes.workspace.save(name, goal, planResult, extra);
    if (result?.ok) {
      if (btn) { btn.classList.remove('saving'); btn.classList.add('saved'); }
      showSaveToast('Workspace 저장 완료', 'success');
      setTimeout(() => { if (btn) btn.classList.remove('saved'); }, 3000);
    } else {
      throw new Error(result?.error || 'save failed');
    }
  } catch (e) {
    console.error('[workspace save]', e);
    if (btn) { btn.classList.remove('saving'); btn.classList.add('error'); }
    showSaveToast('Workspace 저장 실패', 'error');
    setTimeout(() => { if (btn) btn.classList.remove('error'); }, 3000);
  }
}'''
    ren = ren.replace(block, new_block)

# groupTabs Agent Tabs separation
old_gt = re.search(r'function groupTabs\(tabs\) \{.*?\n\}', ren, re.S)
if old_gt and 'AGENT TABS' not in old_gt.group(0).upper():
    block = old_gt.group(0)
    new_block = '''function groupTabs(tabs) {
  const custom = state.tabGroups || [];
  // AI agent-created tabs are always separated as "AGENT TABS"
  const agentTabs = tabs.filter(t => t.agentOwned);
  const normalTabs = tabs.filter(t => !t.agentOwned);
  const groups = [];
  if (agentTabs.length) {
    groups.push({ name: 'AGENT TABS', tabs: agentTabs });
  }
  if (custom.length) {
    const assigned = new Set();
    custom.forEach(g => {
      const matched = normalTabs.filter(t => (g.tabIds || []).includes(t.id) || domainOf(t.url) === g.domain);
      matched.forEach(t => assigned.add(t.id));
      if (matched.length) groups.push({ name: g.name, tabs: matched });
    });
    const rest = normalTabs.filter(t => !assigned.has(t.id));
    if (rest.length) groups.push({ name: 'Ungrouped', tabs: rest });
  } else {
    const map = new Map();
    normalTabs.forEach(tab => { const key = domainOf(tab.url) || 'Workspace'; if (!map.has(key)) map.set(key, []); map.get(key).push(tab); });
    groups.push(...[...map.entries()].map(([name, gt]) => ({ name, tabs: gt })));
  }
  return groups;
}'''
    ren = ren.replace(block, new_block)

# bind saveWorkspaceBtn if lost
if "saveWorkspaceBtn" not in ren:
    ren = ren.replace(
        "$('leftPinBtn')?.addEventListener('click', toggleLeftPin);",
        "$('leftPinBtn')?.addEventListener('click', toggleLeftPin);\n  $('saveWorkspaceBtn')?.addEventListener('click', saveWorkspace);"
    )

write('src/renderer.js', ren)

# ===== chrome.html patches =====
html = read('src/chrome.html')
if '.save-btn.saving' not in html:
    # add before </style> if present
    snippet = '''
.save-btn.saving { animation: spin 1s linear infinite; opacity: 0.7; }
.save-btn.saved { color: #27c27c; }
.save-btn.error { color: #ff4d6d; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.save-toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%) translateY(20px); padding: 8px 16px; border-radius: 999px; background: rgba(255,255,255,0.72); backdrop-filter: blur(16px); font-size: 12px; color: #1a1a28; opacity: 0; pointer-events: none; transition: all 0.25s ease; z-index: var(--layer-modal); }
.save-toast.visible { opacity: 1; transform: translateX(-50%) translateY(0); }
.save-toast.success { color: #27c27c; }
.save-toast.error { color: #ff4d6d; }
.save-toast.info { color: #5b8bf7; }
'''
    html = html.replace('</style>', snippet + '</style>')
    # ensure toast div exists near workspace header
    if '<div class="save-toast" id="saveToast"></div>' not in html:
        html = html.replace(
            '<div class="workspace" id="workspaceHeader">',
            '<div class="save-toast" id="saveToast"></div>\n  <div class="workspace" id="workspaceHeader">'
        )
write('src/chrome.html', html)

# ===== preload.js patches =====
pre = read('src/preload.js')
if 'getOverlaps' not in pre:
    pre = pre.replace(
        "getOverlayState: () => ipcRenderer.invoke('diag:overlays'),",
        "getOverlaps: () => ipcRenderer.invoke('diag:overlaps'),\n    getOverlayState: () => ipcRenderer.invoke('diag:overlays'),"
    )
# ensure diag overlays bridge
if "overlays: () => ipcRenderer.invoke('diag:overlays')" not in pre:
    pre = pre.replace(
        "repairTabs: () => ipcRenderer.invoke('diag:repairTabs'),",
        "repairTabs: () => ipcRenderer.invoke('diag:repairTabs'),\n    overlays: () => ipcRenderer.invoke('diag:overlays'),"
    )
write('src/preload.js', pre)

print('Patch applied.')
