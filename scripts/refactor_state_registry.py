from pathlib import Path

p = Path(__file__).resolve().parents[1] / 'main.js'
s = p.read_text(encoding='utf-8')

def must_replace(text, old, new, label):
    if old not in text:
        raise SystemExit(f'MISSING {label}')
    return text.replace(old, new, 1)

s = must_replace(s, """function writeJsonFile(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
""", """function writeJsonFile(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
function atomicWriteJson(file, data) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}
function nowIso() { return new Date().toISOString(); }
""", 'atomic helpers')

s = must_replace(s, """function getActiveTab() { return tabs.find(t => t.id === activeTabId) || null; }
function getActiveView() { return getActiveTab()?.view || null; }
function visibleTabs() { return tabs.map(({ id, url, title, loading, pinned }) => ({ id, url, title, loading: !!loading, pinned: !!pinned })); }
function send(channel, payload) { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload); }
""", """function getActiveTab() { return tabs.find(t => t.id === activeTabId && t.view && !t.view.webContents.isDestroyed()) || null; }
function getActiveView() { return getActiveTab()?.view || null; }
function serializeTab(tab) {
  const wc = tab?.view?.webContents;
  const destroyed = !wc || wc.isDestroyed();
  return {
    id: tab.id,
    tabId: tab.tabId || tab.id,
    viewId: tab.viewId || null,
    webContentsId: destroyed ? null : wc.id,
    title: tab.title || 'New Tab',
    url: tab.url || '',
    favicon: tab.favicon || '',
    loading: !!tab.loading,
    canGoBack: destroyed ? false : canGoBack(wc),
    canGoForward: destroyed ? false : canGoForward(wc),
    zoomFactor: destroyed ? (tab.zoomFactor || 1) : wc.getZoomFactor(),
    groupId: tab.groupId || '',
    createdBy: tab.createdBy || (tab.agentOwned ? 'ai' : 'user'),
    agentOwned: !!tab.agentOwned,
    workspaceId: tab.workspaceId || '',
    isActive: tab.id === activeTabId,
    pinned: !!tab.pinned,
    domain: tab.domain || '',
    createdAt: tab.createdAt || '',
    lastActivatedAt: tab.lastActivatedAt || '',
  };
}
function visibleTabs() { return sanitizeTabs('visibleTabs').map(serializeTab); }
function send(channel, payload) { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload); }
function tabSnapshot() { return sanitizeTabs('snapshot').map(t => { const st = serializeTab(t); delete st.loading; return st; }); }
function sanitizeTabs(reason = 'manual') {
  const seenIds = new Set();
  const seenWc = new Set();
  const removed = [];
  tabs = tabs.filter(tab => {
    const wc = tab?.view?.webContents;
    const invalid = !tab || seenIds.has(tab.id) || !tab.view || !wc || wc.isDestroyed();
    const wcId = !invalid ? wc.id : null;
    const duplicateWc = wcId && seenWc.has(wcId);
    if (invalid || duplicateWc) {
      removed.push({ id: tab?.id, reason: invalid ? 'invalid-or-duplicate-tab-id' : 'duplicate-webContents', webContentsId: wcId });
      try { if (tab?.view) mainWindow?.contentView?.removeChildView(tab.view); } catch {}
      try { if (wc && !wc.isDestroyed()) wc.close(); } catch {}
      return false;
    }
    seenIds.add(tab.id); seenWc.add(wcId);
    return true;
  });
  if (!tabs.some(t => t.id === activeTabId)) activeTabId = tabs[0]?.id || null;
  tabs.forEach(t => { t.isActive = t.id === activeTabId; });
  if (removed.length) console.warn('[tab-registry] sanitized', reason, JSON.stringify(removed));
  return tabs;
}
function closeAllTabs({ createDefault = true } = {}) {
  const old = [...tabs];
  tabs = [];
  activeTabId = null;
  agentTabIds.clear();
  for (const tab of old) {
    try { mainWindow?.contentView?.removeChildView(tab.view); } catch {}
    try { if (!tab.view?.webContents?.isDestroyed()) tab.view.webContents.close(); } catch {}
  }
  if (createDefault) createTab('https://www.google.com', true, { createdBy: 'user' });
  else notifyAll();
}
function getTabDiagnostics() {
  sanitizeTabs('diag');
  const serialized = tabs.map(serializeTab);
  const wcIds = serialized.map(t => t.webContentsId).filter(Boolean);
  const issues = [];
  const ids = serialized.map(t => t.id);
  const activeCount = serialized.filter(t => t.isActive).length;
  if (new Set(ids).size !== ids.length) issues.push('duplicate-tab-id');
  if (new Set(wcIds).size !== wcIds.length) issues.push('duplicate-webContentsId');
  if (activeCount !== (serialized.length ? 1 : 0)) issues.push(`active-count-${activeCount}`);
  const active = getActiveTab();
  const b = browserBounds();
  for (const tab of tabs) {
    const bounds = tab.view.getBounds ? tab.view.getBounds() : null;
    const shouldVisible = tab.id === activeTabId;
    if (bounds && shouldVisible && (Math.abs(bounds.x - b.x) > 2 || Math.abs(bounds.y - b.y) > 2)) issues.push(`active-bounds-mismatch-${tab.id}`);
    if (bounds && !shouldVisible && bounds.x > -1000) issues.push(`inactive-visible-${tab.id}`);
  }
  return { ok: issues.length === 0, issues, tabCount: serialized.length, webContentsCount: wcIds.length, activeTabId, activeWebContentsId: active?.view?.webContents?.id || null, browserBounds: b, tabs: serialized };
}
""", 'tab helpers')

s = must_replace(s, """function createWindow() {
  mainWindow = new BrowserWindow({""", """function createWindow() {
  const uiPrefs = readJsonFile(userDataPath('ui-state.json'), {});
  leftPanelVisible = uiPrefs.leftPinned === true;
  sidePanelVisible = uiPrefs.rightPanelVisible !== false;
  mainWindow = new BrowserWindow({""", 'createWindow prefs')

s = must_replace(s, """  mainWindow.on('close', () => {
    const session = tabs.map(t => ({ url: t.url, title: t.title, pinned: !!t.pinned }));
    try { fs.writeFileSync(userDataPath('session.json'), JSON.stringify(session, null, 2)); } catch {}
  });""", """  mainWindow.on('close', () => {
    try { atomicWriteJson(userDataPath('session.json'), { savedAt: nowIso(), activeTabId, tabs: tabSnapshot() }); } catch {}
    try { atomicWriteJson(userDataPath('ui-state.json'), { leftPinned: leftPanelVisible, rightPanelVisible: sidePanelVisible, updatedAt: nowIso() }); } catch {}
  });""", 'close atomic')

s = must_replace(s, """function layoutAllViews() {
  const active = getActiveTab();
  for (const tab of tabs) {""", """function layoutAllViews() {
  sanitizeTabs('layout');
  const active = getActiveTab();
  for (const tab of tabs) {""", 'layout sanitize')

start = s.index("function createTab(url = 'https://www.google.com'")
end = s.index("function canGoBack", start)
new_block = r'''function createTab(url = 'https://www.google.com', activate = true, meta = {}) {
  sanitizeTabs('before-create');
  const id = nextTabId++;
  const normalized = normalizeUrl(url);
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: `persist:hermes-tab-${id}`,
    },
  });
  const createdBy = meta.createdBy || (meta.agentOwned ? 'ai' : 'user');
  const now = nowIso();
  const tab = {
    id, tabId: id, viewId: `view-${id}`,
    url: normalized, title: meta.title || 'New Tab', favicon: meta.favicon || '',
    loading: false, domain: '', pinned: !!meta.pinned,
    groupId: meta.groupId || '', agentOwned: createdBy === 'ai' || !!meta.agentOwned,
    createdBy, workspaceId: meta.workspaceId || '', isActive: false,
    createdAt: meta.createdAt || now, lastActivatedAt: activate ? now : (meta.lastActivatedAt || ''),
    zoomFactor: meta.zoomFactor || 1, view,
  };
  if (tab.agentOwned) agentTabIds.add(id);
  tabs.push(tab);
  mainWindow.contentView.addChildView(view);

  view.webContents.setUserAgent(DESKTOP_UA);
  try {
    const domain = new URL(tab.url).hostname.replace(/^www\./, '');
    tab.domain = domain;
    if (domainZoom[domain]) view.webContents.setZoomFactor(domainZoom[domain]);
    else if (tab.zoomFactor) view.webContents.setZoomFactor(tab.zoomFactor);
  } catch {}

  view.webContents.on('page-favicon-updated', (_e, favicons) => {
    tab.favicon = Array.isArray(favicons) ? favicons[0] || '' : '';
    notifyAll();
  });
  view.webContents.on('did-start-loading', () => {
    tab.loading = true;
    notifyAll();
  });
  view.webContents.on('did-stop-loading', () => {
    tab.loading = false;
    tab.url = view.webContents.getURL() || tab.url;
    tab.title = view.webContents.getTitle() || tab.url;
    tab.zoomFactor = view.webContents.getZoomFactor();
    notifyAll();
    if (tab.id === activeTabId) {
      extractPageContext().catch(() => null);
      setTimeout(() => {
        if (view.webContents.isDestroyed()) return;
        view.webContents.executeJavaScript(`({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })`, true)
          .then(info => {
            if (info && info.sw > info.cw + 20 && info.sw > 800) {
              const viewW = browserBounds().width;
              const fit = Math.max(0.5, Math.min(0.95, (viewW / info.sw) * (view.webContents.getZoomFactor() || 1)));
              if (fit < 0.98) {
                view.webContents.setZoomFactor(fit);
                tab.zoomFactor = fit;
                console.log(`[auto-fit] ${tab.domain || ''} scroll=${info.sw} client=${info.cw} zoom=${fit.toFixed(3)}`);
                notifyAll();
              }
            }
          }).catch(() => {});
      }, 1000);
    }
  });
  view.webContents.on('did-navigate', (_e, nextUrl) => {
    tab.url = nextUrl;
    try { tab.domain = new URL(nextUrl).hostname.replace(/^www\./, ''); } catch {}
    historyList.unshift({ url: nextUrl, title: tab.title, tabId: tab.id, ts: nowIso() });
    historyList = historyList.slice(0, 500);
    notifyAll();
  });
  view.webContents.on('did-navigate-in-page', (_e, nextUrl) => { tab.url = nextUrl; notifyAll(); });
  view.webContents.on('render-process-gone', (_e, details) => {
    console.warn('[tab-registry] render-process-gone', tab.id, details?.reason || 'unknown');
    tab.loading = false;
    tab.crashed = true;
    notifyAll();
  });
  view.webContents.on('destroyed', () => {
    if (!tabs.some(t => t.id === tab.id)) return;
    console.warn('[tab-registry] webContents destroyed', tab.id);
    tabs = tabs.filter(t => t.id !== tab.id);
    agentTabIds.delete(tab.id);
    if (activeTabId === tab.id) activeTabId = tabs[0]?.id || null;
    notifyAll();
  });
  view.webContents.setWindowOpenHandler(({ url: target }) => {
    createTab(target, true, { createdBy: 'user', groupId: tab.groupId, workspaceId: tab.workspaceId });
    return { action: 'deny' };
  });

  if (activate) switchTab(id);
  else layoutAllViews();
  view.webContents.loadURL(tab.url);
  logAction('openTab', { url: tab.url, createdBy }, { ok: true, tabId: id });
  notifyAll();
  return tab;
}
function switchTab(id) {
  sanitizeTabs('switch');
  const tab = tabs.find(t => t.id === Number(id));
  if (!tab) return null;
  activeTabId = tab.id;
  tab.lastActivatedAt = nowIso();
  tabs.forEach(t => { t.isActive = t.id === activeTabId; });
  layoutAllViews();
  notifyAll();
  extractPageContext().catch(() => null);
  return tab;
}
function closeTab(id) {
  id = Number(id);
  sanitizeTabs('before-close');
  const idx = tabs.findIndex(t => t.id === id);
  if (idx < 0) return false;
  const [tab] = tabs.splice(idx, 1);
  agentTabIds.delete(id);
  try { mainWindow.contentView.removeChildView(tab.view); } catch {}
  try { if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close(); } catch {}
  if (activeTabId === id) activeTabId = tabs[Math.max(0, idx - 1)]?.id || tabs[0]?.id || null;
  tabs.forEach(t => { t.isActive = t.id === activeTabId; });
  if (tabs.length === 0) createTab('https://www.google.com', true, { createdBy: 'user' });
  else layoutAllViews();
  notifyAll();
  logAction('closeTab', { id }, { ok: true });
  return true;
}
'''
s = s[:start] + new_block + s[end:]

s = must_replace(s, """function notifyAll() {
  const active = getActiveTab();
  const wc = active?.view.webContents;
  send('browser-state', {
    tabs: visibleTabs(),
    activeTabId,
    activeUrl: active?.url || '',
    activeTitle: active?.title || 'Hermes Browser',
    canGoBack: canGoBack(wc),
    canGoForward: canGoForward(wc),
  });
}
""", """function notifyAll() {
  sanitizeTabs('notify');
  const active = getActiveTab();
  const wc = active?.view.webContents;
  send('browser-state', {
    tabs: visibleTabs(),
    activeTabId,
    activeUrl: active?.url || '',
    activeTitle: active?.title || 'Hermes Browser',
    canGoBack: canGoBack(wc),
    canGoForward: canGoForward(wc),
    sidePanelVisible,
    leftPanelVisible,
    leftPinned: leftPanelVisible,
    diagnostics: getTabDiagnostics(),
  });
}
""", 'notifyAll')

s = must_replace(s, """      case 'searchWeb':
      case 'search': {
        const q = encodeURIComponent(params.query || '');
        if (!q) { result = { ok: false, error: 'empty query' }; break; }
        const engine = params.engine === 'naver' ? 'https://search.naver.com/search.naver?query=' : params.engine === 'bing' ? 'https://www.bing.com/search?q=' : 'https://www.google.com/search?q=';
        const searchUrl = engine + q;
        view.webContents.loadURL(searchUrl);
        await waitForLoad(view);
        const finalUrl = view.webContents.getURL();
        result = { ok: true, query: params.query, url: finalUrl };
        break;
      }
""", """      case 'searchWeb':
      case 'search': {
        const q = encodeURIComponent(params.query || '');
        if (!q) { result = { ok: false, error: 'empty query' }; break; }
        const engine = params.engine === 'naver' ? 'https://search.naver.com/search.naver?query=' : params.engine === 'bing' ? 'https://www.bing.com/search?q=' : 'https://www.google.com/search?q=';
        const searchUrl = engine + q;
        let targetTab = getActiveTab();
        if (params.newTab || params.createdBy === 'ai') {
          targetTab = createTab(searchUrl, true, { createdBy: 'ai', groupId: params.groupId || 'agent-search', workspaceId: params.workspaceId || '' });
        } else {
          targetTab.view.webContents.loadURL(searchUrl);
        }
        await waitForLoad(targetTab.view);
        const finalUrl = targetTab.view.webContents.getURL();
        result = { ok: true, query: params.query, url: finalUrl, tabId: targetTab.id, webContentsId: targetTab.view.webContents.id };
        break;
      }
""", 'search action')

s = must_replace(s, """ipcMain.handle('search:readUrl', async (_e, url) => {
  // Open URL in a temporary background tab, read content, close tab
  const tab = createTab(url, false);
  await waitForLoad(tab.view);
  await new Promise(r => setTimeout(r, 500)); // brief settle
  const content = await readPageContent(tab.view, 12000);
  closeTab(tab.id);
  return content;
});
""", """ipcMain.handle('search:readUrl', async (_e, url, opts = {}) => {
  // Agent reading must be visible and registry-backed. Keep tab unless caller explicitly asks cleanup later.
  const tab = createTab(url, opts.activate !== false, { createdBy: 'ai', agentOwned: true, groupId: opts.groupId || 'agent-search', workspaceId: opts.workspaceId || '' });
  await waitForLoad(tab.view);
  await new Promise(r => setTimeout(r, 500));
  const content = await readPageContent(tab.view, 12000);
  return { ...content, tabId: tab.id, webContentsId: tab.view.webContents.id, kept: true };
});
""", 'search readUrl')

s = must_replace(s, """ipcMain.handle('browser:getState', () => ({ tabs: visibleTabs(), activeTabId, sidePanelVisible }));""", """ipcMain.handle('browser:getState', () => ({ tabs: visibleTabs(), activeTabId, sidePanelVisible, leftPanelVisible, leftPinned: leftPanelVisible, diagnostics: getTabDiagnostics() }));
ipcMain.handle('diag:state', () => getTabDiagnostics());
ipcMain.handle('diag:repairTabs', () => { const before = getTabDiagnostics(); sanitizeTabs('manual-repair'); layoutAllViews(); const after = getTabDiagnostics(); notifyAll(); return { ok: after.ok, before, after }; });""", 'getState diag')

s = must_replace(s, """ipcMain.handle('browser:toggleLeftPanel', () => {
  leftPanelVisible = !leftPanelVisible;
  layoutAllViews();
  return leftPanelVisible;
});
""", """ipcMain.handle('browser:toggleLeftPanel', (_e, pinned) => {
  leftPanelVisible = typeof pinned === 'boolean' ? pinned : !leftPanelVisible;
  try { atomicWriteJson(userDataPath('ui-state.json'), { leftPinned: leftPanelVisible, rightPanelVisible: sidePanelVisible, updatedAt: nowIso() }); } catch {}
  layoutAllViews();
  notifyAll();
  return leftPanelVisible;
});
""", 'toggle left')

s = must_replace(s, """ipcMain.handle('browser:toggleRightPanel', () => {
  sidePanelVisible = !sidePanelVisible;
  layoutAllViews();
  return sidePanelVisible;
});
""", """ipcMain.handle('browser:toggleRightPanel', () => {
  sidePanelVisible = !sidePanelVisible;
  try { atomicWriteJson(userDataPath('ui-state.json'), { leftPinned: leftPanelVisible, rightPanelVisible: sidePanelVisible, updatedAt: nowIso() }); } catch {}
  layoutAllViews();
  notifyAll();
  return sidePanelVisible;
});
""", 'toggle right')

start = s.index("// === Phase 3: Workspace, auto-grouping, research results ===")
end = s.index("// Auto-group tabs by domain", start)
new = r'''// === Phase 3: Workspace, auto-grouping, research results ===
ipcMain.handle('workspace:save', (_e, name, goal, planResult, extra = {}) => {
  const dir = userDataPath('workspaces');
  ensureDir(dir);
  const id = extra.id || `${Date.now()}`;
  const file = path.join(dir, `${id}.json`);
  const prev = readJsonFile(file, {});
  const now = nowIso();
  const ws = {
    id,
    name: name || prev.name || `Workspace ${String(id).slice(-4)}`,
    createdAt: prev.createdAt || now,
    updatedAt: now,
    goal: goal || '',
    currentGoal: goal || '',
    plan: Array.isArray(planResult) ? planResult : (planState.steps || []),
    planState: { ...planState, steps: Array.isArray(planResult) ? planResult : (planState.steps || []) },
    activeTabId,
    tabs: tabSnapshot(),
    tabGroups: extra.tabGroups || prev.tabGroups || [],
    findings: extra.findings || prev.findings || [],
    sources: extra.sources || prev.sources || [],
    chat: extra.chat || prev.chat || [],
    notes: extra.notes || prev.notes || '',
    memory: extra.memory || prev.memory || {},
    ui: { leftPinned: leftPanelVisible, rightPanelVisible: sidePanelVisible },
  };
  atomicWriteJson(file, ws);
  return { ok: true, path: file, ...ws };
});
ipcMain.handle('workspace:list', () => {
  const dir = userDataPath('workspaces');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; }
  }).filter(Boolean).sort((a, b) => new Date(b.updatedAt || b.savedAt || 0) - new Date(a.updatedAt || a.savedAt || 0));
});
ipcMain.handle('workspace:restore', (_e, id) => {
  const dir = userDataPath('workspaces');
  const file = path.join(dir, `${id}.json`);
  if (!fs.existsSync(file)) return { ok: false, error: 'workspace not found' };
  const ws = JSON.parse(fs.readFileSync(file, 'utf8'));
  closeAllTabs({ createDefault: false });
  const idMap = new Map();
  for (const t of (ws.tabs || [])) {
    const tab = createTab(t.url, false, { title: t.title, pinned: !!t.pinned, createdBy: t.createdBy || 'user', agentOwned: t.createdBy === 'ai' || !!t.agentOwned, groupId: t.groupId || '', workspaceId: ws.id, createdAt: t.createdAt, lastActivatedAt: t.lastActivatedAt, zoomFactor: t.zoomFactor || 1 });
    idMap.set(t.id, tab.id);
  }
  const desired = idMap.get(ws.activeTabId) || tabs[0]?.id;
  if (desired) switchTab(desired);
  if (!tabs.length) createTab('https://www.google.com', true, { workspaceId: ws.id });
  sanitizeTabs('workspace-restore');
  notifyAll();
  return { ok: true, path: file, restoredTabs: tabs.length, activeTabId, ...ws };
});
ipcMain.handle('workspace:delete', (_e, id) => {
  const file = path.join(userDataPath('workspaces'), `${id}.json`);
  try { fs.unlinkSync(file); return { ok: true, path: file }; } catch (e) { return { ok: false, error: e.message, path: file }; }
});

'''
s = s[:start] + new + s[end:]

s = must_replace(s, """ipcMain.handle('browser:saveSession', () => {
  const session = tabs.map(t => ({ url: t.url, title: t.title, pinned: !!t.pinned }));
  try { fs.writeFileSync(userDataPath('session.json'), JSON.stringify(session, null, 2)); } catch {}
  return { ok: true, count: session.length };
});
ipcMain.handle('browser:restoreSession', () => {
  const p = userDataPath('session.json');
  if (!fs.existsSync(p)) return { ok: false, error: 'no session' };
  const data = safeJson(fs.readFileSync(p, 'utf8'), []);
  if (!Array.isArray(data) || !data.length) return { ok: false, error: 'empty' };
  for (const t of data) createTab(t.url, false);
  if (data[0]) switchTab(tabs[0]?.id || 1);
  return { ok: true, count: data.length };
});
""", """ipcMain.handle('browser:saveSession', () => {
  const session = { savedAt: nowIso(), activeTabId, tabs: tabSnapshot(), ui: { leftPinned: leftPanelVisible, rightPanelVisible: sidePanelVisible } };
  try { atomicWriteJson(userDataPath('session.json'), session); } catch (e) { return { ok: false, error: e.message }; }
  return { ok: true, count: session.tabs.length, path: userDataPath('session.json') };
});
ipcMain.handle('browser:restoreSession', () => {
  const p = userDataPath('session.json');
  if (!fs.existsSync(p)) return { ok: false, error: 'no session' };
  const data = safeJson(fs.readFileSync(p, 'utf8'), []);
  const entries = Array.isArray(data) ? data : (Array.isArray(data.tabs) ? data.tabs : []);
  if (!entries.length) return { ok: false, error: 'empty' };
  closeAllTabs({ createDefault: false });
  const idMap = new Map();
  for (const t of entries) {
    const tab = createTab(t.url, false, { title: t.title, pinned: !!t.pinned, createdBy: t.createdBy || 'user', agentOwned: t.createdBy === 'ai' || !!t.agentOwned, groupId: t.groupId || '', workspaceId: t.workspaceId || '', createdAt: t.createdAt, lastActivatedAt: t.lastActivatedAt, zoomFactor: t.zoomFactor || 1 });
    idMap.set(t.id, tab.id);
  }
  const desired = idMap.get(data.activeTabId) || tabs[0]?.id;
  if (desired) switchTab(desired);
  if (!tabs.length) createTab('https://www.google.com', true);
  notifyAll();
  return { ok: true, count: tabs.length, activeTabId };
});
""", 'session handlers')

p.write_text(s, encoding='utf-8')
print('patched main.js', len(s))
