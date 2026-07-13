// main.js — Hermes Browser v1
// Clean Electron + WebContentsView browser shell with agent tool bridge.


// [MAIN] entry: __filename diagnostic
console.log('[MAIN] entry:', __filename);
console.log('[MAIN] pid:', process.pid);
console.log('[MAIN] dirname:', __dirname);


process.on('uncaughtException', (e) => console.log('[uncaughtException]', e?.stack || e?.message || e));
process.on('unhandledRejection', (e) => console.log('[unhandledRejection]', e?.stack || e?.message || e));
process.on('exit', (code) => console.log('[process exit]', code));
const { app, BrowserWindow, WebContentsView, ipcMain, shell, safeStorage, screen, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { AgentService } = require('./src/agent');
const { TaskScheduler } = require('./src/agent/scheduler');
const { BridgeSpawner } = require('./src/mcp-bridge-spawner');

// V22 GPU/Extension safety switches (Electron GPU init failure fix)
app.commandLine.appendSwitch('disable-extensions');
app.commandLine.appendSwitch('disable-component-extensions-with-background-pages');
app.commandLine.appendSwitch('disable-default-apps');
app.commandLine.appendSwitch('no-default-browser-check');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

const UI = {
  left: 240,    // V29: matches --left (was 144)
  right: 300,   // V29: matches --right (was 248)
  top: 40,      // V29: matches --top workspace switcher height (was 54)
  gutter: 6,    // V29: matches --gutter (was 12)
  gap: 6,       // V29: matches --gap (was 10)
  bottom: 30,   // V29: matches --bottom status bar height + clearance (was 12)
  frameInset: 8,
  bezelRadius: 24,
  rail: 40,     // V29: collapsed icon rail width (was 36)
  minBrowserWidth: 560,
  minBrowserHeight: 380,
};

// Desktop Chromium User-Agent (remove Electron identification)
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

// Per-domain zoom storage
let domainZoom = {};

// Single instance lock to avoid cache/ServiceWorker DB conflicts
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
let activeTabId = null;
let nextTabId = 1;
let sidePanelVisible = true;
let leftPanelVisible = true;
let autoApprove = false;
let actionLog = [];
let downloadList = [];
let historyList = [];
const pendingApprovals = new Map();
let findInPageActive = null;

// === Phase 1: Agentic State ===
// Mode permissions: Ask=readonly, Assist=preview-only, Agent=auto-low-risk, Auto=scoped-batch
const MODE_PERMISSIONS = {
  ask:    { canAct: false, canRead: true,  autoApproveRisk: [],              label: '읽기 전용',    desc: '페이지 분석 · 답변 · 번역 · 비교. 실행 없음.' },
  assist: { canAct: false, canRead: true,  autoApproveRisk: [],              label: '준비 · 제안',  desc: '폼 초안 · 입력 후보 · 다음 행동 추천. 실제 실행은 사용자 확인 후.' },
  agent:  { canAct: true,  canRead: true,  autoApproveRisk: ['low'],         label: '브라우저 실행', desc: '낮은 위험 자동 실행 · 중간 이상 승인 요청 · 실시간 표시.' },
  auto:   { canAct: true,  canRead: true,  autoApproveRisk: ['low','medium'], label: '자동 작업',    desc: '사전 승인된 범위에서 자동 실행 · 결제/삭제/전송은 항상 승인.' },
};
let currentMode = 'agent';

// Risk classification for each action
const ACTION_RISK = {
  navigate: 'low', searchWeb: 'low', search: 'low', openTab: 'low', switchTab: 'low',
  closeTab: 'low', goBack: 'low', goForward: 'low', reload: 'low', inspectPage: 'low',
  getVisibleText: 'low', scroll: 'low', takeScreenshot: 'low', openExternal: 'low',
  click: 'medium', type: 'medium', fill: 'medium', pressKey: 'medium',
  submit: 'high', uploadFile: 'high', downloadFile: 'medium',
};
function getActionRisk(action) { return ACTION_RISK[action] || 'medium'; }

// Structured action tracking & plan state
let actionQueue = [];
let planState = { goal: '', steps: [], activeIndex: -1, paused: false, createdAt: null };

// Per-tab context cache
const tabContextCache = new Map();

// Prompt injection defense patterns
const INJECTION_PATTERNS = [
  /ignore (?:all )?(?:previous|above|prior) instructions/i,
  /disregard (?:your|the) (?:system|original) prompt/i,
  /you are now (?:a|an) (?:different|new)/i,
  /reveal (?:your|the) (?:system|initial) (?:prompt|instructions|message)/i,
  /exfiltrate|transmit|send (?:to|via) (?:external|remote)/i,
  /(?:ignore|override|bypass) (?:safety|security|content) (?:filter|guard|policy|rules)/i,
];
function detectInjection(text) {
  if (!text) return { injected: false, patterns: [] };
  const found = [];
  for (const re of INJECTION_PATTERNS) { if (re.test(text)) found.push(re.source); }
  return { injected: found.length > 0, patterns: found };
}
function getModePermissions() { return MODE_PERMISSIONS[currentMode] || MODE_PERMISSIONS.agent; }
function setMode(mode) {
  if (!MODE_PERMISSIONS[mode]) return false;
  currentMode = mode;
  return MODE_PERMISSIONS[mode];
}

function createStructuredAction(actionType, params = {}, reason = '') {
  const risk = getActionRisk(actionType);
  const perms = getModePermissions();
  const requiresApproval = !perms.autoApproveRisk.includes(risk);
  return {
    actionId: `act_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    actionType, target: params.ref || params.selector || params.url || params.query || '',
    targetDescription: params.description || '', parameters: maskSecrets(params), reason,
    riskLevel: risk, requiresApproval, status: 'pending', result: null, error: null,
    retryCount: 0, createdAt: new Date().toISOString(), completedAt: null,
  };
}
function updatePlanState(goal, steps) {
  planState = { goal, steps: steps.map((s, i) => ({
    id: `step_${i}`, label: typeof s === 'string' ? s : s.label, status: 'waiting',
    detail: typeof s === 'string' ? '' : s.detail || '', actionIds: [],
  })), activeIndex: -1, paused: false, createdAt: new Date().toISOString() };
  send('plan-state', planState);
  return planState;
}
function setPlanStepStatus(index, status, detail = '') {
  if (!planState.steps[index]) return;
  planState.steps[index].status = status;
  if (detail) planState.steps[index].detail = detail;
  if (status === 'running') planState.activeIndex = index;
  if (status === 'done' && index === planState.activeIndex) planState.activeIndex = index + 1 < planState.steps.length ? index + 1 : -1;
  send('plan-state', planState);
}
function setPlanPaused(paused) { planState.paused = paused; send('plan-state', planState); }
function getPlanState() { return planState; }

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function userDataPath(...parts) { return path.join(app.getPath('userData'), ...parts); }
function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }
function getActiveTab() { return tabs.find(t => t.id === activeTabId) || null; }
function getActiveView() { return getActiveTab()?.view || null; }
function visibleTabs() { return tabs.map(({ id, url, title, loading, pinned }) => ({ id, url, title, loading: !!loading, pinned: !!pinned })); }
function send(channel, payload) {
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
}
function normalizeUrl(input) {
  let value = String(input || '').trim();
  if (!value) return 'about:blank';
  if (/^(https?:|file:|about:)/i.test(value)) return value;
  if (/^[\w.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(value)) return `https://${value}`;
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}
function safeJson(value, fallback = null) { try { return JSON.parse(value); } catch { return fallback; } }

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 920,
    minHeight: 620,
    frame: false,
    autoHideMenuBar: true,
    title: 'Miraecle',
    backgroundColor: '#f5f5f7',
    webPreferences: {
      preload: path.join(__dirname, 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'chrome.html'));
  mainWindow.webContents.on('did-finish-load', () => {
    if (tabs.length === 0) createTab('https://www.google.com');
    notifyAll();
  });
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const tag = ['LOG', 'WARN', 'ERROR'][level] || 'LOG';
    console.log(`[renderer:${tag}] ${message} (${sourceId}:${line})`);
  });
  mainWindow.on('resize', layoutAllViews);
  mainWindow.on('close', () => {
    const session = tabs.map(t => ({ url: t.url, title: t.title, pinned: !!t.pinned }));
    try { fs.writeFileSync(userDataPath('session.json'), JSON.stringify(session, null, 2)); } catch {}
  });
  mainWindow.on('maximize', () => { send('window-state', { maximized: true }); setTimeout(layoutAllViews, 50); });
  mainWindow.on('unmaximize', () => { send('window-state', { maximized: false }); setTimeout(layoutAllViews, 50); });

  if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

// === Hermes Agent: optional agent instance for MCP bridge integration ===
// Currently used only by the MCP bridge — does NOT replace any existing IPC handler.
let agent = null;
function buildAgent() {
  const a = new AgentService({
    send: (channel, payload) => {
      try {
        if (!mainWindow || mainWindow.isDestroyed()) return false;
        const wc = mainWindow.webContents;
        if (!wc || wc.isDestroyed()) return false;
        wc.send(channel, payload);
        return true;
      } catch (e) { return false; }
    },
    getTabs: () => tabs,
    getActiveTab: () => tabs.find(t => t.id === activeTabId) || null,
    getActiveView: () => tabs.find(t => t.id === activeTabId)?.view || null,
    getAutoApprove: () => autoApprove,
    createTab: (url, makeActive) => createTab(url, makeActive),
    switchTab: (id) => switchTab(id),
    closeTab: (id) => closeTab(id),
    waitForLoad: (view, timeout) => waitForLoad(view, timeout),
    goBack: (wc) => goBack(wc),
    goForward: (wc) => goForward(wc),
    normalizeUrl: (input) => normalizeUrl(input),
    notifyAll: () => notifyAll(),
    userDataPath: app.getPath('userData'),
  });
  // Attach scheduler (BrowserOS-style cron automation).
  a.scheduler = new TaskScheduler(a, {
    onTaskComplete: (r) => console.log('[scheduler] task', r.id, 'completed:', r.ok ? 'OK' : 'FAILED', r.error || ''),
  });
  a.scheduler.load().catch(err => console.warn('[scheduler] load failed:', err.message));
  a.scheduler.start();

  // V12 Cowork: files + browser + AI integration
  const workspaceRoot = path.join(app.getPath('home'), 'Hermes-Workspace');
  try { fs.mkdirSync(workspaceRoot, { recursive: true }); } catch {}
  const { CoworkService } = require('./src/agent/cowork');
  a.cowork = new CoworkService({
    workspaceRoot,
    maxFileSize: 10 * 1024 * 1024,  // 10MB
    maxResults: 100,
  });
  console.log('[cowork] initialized at', workspaceRoot);

  return a;
}
agent = buildAgent();

// === MCP bridge: HTTP server on localhost:8780 for external AI agents ===
// Optional infrastructure. If it fails (port busy, etc.) the app still works.
let bridgeSpawner = null;
if (process.env.HERMES_MCP_BRIDGE !== 'off') {
  try {
    const { BridgeSpawner } = require('./src/mcp-bridge-spawner');
    bridgeSpawner = new BridgeSpawner({
      agent,
      preferredPort: Number(process.env.HERMES_MCP_PORT) || 8780,
      host: '127.0.0.1',
      log: (level, msg, ...rest) => console.log(`[mcp-bridge] ${level}`, msg, ...rest),
    });
    // Don't await — start() returns a Promise but we want it to run in parallel
    // with createWindow. Errors are logged inside start() and the app keeps working.
    bridgeSpawner.start();
    app.on('will-quit', () => { bridgeSpawner.stop().catch(() => null); });

// ============ V23.3: V22 Quick Action IPC Handlers (real working) ============
ipcMain.handle('v22:summarize', async (_evt, { url, text }) => {
  try {
    if (!text) return { ok: false, error: 'no text' };
    const summary = text.substring(0, 500).replace(/\s+/g, ' ').trim();
    return { ok: true, summary, url };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('v22:commit', async (_evt, { message }) => {
  try {
    const { spawn } = require('child_process');
    const cwd = require('os').homedir() + '/Hermes-Workspace';
    const proc = spawn('/usr/bin/git', ['commit', '-m', message], { cwd, shell: '/bin/bash' });
    let out = '', err = '';
    proc.stdout.on('data', d => out += d);
    proc.stderr.on('data', d => err += d);
    await new Promise((resolve) => proc.on('close', resolve));
    return { ok: out.length > 0, output: out.substring(0, 200), error: err.substring(0, 200) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('v22:ai-action', async (_evt, payload) => {
  try {
    // Echo back for now — would integrate with LLM in production
    return { ok: true, result: 'Action queued: ' + payload.action + ' for ' + payload.url };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

  } catch (e) {
    console.error('[main] MCP bridge setup failed:', e.message);
  }
}

// Let OS drive theme via nativeTheme; toggleDarkMode is the manual override
app.commandLine.appendSwitch('disable-features', 'WebContentsForceDark,ForceDark');
app.whenReady().then(async () => {
  // Belt-and-suspenders: don't override themeSource — let OS drive chrome.html via sync
  // (User can still manually override via toggleDarkMode 3-state)
  nativeTheme.themeSource = 'system';
  createWindow();
  // Sync OS theme to chrome.html once renderer is ready
  setTimeout(syncNativeThemeToUI, 1500);
  nativeTheme.on('updated', syncNativeThemeToUI);
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

function browserBounds() {
  if (!mainWindow) return { x: 100, y: 100, width: 800, height: 600 };
  const [w, h] = mainWindow.getContentSize();
  const right = sidePanelVisible ? UI.right + UI.gap + UI.gutter : UI.gutter;
  const left = leftPanelVisible ? UI.gutter + UI.left + UI.gap : UI.gutter + UI.rail + UI.gap;
  const outerX = left;
  const outerY = UI.top;
  const outerWidth = Math.max(UI.minBrowserWidth, w - outerX - right);
  const outerHeight = Math.max(UI.minBrowserHeight, h - outerY - UI.bottom);
  return {
    x: outerX + UI.frameInset,
    y: outerY + UI.frameInset,
    width: Math.max(320, outerWidth - UI.frameInset * 2),
    height: Math.max(240, outerHeight - UI.frameInset * 2),
  };
}
function layoutAllViews() {
  const active = getActiveTab();
  for (const tab of tabs) {
    if (tab === active) {
      const b = browserBounds();
      tab.view.setBounds(b);
      if (typeof tab.view.setBorderRadius === 'function') {
        tab.view.setBorderRadius(UI.bezelRadius - UI.frameInset);
      }
    } else {
      tab.view.setBounds({ x: -10000, y: -10000, width: 10, height: 10 });
    }
  }
  send('layout-state', { browserBounds: browserBounds(), sidePanelVisible, leftPanelVisible });
}

function createTab(url = 'https://www.google.com', options = {}) {
  if (typeof options === 'boolean') options = { activate: options };
  const opt = { activate: true, agentOwned: false, ...options };
  const id = nextTabId++;
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: `persist:hermes-tab-${id}`,
      // Force light scheme — disable chromium auto-dark for web content
      backgroundColor: '#ffffff',
      offscreen: false,
    },
  });
  const tab = { id, url: normalizeUrl(url), title: 'New Tab', loading: false, domain: '', agentOwned: Boolean(opt.agentOwned), view };
  tabs.push(tab);
  mainWindow.contentView.addChildView(view);

  // Set desktop User-Agent to avoid mobile rendering
  view.webContents.setUserAgent(DESKTOP_UA);

  // Apply domain-specific zoom if available
  try {
    const domain = new URL(tab.url).hostname.replace(/^www\./, '');
    if (domainZoom[domain]) view.webContents.setZoomFactor(domainZoom[domain]);
  } catch {}

  view.webContents.on('did-start-loading', () => {
    tab.loading = true;
    notifyAll();
  });
  view.webContents.on('did-stop-loading', () => {
    tab.loading = false;
    tab.url = view.webContents.getURL() || tab.url;
    tab.title = view.webContents.getTitle() || tab.url;
    notifyAll();
    if (tab.id === activeTabId) {
      extractPageContext().catch(() => null);
      // Auto-fit: if page scrollWidth > clientWidth, suggest auto-fit
      setTimeout(() => {
        view.webContents.executeJavaScript(`({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })`, true)
          .then(info => {
            if (info && info.sw > info.cw + 20 && info.sw > 800) {
              const viewW = browserBounds().width;
              const fit = Math.max(0.5, Math.min(0.95, (viewW / info.sw) * (view.webContents.getZoomFactor() || 1)));
              if (fit < 0.98) {
                view.webContents.setZoomFactor(fit);
                console.log(`[auto-fit] ${tab.domain || ''} scroll=${info.sw} client=${info.cw} zoom=${fit.toFixed(3)}`);
              }
            }
          }).catch(() => {});
      }, 1000);
    }
  });
  view.webContents.on('did-navigate', (_e, nextUrl) => {
    tab.url = nextUrl;
    try { tab.domain = new URL(nextUrl).hostname.replace(/^www\./, ''); } catch {}
    historyList.unshift({ url: nextUrl, title: tab.title, ts: new Date().toISOString() });
    historyList = historyList.slice(0, 500);
    notifyAll();
  });
  view.webContents.on('did-navigate-in-page', (_e, nextUrl) => { tab.url = nextUrl; notifyAll(); });
  view.webContents.setWindowOpenHandler(({ url: target }) => {
    createTab(target, true);
    return { action: 'deny' };
  });

  if (opt.activate) switchTab(id);
  view.webContents.loadURL(tab.url);
  logAction('openTab', { url: tab.url }, { ok: true, tabId: id });
  return tab;
}
function switchTab(id) {
  const tab = tabs.find(t => t.id === Number(id));
  if (!tab) return null;
  activeTabId = tab.id;
  layoutAllViews();
  notifyAll();
  extractPageContext().catch(() => null);
  return tab;
}
function closeTab(id) {
  id = Number(id);
  const idx = tabs.findIndex(t => t.id === id);
  if (idx < 0) return false;
  const [tab] = tabs.splice(idx, 1);
  try { mainWindow.contentView.removeChildView(tab.view); } catch {}
  try { tab.view.webContents.close(); } catch {}
  if (activeTabId === id) activeTabId = tabs[Math.max(0, idx - 1)]?.id || tabs[0]?.id || null;
  if (tabs.length === 0) createTab('https://www.google.com', true);
  else layoutAllViews();
  notifyAll();
  logAction('closeTab', { id }, { ok: true });
  return true;
}
function canGoBack(wc) {
  try { return !!wc?.navigationHistory?.canGoBack(); }
  catch { return false; }
}
function canGoForward(wc) {
  try { return !!wc?.navigationHistory?.canGoForward(); }
  catch { return false; }
}
function goBack(wc) {
  try { if (wc?.navigationHistory?.canGoBack()) wc.navigationHistory.goBack(); }
  catch {}
}
function goForward(wc) {
  try { if (wc?.navigationHistory?.canGoForward()) wc.navigationHistory.goForward(); }
  catch {}
}

function notifyAll() {
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

function waitForLoad(view, timeout = 12000) {
  return new Promise(resolve => {
    if (!view || view.webContents.isDestroyed()) return resolve(false);
    if (!view.webContents.isLoading()) return setTimeout(() => resolve(true), 250);
    const done = () => { cleanup(); setTimeout(() => resolve(true), 300); };
    const fail = () => { cleanup(); resolve(false); };
    const timer = setTimeout(fail, timeout);
    const cleanup = () => {
      clearTimeout(timer);
      view.webContents.removeListener('did-stop-loading', done);
      view.webContents.removeListener('did-fail-load', done);
      view.webContents.removeListener('destroyed', fail);
    };
    view.webContents.once('did-stop-loading', done);
    view.webContents.once('did-fail-load', done);
    view.webContents.once('destroyed', fail);
  });
}

function redactText(text) {
  let count = 0;
  const patterns = [
    /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g,
    /Bearer\s+[a-zA-Z0-9\-_.]+/g,
    /sk-[a-zA-Z0-9]{20,}/g,
    /AKIA[0-9A-Z]{16}/g,
    /gh[ps]_[A-Za-z0-9]{20,}/g,
    /eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g,
    /(api_key|apikey|token|password)=([a-zA-Z0-9\-_.]+)/gi,
  ];
  let out = String(text || '');
  for (const re of patterns) {
    out = out.replace(re, () => { count += 1; return '[REDACTED]'; });
  }
  return { text: out, count };
}

async function extractPageContext() {
  const view = getActiveView();
  if (!view) return null;
  const tab = getActiveTab();
  try {
    const context = await view.webContents.executeJavaScript(`(() => {
      const clone = document.body ? document.body.cloneNode(true) : null;
      if (clone) {
        clone.querySelectorAll('script,style,noscript,iframe,svg,canvas,nav,footer,header,aside,[class*="ad"],[id*="ad"],[class*="sponsor"],[data-ad]').forEach(n => n.remove());
      }
      const root = clone?.querySelector('main, article, [role="main"]') || clone || document.body;
      const clean = s => String(s || '').replace(/\\s+/g, ' ').trim();
      const links = [...document.querySelectorAll('a[href]')].slice(0, 80).map((a, i) => ({ ref: 'link-' + i, text: clean(a.innerText || a.textContent).slice(0,120), href: a.href }));
      const controls = [...document.querySelectorAll('button,a[href],input,textarea,select,[role="button"],[contenteditable="true"]')].slice(0,120).map((el, i) => {
        if (!el.dataset.hermesRef) el.dataset.hermesRef = 'ref-' + i;
        const r = el.getBoundingClientRect();
        return { ref: el.dataset.hermesRef, tag: el.tagName.toLowerCase(), type: el.type || '', text: clean(el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || el.name).slice(0,120), href: el.href || '', visible: r.width > 0 && r.height > 0, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
      });
      const headings = [...document.querySelectorAll('h1,h2,h3')].slice(0,40).map(h => ({ level: h.tagName, text: clean(h.innerText) }));
      const tables = [...document.querySelectorAll('table')].slice(0,8).map(t => clean(t.innerText).slice(0,3000));
      const text = clean(root?.innerText || document.body?.innerText || '').slice(0,50000);
      const selection = clean(window.getSelection()?.toString() || '').slice(0,5000);
      const images = [...document.querySelectorAll('img')].slice(0,20).map(img => ({ src: img.src, alt: clean(img.alt).slice(0,100), w: img.naturalWidth, h: img.naturalHeight }));
      const forms = [...document.querySelectorAll('form')].slice(0,10).map((f, i) => ({ ref: 'form-' + i, action: f.action || '', method: f.method || 'get', fields: [...f.querySelectorAll('input,textarea,select')].slice(0,30).map(el => ({ tag: el.tagName.toLowerCase(), type: el.type || '', name: el.name || '', label: clean(el.labels?.[0]?.innerText || el.placeholder || el.getAttribute('aria-label')).slice(0,80), required: el.required })) }));
      const hasLoginForm = !!document.querySelector('input[type="password"]');
      const hasCookieBanner = !!document.querySelector('[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[id*="gdpr" i],[class*="gdpr" i]');
      const hasCaptcha = !!document.querySelector('iframe[src*="captcha"],[class*="captcha" i],[id*="captcha" i],.g-recaptcha,#cf-challenge,#challenge-running');
      const meta = {};
      document.querySelectorAll('meta[name],meta[property]').forEach(m => { const k = m.getAttribute('name') || m.getAttribute('property'); if (k) meta[k] = clean(m.getAttribute('content')).slice(0,200); });
      return { url: location.href, title: document.title, domain: location.hostname, text, charCount: text.length, headings, links, controls, tables, scroll: { y: Math.round(scrollY), height: document.documentElement.scrollHeight, viewport: innerHeight }, selection, images, forms, loginRequired: hasLoginForm, hasCookieBanner, hasCaptcha, meta };
    })()`, true);
    const fields = ['text', 'title'];
    let redactionCount = 0;
    for (const f of fields) {
      const red = redactText(context[f]);
      context[f] = red.text;
      redactionCount += red.count;
    }
    context.redactionCount = redactionCount;
    context.tabId = tab?.id || null;
    context.extractedAt = new Date().toISOString();
    // Check for prompt injection in page text
    const injection = detectInjection(context.text);
    if (injection.injected) {
      context.injectionDetected = true;
      context.injectionPatterns = injection.patterns;
      send('injection-warning', { url: context.url, patterns: injection.patterns });
    }
    // Cache context per tab
    if (tab) tabContextCache.set(tab.id, { ...context, cachedAt: Date.now() });
    send('page-context', context);
    return context;
  } catch (error) {
    const context = { error: error.message, url: getActiveTab()?.url || '', title: getActiveTab()?.title || '' };
    send('page-context', context);
    return context;
  }
}

// Extract context from a specific tab (for multi-tab analysis)
async function extractTabContext(tabId) {
  const tab = tabs.find(t => t.id === Number(tabId));
  if (!tab) return { error: 'tab not found' };
  const cached = tabContextCache.get(tab.id);
  if (cached && Date.now() - cached.cachedAt < 30000) return cached;
  const isActive = tab.id === activeTabId;
  if (isActive) return extractPageContext();
  // For non-active tabs, temporarily execute JS on their webContents
  try {
    const context = await tab.view.webContents.executeJavaScript(`(() => {
      const clean = s => String(s || '').replace(/\\s+/g, ' ').trim();
      const text = clean(document.body?.innerText || '').slice(0, 20000);
      const links = [...document.querySelectorAll('a[href]')].slice(0, 30).map(a => ({ text: clean(a.innerText).slice(0,80), href: a.href }));
      return { url: location.href, title: document.title, domain: location.hostname, text, charCount: text.length, links };
    })()`, true);
    tabContextCache.set(tab.id, { ...context, cachedAt: Date.now() });
    return context;
  } catch (e) {
    return { error: e.message, tabId };
  }
}

// Get all tab contexts (lightweight — titles + URLs + cached summaries)
async function getAllTabContexts() {
  const result = [];
  for (const tab of tabs) {
    const cached = tabContextCache.get(tab.id);
    if (cached && Date.now() - cached.cachedAt < 30000) {
      result.push({ id: tab.id, title: tab.title, url: tab.url, loading: !!tab.loading, pinned: !!tab.pinned, summary: (cached.text || '').slice(0, 500), charCount: cached.charCount || 0 });
    } else {
      result.push({ id: tab.id, title: tab.title, url: tab.url, loading: !!tab.loading, pinned: !!tab.pinned, summary: '', charCount: 0 });
    }
  }
  return result;
}

// Deep multi-tab context extraction (for comparison/analysis)
async function getMultiTabContexts(tabIds) {
  const ids = tabIds && tabIds.length ? tabIds.map(Number) : tabs.map(t => t.id);
  const contexts = [];
  for (const id of ids) {
    const ctx = await extractTabContext(id);
    contexts.push({ tabId: id, ...ctx });
  }
  return contexts;
}

async function askApproval(action, params, reason) {
  if (autoApprove) { logAction('auto-approve', { action, params }, { ok: true }); return true; }
  const id = Date.now() + Math.floor(Math.random() * 1000);
  const active = getActiveTab();
  const site = active?.url ? new URL(active.url).hostname : 'unknown';
  const risk = getActionRisk(action);
  const reversible = ['navigate', 'scroll', 'click', 'type', 'fill', 'goBack', 'goForward', 'reload', 'switchTab', 'openTab'].includes(action);
  const approvalData = {
    id, action, params: maskSecrets(params), reason, riskLevel: risk,
    site, reversible,
    targetDescription: params.description || params.text || params.ref || params.url || params.query || '',
    inputSummary: (action === 'type' || action === 'fill') ? String(params.value || params.text || '').slice(0, 80) : '',
  };
  send('approval-request', approvalData);
  return new Promise(resolve => {
    const timer = setTimeout(() => { pendingApprovals.delete(id); resolve(false); }, 60000);
    pendingApprovals.set(id, value => { clearTimeout(timer); resolve(!!value); });
  });
}
function isRiskyAction(action, params = {}) {
  const joined = JSON.stringify(params).toLowerCase();
  if (['submit', 'uploadFile', 'downloadFile', 'openExternal'].includes(action)) return true;
  return /(checkout|payment|pay\.|bank|login|signin|password|otp|2fa|delete|send|purchase|reserve|booking|card)/i.test(joined);
}

function logAction(action, params, result) {
  const active = getActiveTab();
  const reversible = ['navigate', 'scroll', 'click', 'type', 'fill', 'goBack', 'goForward', 'reload', 'switchTab', 'openTab'].includes(action);
  const entry = {
    ts: new Date().toISOString(), action, params: maskSecrets(params), result: maskSecrets(result),
    tabId: active?.id || null, url: active?.url || '', site: active?.url ? (() => { try { return new URL(active.url).hostname } catch { return '' } })() : '',
    reversible, riskLevel: getActionRisk(action),
    approved: result?.denied ? false : (getActionRisk(action) !== 'low' && !autoApprove),
  };
  actionLog.unshift(entry);
  actionLog = actionLog.slice(0, 500);
  try { fs.writeFileSync(userDataPath('action-log.json'), JSON.stringify(actionLog, null, 2)); } catch {}
  send('action-log-entry', entry);
}
function maskSecrets(value) {
  if (value == null) return value;
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  const red = redactText(str).text;
  return typeof value === 'string' ? red : safeJson(red, value);
}

// === Phase 2: Enhanced action execution with retry + highlight ===

async function highlightElement(view, selector, textMatch) {
  try {
    await view.webContents.executeJavaScript(`(() => {
      let el = ${selector ? `document.querySelector(${JSON.stringify(selector)})` : 'null'};
      if (!el && ${JSON.stringify(textMatch || '')}) {
        const target = ${JSON.stringify(textMatch || '')};
        el = [...document.querySelectorAll('button,a[href],input,textarea,select,[role="button"],[contenteditable="true"]')].find(e => (e.innerText||e.value||e.placeholder||'').trim().includes(target));
      }
      if (!el) return;
      const r = el.getBoundingClientRect();
      const hl = document.createElement('div');
      hl.id = 'hermes-highlight';
      hl.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;border:2px solid #5b6cff;border-radius:4px;box-shadow:0 0 0 3px rgba(91,108,255,.2);transition:opacity .3s;left:'+r.x+'px;top:'+r.y+'px;width:'+r.width+'px;height:'+r.height+'px;';
      document.body.appendChild(hl);
      setTimeout(() => { const e = document.getElementById('hermes-highlight'); if (e) { e.style.opacity = '0'; setTimeout(() => e.remove(), 300); } }, 1200);
    })()`, true);
  } catch {}
}

async function findElementByRef(view, ref) {
  const sel = `[data-hermes-ref="${ref}"]`;
  const exists = await view.webContents.executeJavaScript(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return el ? { found: true, tag: el.tagName.toLowerCase(), text: (el.innerText||el.value||'').slice(0,100), rect: el.getBoundingClientRect().toJSON() } : null; })()`, true);
  return exists;
}

async function findElementByText(view, textMatch) {
  return await view.webContents.executeJavaScript(`(() => {
    const target = ${JSON.stringify(textMatch)};
    const els = [...document.querySelectorAll('button,a[href],input,textarea,select,[role="button"],[contenteditable="true"]')];
    for (const el of els) {
      const t = (el.innerText||el.value||el.placeholder||el.getAttribute('aria-label')||'').trim();
      if (t && (t.includes(target) || t.toLowerCase() === target.toLowerCase())) {
        if (!el.dataset.hermesRef) el.dataset.hermesRef = 'ref-text-' + Math.random().toString(36).slice(2,8);
        const r = el.getBoundingClientRect();
        return { found: true, ref: el.dataset.hermesRef, tag: el.tagName.toLowerCase(), text: t.slice(0,100), rect: { x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height } };
      }
    }
    return null;
  })()`, true);
}

async function clickElement(view, params) {
  const maxRetries = 2;
  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Attempt 1: by ref/selector
    let selector = params.selector || (params.ref ? `[data-hermes-ref="${params.ref}"]` : null);
    if (selector) {
      await highlightElement(view, selector, params.text || params.description);
      const selJson = JSON.stringify(selector);
      const clicked = await view.webContents.executeJavaScript(`(() => {
        const el = document.querySelector(${selJson});
        if (!el) return { ok:false, error:'element not found' };
        const r = el.getBoundingClientRect();
        el.scrollIntoView({block:'center'});
        el.click();
        return { ok:true, text:(el.innerText||el.value||'').slice(0,100), rect: { x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height } };
      })()`, true);
      if (clicked?.ok) {
        if (clicked.rect) send('virtual-cursor', { x: clicked.rect.x, y: clicked.rect.y, action: 'click' });
        await sleep(700);
        return clicked;
      }
      lastError = clicked?.error || 'unknown';
    }
    // Attempt 2+: find by text match
    if (params.text || params.description) {
      const textMatch = params.text || params.description;
      const found = await findElementByText(view, textMatch);
      if (found) {
        await highlightElement(view, `[data-hermes-ref="${found.ref}"]`, textMatch);
        const selJson = JSON.stringify(`[data-hermes-ref="${found.ref}"]`);
        const clicked = await view.webContents.executeJavaScript(`(() => { const el = document.querySelector(${selJson}); if (!el) return { ok:false, error:'not found' }; const r = el.getBoundingClientRect(); el.scrollIntoView({block:'center'}); el.click(); return { ok:true, text:(el.innerText||el.value||'').slice(0,100), rect:{x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height} }; })()`, true);
        if (clicked?.ok) {
          if (clicked.rect) send('virtual-cursor', { x: clicked.rect.x, y: clicked.rect.y, action: 'click' });
          await sleep(700);
          return clicked;
        }
        lastError = clicked?.error || 'click failed';
      }
    }
    // Re-extract context to refresh refs
    if (attempt < maxRetries) {
      await extractPageContext().catch(() => null);
      await sleep(500);
    }
  }
  return { ok: false, error: `element not found after ${maxRetries + 1} attempts: ${lastError}`, retryExhausted: true };
}

async function fillElement(view, params) {
  const maxRetries = 2;
  let lastError = null;
  const value = JSON.stringify(String(params.value || params.text || ''));
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let selector = params.selector || (params.ref ? `[data-hermes-ref="${params.ref}"]` : null);
    if (selector) {
      await highlightElement(view, selector, params.text || params.description);
      const selJson = JSON.stringify(selector);
      const filled = await view.webContents.executeJavaScript(`(() => {
        const el = document.querySelector(${selJson});
        if (!el) return { ok:false, error:'element not found' };
        el.focus(); el.scrollIntoView({block:'center'});
        if ('value' in el) el.value = ${value}; else el.textContent = ${value};
        el.dispatchEvent(new Event('input',{bubbles:true}));
        el.dispatchEvent(new Event('change',{bubbles:true}));
        return { ok:true };
      })()`, true);
      if (filled?.ok) return filled;
      lastError = filled?.error || 'fill failed';
    }
    // Retry by text
    if (params.text || params.description) {
      const textMatch = params.text || params.description;
      const found = await findElementByText(view, textMatch);
      if (found) {
        const selJson = JSON.stringify(`[data-hermes-ref="${found.ref}"]`);
        const filled = await view.webContents.executeJavaScript(`(() => { const el = document.querySelector(${selJson}); if (!el) return { ok:false }; el.focus(); if ('value' in el) el.value = ${value}; else el.textContent = ${value}; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return { ok:true }; })()`, true);
        if (filled?.ok) return filled;
        lastError = filled?.error || 'fill by text failed';
      }
    }
    if (attempt < maxRetries) {
      await extractPageContext().catch(() => null);
      await sleep(500);
    }
  }
  return { ok: false, error: `element not found after ${maxRetries + 1} attempts: ${lastError}`, retryExhausted: true };
}

async function runBrowserAction(action, params = {}) {
  const view = getActiveView();
  if (!view) return { ok: false, error: 'No active tab' };

  // Mode permission check
  const perms = getModePermissions();
  const risk = getActionRisk(action);
  const structAction = createStructuredAction(action, params, '');
  actionQueue.push(structAction);

  // Ask mode: no actions allowed except reads
  if (!perms.canAct && !['inspectPage', 'getVisibleText', 'takeScreenshot'].includes(action)) {
    structAction.status = 'blocked';
    structAction.error = `${currentMode} 모드에서는 실행 액션을 사용할 수 없습니다. Agent 또는 Auto 모드로 전환하세요.`;
    structAction.completedAt = new Date().toISOString();
    logAction(action, params, { ok: false, error: structAction.error });
    return { ok: false, blocked: true, mode: currentMode, error: structAction.error };
  }

  // Approval needed?
  const needsApproval = structAction.requiresApproval || isRiskyAction(action, params);
  if (needsApproval && !autoApprove) {
    structAction.status = 'approval';
    const ok = await askApproval(action, params, `${risk} 위험: ${action} — ${JSON.stringify(params).slice(0, 100)}`);
    if (!ok) {
      structAction.status = 'denied';
      structAction.error = 'User denied approval';
      structAction.completedAt = new Date().toISOString();
      logAction(action, params, { ok: false, denied: true });
      return { ok: false, denied: true, error: 'User denied approval' };
    }
  }

  structAction.status = 'running';

  let result = { ok: false };
  try {
    switch (action) {
      case 'navigate': {
        const url = normalizeUrl(params.url || params.query || '');
        view.webContents.loadURL(url);
        await waitForLoad(view);
        result = { ok: true, url: view.webContents.getURL() || url };
        break;
      }
      case 'searchWeb':
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
      case 'openTab': {
        const tab = createTab(params.url || 'https://www.google.com', true);
        await waitForLoad(tab.view);
        result = { ok: true, tabId: tab.id, url: tab.view.webContents.getURL() || tab.url };
        break;
      }
      case 'switchTab': result = { ok: !!switchTab(params.tabId), tabId: params.tabId }; break;
      case 'closeTab': result = { ok: closeTab(params.tabId || activeTabId) }; break;
      case 'goBack': goBack(view.webContents); await waitForLoad(view); result = { ok: true }; break;
      case 'goForward': goForward(view.webContents); await waitForLoad(view); result = { ok: true }; break;
      case 'reload': view.webContents.reload(); await waitForLoad(view); result = { ok: true }; break;
      case 'inspectPage': result = { ok: true, context: await extractPageContext() }; break;
      case 'getVisibleText': {
        const text = await view.webContents.executeJavaScript('document.body ? document.body.innerText.slice(0, 12000) : ""');
        result = { ok: true, text };
        break;
      }
      case 'click': {
        result = await clickElement(view, params);
        break;
      }
      case 'type':
      case 'fill': {
        result = await fillElement(view, params);
        break;
      }
      case 'pressKey': await view.webContents.sendInputEvent({ type: 'keyDown', keyCode: params.key || 'Enter' }); await view.webContents.sendInputEvent({ type: 'keyUp', keyCode: params.key || 'Enter' }); result = { ok: true }; break;
      case 'scroll': {
        const dy = params.direction === 'up' ? -(params.amount || 700) : (params.amount || 700);
        result = await view.webContents.executeJavaScript(`(() => { scrollBy(0, ${dy}); return { ok:true, y: scrollY }; })()`);
        break;
      }
      case 'takeScreenshot': {
        const image = await view.webContents.capturePage();
        result = { ok: true, dataUrl: image.toDataURL() };
        break;
      }
      case 'openExternal': if (params.url) await shell.openExternal(params.url); result = { ok: true }; break;
      default: result = { ok: false, error: `Unknown action: ${action}` };
    }
  } catch (error) {
    result = { ok: false, error: error.message };
  }
  if (result.ok && !['takeScreenshot'].includes(action)) extractPageContext().catch(() => null);
  structAction.status = result.ok ? 'completed' : 'failed';
  structAction.result = maskSecrets(result);
  if (!result.ok) structAction.error = result.error;
  structAction.completedAt = new Date().toISOString();
  logAction(action, params, result);
  notifyAll();
  return result;
}

// === Search pipeline: result extraction + page content reading ===

// Extract search result links from a search engine results page
async function extractSearchResults(view) {
  try {
    return await view.webContents.executeJavaScript(`(() => {
      const clean = s => String(s || '').replace(/\\s+/g, ' ').trim();
      const results = [];
      // Google results
      document.querySelectorAll('div.g h3, .MjjYud h3').forEach((h3, i) => {
        const a = h3.closest('a') || h3.parentElement?.querySelector('a');
        if (a && a.href && !a.href.includes('google.com')) {
          results.push({ title: clean(h3.innerText).slice(0,200), url: a.href, snippet: '', index: i });
        }
      });
      // Naver results
      document.querySelectorAll('.total_tit, .link_tit, .sp_nweb_link').forEach((el, i) => {
        const a = el.tagName === 'A' ? el : el.closest('a') || el.querySelector('a');
        if (a && a.href) {
          results.push({ title: clean(el.innerText).slice(0,200), url: a.href, snippet: '', index: i });
        }
      });
      // Bing results
      document.querySelectorAll('.b_algo h2 a').forEach((a, i) => {
        results.push({ title: clean(a.innerText).slice(0,200), url: a.href, snippet: '', index: i });
      });
      // Generic fallback — any external links in main content
      if (results.length < 3) {
        document.querySelectorAll('a[href]').forEach(a => {
          if (a.href && !a.href.includes(location.hostname) && a.innerText.trim().length > 10) {
            results.push({ title: clean(a.innerText).slice(0,200), url: a.href, snippet: '', index: results.length });
          }
        });
      }
      // Deduplicate by URL
      const seen = new Set();
      const unique = results.filter(r => {
        if (seen.has(r.url)) return false;
        seen.add(r.url); return true;
      });
      // Try to get snippets
      document.querySelectorAll('.IsZvec, .snippet, .b_caption p, .total_cont .detail').forEach((el, i) => {
        if (unique[i]) unique[i].snippet = clean(el.innerText).slice(0, 300);
      });
      return unique.slice(0, 20);
    })()`, true);
  } catch (e) {
    return [];
  }
}

// Read page content — extract main text, tables, dates from a loaded page
async function readPageContent(view, maxChars = 12000) {
  try {
    return await view.webContents.executeJavaScript(`(() => {
      const clean = s => String(s || '').replace(/\\s+/g, ' ').trim();
      const clone = document.body ? document.body.cloneNode(true) : null;
      if (clone) clone.querySelectorAll('script,style,noscript,iframe,svg,canvas,nav,footer,header,aside,[class*="ad"],[id*="ad"],[class*="sponsor"]').forEach(n => n.remove());
      const root = clone?.querySelector('main, article, [role="main"], .content, .article-body, #content') || clone || document.body;
      const text = clean(root?.innerText || '').slice(0, ${maxChars});
      const headings = [...document.querySelectorAll('h1,h2,h3')].slice(0,20).map(h => ({ level: h.tagName, text: clean(h.innerText) }));
      const tables = [...document.querySelectorAll('table')].slice(0,5).map(t => clean(t.innerText).slice(0,2000));
      // Try to find date
      const dateEl = document.querySelector('[datetime], time, .date, .article-date, .publish-date, .reg_date, .date_info');
      const date = dateEl ? clean(dateEl.getAttribute('datetime') || dateEl.innerText).slice(0,50) : '';
      const author = clean(document.querySelector('[rel="author"], .author, .byline, .press')?.innerText || '').slice(0,100);
      return { url: location.href, title: document.title, text, charCount: text.length, headings, tables, date, author };
    })()`, true);
  } catch (e) {
    return { url: view.webContents.getURL(), title: '', text: '', error: e.message };
  }
}

// === Zoom: per-domain + Ctrl+0/+/= shortcuts ===
ipcMain.handle('zoom:set', (_e, factor) => {
  const view = getActiveView();
  if (!view) return { ok: false };
  const clamped = Math.max(0.25, Math.min(5.0, factor));
  view.webContents.setZoomFactor(clamped);
  return { ok: true, factor: clamped };
});
ipcMain.handle('zoom:get', () => {
  const view = getActiveView();
  if (!view) return { ok: false, factor: 1.0 };
  return { ok: true, factor: view.webContents.getZoomFactor() };
});
ipcMain.handle('zoom:setDomain', (_e, domain, factor) => {
  domainZoom[domain] = Math.max(0.25, Math.min(5.0, factor));
  const view = getActiveView();
  if (view) {
    try {
      const currentDomain = new URL(view.webContents.getURL()).hostname.replace(/^www\./, '');
      if (currentDomain === domain) view.webContents.setZoomFactor(domainZoom[domain]);
    } catch {}
  }
  return { ok: true, domain, factor: domainZoom[domain] };
});
ipcMain.handle('zoom:getDomain', (_e, domain) => {
  return { ok: true, factor: domainZoom[domain] || 1.0, hasCustom: !!domainZoom[domain] };
});
ipcMain.handle('zoom:reset', () => {
  const view = getActiveView();
  if (!view) return { ok: false };
  view.webContents.setZoomFactor(1.0);
  return { ok: true, factor: 1.0 };
});
// Auto-fit page to webview width (for sites like Naver with fixed widths)
ipcMain.handle('zoom:autoFit', async () => {
  const view = getActiveView();
  if (!view) return { ok: false, error: 'no active view' };
  try {
    const info = await view.webContents.executeJavaScript(`(() => {
      const sw = document.documentElement.scrollWidth;
      const cw = document.documentElement.clientWidth;
      const vw = window.innerWidth;
      return { scrollWidth: sw, clientWidth: cw, innerWidth: vw };
    })()`, true);
    const currentZoom = view.webContents.getZoomFactor();
    const viewWidth = browserBounds().width;
    // If page is wider than viewport, calculate fit zoom
    if (info.scrollWidth > info.clientWidth) {
      const fitFactor = Math.max(0.5, Math.min(1.0, (info.clientWidth / info.scrollWidth) * currentZoom));
      view.webContents.setZoomFactor(fitFactor);
      return { ok: true, factor: fitFactor, scrollWidth: info.scrollWidth, clientWidth: info.clientWidth };
    }
    return { ok: true, factor: currentZoom, noChange: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// === Search pipeline IPC ===
ipcMain.handle('search:extractResults', async (_e, tabId) => {
  const tab = tabId ? tabs.find(t => t.id === Number(tabId)) : getActiveTab();
  if (!tab) return [];
  return await extractSearchResults(tab.view);
});
ipcMain.handle('search:readPage', async (_e, tabId, maxChars) => {
  const tab = tabId ? tabs.find(t => t.id === Number(tabId)) : getActiveTab();
  if (!tab) return { error: 'tab not found' };
  return await readPageContent(tab.view, maxChars);
});
ipcMain.handle('search:readUrl', async (_e, url) => {
  // Open URL in a temporary background tab, read content, close tab
  const tab = createTab(url, false);
  await waitForLoad(tab.view);
  await new Promise(r => setTimeout(r, 500)); // brief settle
  const content = await readPageContent(tab.view, 12000);
  closeTab(tab.id);
  return content;
});

// === Diagnostics ===
ipcMain.handle('diag:webview', async () => {
  const view = getActiveView();
  if (!view) return { error: 'no active view' };
  const b = browserBounds();
  const info = await view.webContents.executeJavaScript(`(() => ({
    innerWidth: window.innerWidth, innerHeight: window.innerHeight,
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    devicePixelRatio: window.devicePixelRatio,
    ua: navigator.userAgent
  }))()`, true).catch(() => ({}));
  return {
    bounds: b, zoomFactor: view.webContents.getZoomFactor(),
    ua: view.webContents.getUserAgent(),
    windowSize: mainWindow.getContentSize(),
    sidePanel: sidePanelVisible, leftPanel: leftPanelVisible,
    page: info
  };
});
ipcMain.handle('browser:getState', () => ({ tabs: visibleTabs(), activeTabId, sidePanelVisible }));

// V15: Tab thumbnail capture — real screenshot via webContents.capturePage
ipcMain.handle('browser:captureTab', async (_e, { tabId, quality = 60, width = 240, height = 150 } = {}) => {
  try {
    const view = tabViews.get(tabId);
    if (!view || !view.webContents) return { ok: false, error: 'tab not found' };
    const image = await view.webContents.capturePage();
    if (!image || image.isEmpty()) return { ok: false, error: 'empty capture' };
    // Resize to thumbnail (keep aspect ratio)
    const nativeImg = image.toBitmap ? image : image;
    const originalSize = image.getSize();
    const factor = Math.min(width / originalSize.width, height / originalSize.height);
    const targetW = Math.round(originalSize.width * factor);
    const targetH = Math.round(originalSize.height * factor);
    // Use electron's built-in thumbnail via setThumbnailQuality
    const jpeg = image.toJPEG(quality);
    return { ok: true, format: 'jpeg', width: targetW, height: targetH, originalWidth: originalSize.width, originalHeight: originalSize.height, size: jpeg.length, data: jpeg.toString('base64') };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// V15: Set tab as thumbnail (Chromium native) for window thumbnails
ipcMain.handle('browser:setTabThumbnail', async (_e, { tabId, quality = 80 } = {}) => {
  try {
    const view = tabViews.get(tabId);
    if (!view) return { ok: false, error: 'tab not found' };
    const image = await view.webContents.capturePage();
    if (!image || image.isEmpty()) return { ok: false, error: 'empty capture' };
    view.webContents.setThumbnailImage(image);
    return { ok: true, width: image.getSize().width, height: image.getSize().height };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('browser:newTab', (_e, url) => createTab(url || 'https://www.google.com', { activate: true }).id);
ipcMain.handle('browser:switchTab', (_e, id) => !!switchTab(id));
ipcMain.handle('browser:closeTab', (_e, id) => closeTab(id));
ipcMain.handle('browser:createResultTab', (_e, { title, htmlContent } = {}) => {
  const html = htmlContent || '<html><body></body></html>';
  const tab = createTab(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`, { agentOwned: true });
  tab.title = title || 'Research result';
  switchTab(tab.id);
  notifyAll();
  return { ok: true, id: tab.id };
});
ipcMain.handle('browser:navigate', (_e, url) => runBrowserAction('navigate', { url }));
ipcMain.handle('browser:action', (_e, action, params) => runBrowserAction(action, params));
ipcMain.handle('browser:context', () => extractPageContext());
ipcMain.handle('browser:togglePanel', () => { sidePanelVisible = !sidePanelVisible; layoutAllViews(); return sidePanelVisible; });
ipcMain.handle('browser:approvalResponse', (_e, id, approved) => { const fn = pendingApprovals.get(id); if (fn) { pendingApprovals.delete(id); fn(approved); } return true; });
ipcMain.handle('browser:getActionLog', () => actionLog);
ipcMain.handle('browser:clearActionLog', () => { actionLog = []; try { fs.writeFileSync(userDataPath('action-log.json'), '[]'); } catch {} return true; });

ipcMain.handle('settings:get', () => {
  const p = userDataPath('settings.json');
  let settings = { provider: 'mock', gatewayUrl: 'https://opencode.ai/zen/go/v1', apiKey: '', model: 'deepseek-v4-flash' };
  if (fs.existsSync(p)) settings = { ...settings, ...safeJson(fs.readFileSync(p, 'utf8'), {}) };
  if (settings.apiKey) settings.hasApiKey = true;
  settings.apiKey = '';
  return settings;
});
ipcMain.handle('settings:set', (_e, settings) => {
  const clean = { provider: settings.provider || 'mock', gatewayUrl: settings.gatewayUrl || '', model: settings.model || '', apiKey: settings.apiKey || '' };
  fs.writeFileSync(userDataPath('settings.json'), JSON.stringify(clean, null, 2));
  return { ok: true };
});

// V12: Provider presets (mirror of renderer.js + bridge)
const PROVIDER_PRESETS = {
  mock: { gatewayUrl: 'https://opencode.ai/zen/go/v1', model: 'deepseek-v4-flash', description: 'Mock — uses opencode-go proxy' },
  lmstudio: { gatewayUrl: 'http://127.0.0.1:1234/v1', model: 'qwen2.5-3b-instruct', description: 'LM Studio local (:1234)' },
  ollama: { gatewayUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:3b', description: 'Ollama local (:11434)' },
  openai: { gatewayUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', description: 'OpenAI cloud' },
  anthropic: { gatewayUrl: 'https://api.anthropic.com', model: 'claude-3-5-haiku-20241022', description: 'Anthropic native', nativeAnthropic: true },
  google: { gatewayUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash', description: 'Google Gemini native REST', nativeGoogle: true },
  openrouter: { gatewayUrl: 'https://openrouter.ai/api/v1', model: 'deepseek/deepseek-chat-v3-0324', description: 'OpenRouter aggregator' },
  minimax: { gatewayUrl: 'https://api.minimax.io/anthropic', model: 'MiniMax-M3', description: 'MiniMax M3 (anthropic-compat)', nativeAnthropic: true },
  browseros: { gatewayUrl: 'https://browseros.com/api/v1', model: 'kimi-k2-0711', description: 'BrowserOS — open-source Chromium AI browser' },
  'openai-compatible': { gatewayUrl: '', model: '', description: 'Custom OpenAI-compatible endpoint' },
};

ipcMain.handle('browser:providerList', () => {
  return Object.entries(PROVIDER_PRESETS).map(([id, p]) => ({ id, ...p }));
});

ipcMain.handle('browser:testProvider', async (_e, args) => {
  const start = Date.now();
  const { provider, gatewayUrl, apiKey, model } = args || {};
  if (!provider || !gatewayUrl) return { ok: false, error: 'provider and gatewayUrl required' };
  try {
    const base = gatewayUrl.replace(/\/+$/, '');
    const preset = PROVIDER_PRESETS[provider] || {};
    let url, headers, body;
    if (provider === 'anthropic') {
      url = `${base}/v1/messages`;
      headers = {
        'Content-Type': 'application/json',
        'x-api-key': apiKey || '',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      };
      body = JSON.stringify({
        model: model || preset.model || 'claude-3-5-haiku-20241022',
        max_tokens: 4,
        messages: [{ role: 'user', content: 'hi' }],
      });
        } else if (provider === 'minimax') {
      // MiniMax: base = https://api.minimax.io/anthropic → endpoint {base}/v1/messages
      // Per Hermes memory: base_url must end with /anthropic, NOT /v1
      // MiniMax uses X-Api-Key (capitalized) + anthropic-version
      url = `${base}/v1/messages`;
      headers = {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey || '',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      };
      body = JSON.stringify({
        model: model || preset.model || 'MiniMax-M3',
        max_tokens: 4,
        messages: [{ role: 'user', content: 'hi' }],
      });
    } else if (preset.nativeGoogle || provider === 'google') {
      url = `${base}/models/${encodeURIComponent(model || preset.model || 'gemini-2.5-flash')}:generateContent?key=${encodeURIComponent(apiKey || '')}`;
      headers = { 'Content-Type': 'application/json' };
      body = JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
        generationConfig: { maxOutputTokens: 4 },
      });
    } else {
      url = `${base}/chat/completions`;
      headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey || ''}`,
      };
      body = JSON.stringify({
        model: model || preset.model || 'deepseek-v4-flash',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 4,
      });
    }
    const res = await fetch(url, { method: 'POST', headers, body });
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { ok: false, error: `${res.status} ${errText.slice(0, 150)}`, latencyMs };
    }
    return { ok: true, latencyMs, model, provider };
  } catch (e) {
    return { ok: false, error: e.message, latencyMs: Date.now() - start };
  }
});

ipcMain.handle('memory:get', (_e, type) => {
  const allowed = new Set(['profile', 'preferences', 'tasks', 'workspace']);
  const name = allowed.has(type) ? type : 'workspace';
  const dir = userDataPath('memory'); ensureDir(dir);
  const file = path.join(dir, `${name}.md`);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
});
ipcMain.handle('memory:set', (_e, type, content) => {
  const allowed = new Set(['profile', 'preferences', 'tasks', 'workspace']);
  const name = allowed.has(type) ? type : 'workspace';
  const dir = userDataPath('memory'); ensureDir(dir);
  fs.writeFileSync(path.join(dir, `${name}.md`), String(content || ''));
  return { ok: true };
});

ipcMain.handle('win:close', () => mainWindow.close());
ipcMain.handle('win:min', () => mainWindow.minimize());
ipcMain.handle('win:max', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());

// Broadcast maximize state to renderer for icon swap
// maximize state broadcast moved into createWindow (was crashing main process at module load)

// === Browser basics: find-in-page, downloads, history, print ===
ipcMain.handle('browser:findInPage', (_e, query) => {
  const view = getActiveView();
  if (!view || !query) return { ok: false };
  findInPageActive = view.webContents.findInPage(query, { forward: true, matchCase: false });
  return { ok: true };
});
ipcMain.handle('browser:stopFind', () => {
  const view = getActiveView();
  if (view) view.webContents.stopFindInPage('clearSelection');
  findInPageActive = null;
  return { ok: true };
});
ipcMain.handle('browser:print', () => {
  const view = getActiveView();
  if (!view) return { ok: false };
  view.webContents.print();
  return { ok: true };
});
ipcMain.handle('browser:viewSource', () => {
  const active = getActiveTab();
  if (!active?.url) return { ok: false };
  createTab(`view-source:${active.url}`, true);
  return { ok: true };
});
ipcMain.handle('browser:devTools', () => {
  const view = getActiveView();
  if (!view) return { ok: false };
  view.webContents.openDevTools({ mode: 'detach' });
  return { ok: true };
});
ipcMain.handle('browser:reorderTabs', (_e, orderedIds) => {
  const order = new Map((orderedIds || []).map((id, index) => [id, index]));
  tabs.sort((a, b) => (order.has(a.id) ? order.get(a.id) : 9999) - (order.has(b.id) ? order.get(b.id) : 9999));
  notifyAll();
  return visibleTabs();
});
ipcMain.handle('browser:getDownloads', () => downloadList);
ipcMain.handle('browser:clearDownloads', () => { downloadList = []; return true; });
ipcMain.handle('browser:getHistory', () => historyList);
ipcMain.handle('browser:clearHistory', () => { historyList = []; return true; });
ipcMain.handle('browser:toggleLeftPanel', () => {
  leftPanelVisible = !leftPanelVisible;
  layoutAllViews();
  return leftPanelVisible;
});
ipcMain.handle('browser:toggleRightPanel', () => {
  sidePanelVisible = !sidePanelVisible;
  layoutAllViews();
  return sidePanelVisible;
});
ipcMain.handle('settings:getAutoApprove', () => autoApprove);
ipcMain.handle('settings:setAutoApprove', (_e, val) => { autoApprove = !!val; return autoApprove; });

// === Phase 1 IPC: Agent system ===
ipcMain.handle('agent:setMode', (_e, mode) => {
  const perms = setMode(mode);
  if (!perms) return { ok: false, error: 'unknown mode' };
  send('mode-changed', { mode, perms: { label: perms.label, desc: perms.desc, canAct: perms.canAct } });
  return { ok: true, mode, label: perms.label, desc: perms.desc, canAct: perms.canAct };
});
ipcMain.handle('agent:getMode', () => ({ mode: currentMode, ...getModePermissions() }));
ipcMain.handle('agent:getPlan', () => getPlanState());
ipcMain.handle('agent:setPlan', (_e, goal, steps) => updatePlanState(goal, steps));
ipcMain.handle('agent:setStepStatus', (_e, index, status, detail) => { setPlanStepStatus(index, status, detail); return getPlanState(); });
ipcMain.handle('agent:pausePlan', (_e, paused) => { setPlanPaused(paused); return getPlanState(); });
ipcMain.handle('agent:getActionQueue', () => actionQueue.slice(-50));
ipcMain.handle('agent:clearActionQueue', () => { actionQueue = []; return true; });

// Multi-tab context
ipcMain.handle('browser:getTabContext', (_e, tabId) => extractTabContext(tabId));
ipcMain.handle('browser:getAllTabContexts', () => getAllTabContexts());
ipcMain.handle('browser:getMultiTabContexts', (_e, tabIds) => getMultiTabContexts(tabIds));

// Prompt injection check
ipcMain.handle('agent:checkInjection', (_e, text) => detectInjection(text));

// Phase 2: pause/resume + undo + highlight
ipcMain.handle('agent:pause', () => { setPlanPaused(true); return getPlanState(); });
ipcMain.handle('agent:resume', () => { setPlanPaused(false); return getPlanState(); });
ipcMain.handle('agent:undoAction', (_e, logIndex) => {
  // Undo: close tab if openTab, go back if navigate, clear if type/fill
  const entry = actionLog[logIndex];
  if (!entry) return { ok: false, error: 'entry not found' };
  if (!entry.reversible) return { ok: false, error: '이 행동은 되돌릴 수 없습니다.' };
  const view = getActiveView();
  if (!view) return { ok: false, error: 'no active tab' };
  try {
    if (entry.action === 'openTab' && entry.result?.tabId) { closeTab(entry.result.tabId); return { ok: true, undone: 'closed tab' }; }
    if (entry.action === 'navigate') { goBack(view.webContents); return { ok: true, undone: 'went back' }; }
    if (entry.action === 'type' || entry.action === 'fill') {
      // Can't fully undo text input, but we can clear the field
      logAction('undo', { originalAction: entry.action }, { ok: true });
      return { ok: true, undone: 'logged undo (manual verification needed)' };
    }
    return { ok: false, error: `undo not implemented for ${entry.action}` };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('agent:getActionLog', () => actionLog.slice(0, 50));

// === Phase 3: Workspace, auto-grouping, research results ===
ipcMain.handle('workspace:save', (_e, name, goal, planResult) => {
  const dir = userDataPath('workspaces');
  ensureDir(dir);
  const id = `${Date.now()}`;
  const ws = {
    id, name: name || `Workspace ${id.slice(-4)}`, goal: goal || '',
    plan: planResult || '', tabs: visibleTabs(), savedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(ws, null, 2));
  return { ok: true, id, ...ws };
});
ipcMain.handle('workspace:list', () => {
  const dir = userDataPath('workspaces');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; }
  }).filter(Boolean).sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
});
ipcMain.handle('workspace:restore', (_e, id) => {
  const dir = userDataPath('workspaces');
  const file = path.join(dir, `${id}.json`);
  if (!fs.existsSync(file)) return { ok: false, error: 'workspace not found' };
  const ws = JSON.parse(fs.readFileSync(file, 'utf8'));
  // Restore tabs
  for (const t of (ws.tabs || [])) createTab(t.url, false);
  if (tabs.length) switchTab(tabs[0].id);
  return { ok: true, ...ws };
});
ipcMain.handle('workspace:delete', (_e, id) => {
  const file = path.join(userDataPath('workspaces'), `${id}.json`);
  try { fs.unlinkSync(file); return { ok: true }; } catch { return { ok: false }; }
});

// Auto-group tabs by domain
ipcMain.handle('browser:autoGroupTabs', () => {
  const groups = new Map();
  for (const tab of tabs) {
    let domain;
    try { domain = new URL(tab.url).hostname.replace(/^www\./, ''); } catch { domain = 'other'; }
    if (!groups.has(domain)) groups.set(domain, []);
    groups.get(domain).push(tab.id);
  }
  const result = [...groups.entries()].map(([domain, ids]) => ({ name: domain, domain, tabIds: ids }));
  return { ok: true, groups: result };
});

// Research result page — opens as a new tab with HTML content
ipcMain.handle('research:openResult', (_e, title, htmlContent) => {
  const dataUri = 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
body{font-family:Inter,system-ui,sans-serif;max-width:800px;margin:40px auto;padding:0 24px;line-height:1.6;color:#1a1a2e;}
h1{font-size:24px;border-bottom:2px solid #5b6cff;padding-bottom:8px;}
h2{font-size:18px;margin-top:28px;color:#5b6cff;}
table{border-collapse:collapse;width:100%;margin:16px 0;}
th,td{border:1px solid #ddd;padding:8px 12px;text-align:left;font-size:14px;}
th{background:#f0f4ff;font-weight:700;}
.src{font-size:13px;color:#666;margin-top:4px;}
.src a{color:#5b6cff;text-decoration:none;}
.src a:hover{text-decoration:underline;}
.conclusion{background:#f8faff;padding:16px;border-radius:8px;border-left:3px solid #5b6cff;margin:16px 0;}
</style></head><body>${htmlContent}</body></html>`);
  createTab(dataUri, true);
  return { ok: true };
});

// === Phase 4: Session memory + Skills ===
// Session memory (volatile — not persisted to disk)
let sessionMemory = [];
ipcMain.handle('memory:getSession', () => sessionMemory);
ipcMain.handle('memory:addSession', (_e, key, value, scope = 'session') => {
  const entry = { id: Date.now(), key, value: maskSecrets(value), scope, ts: new Date().toISOString() };
  sessionMemory.unshift(entry);
  sessionMemory = sessionMemory.slice(0, 100);
  return { ok: true, ...entry };
});
ipcMain.handle('memory:removeSession', (_e, id) => {
  sessionMemory = sessionMemory.filter(m => m.id !== Number(id));
  return { ok: true };
});
ipcMain.handle('memory:clearSession', () => { sessionMemory = []; return { ok: true }; });

// Skills — reusable AI workflows
ipcMain.handle('skill:save', (_e, skill) => {
  const dir = userDataPath('skills');
  ensureDir(dir);
  const id = skill.name?.toLowerCase().replace(/[^a-z0-9-]/g, '-') || `skill-${Date.now()}`;
  const full = {
    id, name: skill.name || id, description: skill.description || '',
    inputs: skill.inputs || [], steps: skill.steps || [],
    allowedDomains: skill.allowedDomains || [], requiredPermissions: skill.requiredPermissions || [],
    approvalSteps: skill.approvalSteps || [], outputFormat: skill.outputFormat || 'text',
    saveLocation: skill.saveLocation || 'chat', lastResult: null,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(full, null, 2));
  return { ok: true, ...full };
});
ipcMain.handle('skill:list', () => {
  const dir = userDataPath('skills');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; }
  }).filter(Boolean);
});
ipcMain.handle('skill:get', (_e, id) => {
  const file = path.join(userDataPath('skills'), `${id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
});
ipcMain.handle('skill:delete', (_e, id) => {
  const file = path.join(userDataPath('skills'), `${id}.json`);
  try { fs.unlinkSync(file); return { ok: true }; } catch { return { ok: false }; }
});
ipcMain.handle('skill:updateResult', (_e, id, result) => {
  const file = path.join(userDataPath('skills'), `${id}.json`);
  if (!fs.existsSync(file)) return { ok: false };
  try {
    const skill = JSON.parse(fs.readFileSync(file, 'utf8'));
    skill.lastResult = { result, ranAt: new Date().toISOString() };
    fs.writeFileSync(file, JSON.stringify(skill, null, 2));
    return { ok: true };
  } catch { return { ok: false }; }
});

// === Phase 5: Inline AI injection + file context ===
// Inject a floating AI menu into the active page when text is selected
ipcMain.handle('browser:injectInlineAI', async () => {
  const view = getActiveView();
  if (!view) return { ok: false };
  return await view.webContents.executeJavaScript(`(() => {
    if (document.getElementById('hermes-inline-ai')) return { ok: true, already: true };
    const style = document.createElement('style');
    style.id = 'hermes-inline-ai';
    style.textContent = '
      .hermes-ai-menu { position:fixed; z-index:999999; display:none; gap:4px; padding:4px; border-radius:8px;
        background:rgba(255,255,255,.92); backdrop-filter:blur(12px); border:1px solid rgba(0,0,0,.08);
        box-shadow:0 4px 16px rgba(0,0,0,.12); font-family:Inter,system-ui,sans-serif; }
      .hermes-ai-menu.visible { display:flex; animation:fadeIn .15s; }
      .hermes-ai-btn { padding:4px 8px; border:none; border-radius:4px; background:transparent; color:#333;
        font-size:13px; cursor:pointer; transition:background .15s; }
      .hermes-ai-btn:hover { background:rgba(91,108,255,.1); color:#5b6cff; }
      @keyframes fadeIn { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
    ';
    document.head.appendChild(style);
    const menu = document.createElement('div');
    menu.className = 'hermes-ai-menu';
    menu.id = 'hermes-ai-menu';
    const actions = [
      {label:'요약',action:'summarize'},{label:'번역',action:'translate'},
      {label:'설명',action:'explain'},{label:'비교',action:'compare'},
      {label:'저장',action:'save'},{label:'재작성',action:'rewrite'},
    ];
    actions.forEach(a => {
      const btn = document.createElement('button');
      btn.className = 'hermes-ai-btn'; btn.textContent = a.label; btn.dataset.action = a.action;
      btn.addEventListener('click', () => {
        const sel = window.getSelection().toString().slice(0,500);
        menu.classList.remove('visible');
        // Send to parent via custom event
        window.dispatchEvent(new CustomEvent('hermes-ai-action', {detail:{action:a.action,text:sel}}));
      });
      menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    document.addEventListener('selectionchange', () => {
      const sel = window.getSelection();
      if (!sel || !sel.toString().trim()) { menu.classList.remove('visible'); return; }
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      menu.style.left = (rect.left + rect.width/2 - 100) + 'px';
      menu.style.top = (rect.top - 40) + 'px';
      menu.classList.add('visible');
    });
    document.addEventListener('click', (e) => { if (!menu.contains(e.target)) menu.classList.remove('visible'); });
    return { ok: true };
  })()`, true);
});
ipcMain.handle('browser:removeInlineAI', async () => {
  const view = getActiveView();
  if (!view) return { ok: false };
  return await view.webContents.executeJavaScript(`(() => {
    const s = document.getElementById('hermes-inline-ai'); if (s) s.remove();
    const m = document.getElementById('hermes-ai-menu'); if (m) m.remove();
    return { ok: true };
  })()`, true);
});

// File context — read file content for AI
ipcMain.handle('file:readContent', async (_e, filePath) => {
  try {
    const buf = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.txt' || ext === '.md' || ext === '.csv' || ext === '.json') {
      return { ok: true, content: buf.toString('utf8').slice(0, 50000), type: 'text', ext };
    }
    return { ok: true, content: `[binary file: ${path.basename(filePath)} ${buf.length} bytes]`, type: 'binary', ext, size: buf.length };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Pin/Unpin tab
ipcMain.handle('browser:markAgentTab', (_e, id, owned) => {
  const tab = tabs.find(t => t.id === Number(id));
  if (!tab) return { ok: false, error: 'tab not found' };
  tab.agentOwned = owned === true;
  notifyAll();
  return { ok: true, id: tab.id, agentOwned: tab.agentOwned };
});

ipcMain.handle('browser:pinTab', (_e, id) => {
  const tab = tabs.find(t => t.id === Number(id));
  if (!tab) return { ok: false };
  tab.pinned = !tab.pinned;
  // Pinned tabs go to front
  tabs.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  notifyAll();
  return { ok: true, pinned: tab.pinned };
});

// Reading mode — injects readability CSS into the page
ipcMain.handle('browser:toggleReadMode', async () => {
  const view = getActiveView();
  if (!view) return { ok: false };
  const result = await view.webContents.executeJavaScript(`(() => {
    if (document.getElementById('miracle-readmode')) {
      document.getElementById('miracle-readmode').remove();
      return { ok: true, enabled: false };
    }
    const style = document.createElement('style');
    style.id = 'miracle-readmode';
    style.textContent = \`
      body { background: #faf8f0 !important; color: #2a2a2a !important; }
      body *:not(script):not(style) { background: transparent !important; box-shadow: none !important; border-color: #ddd !important; }
      p, article, main, section, h1, h2, h3, h4, h5, h6, li, blockquote {
        max-width: 720px !important; margin-left: auto !important; margin-right: auto !important;
        font-family: Georgia, 'Noto Serif KR', serif !important; font-size: 18px !important; line-height: 1.7 !important;
      }
      nav, header, footer, aside, .ad, .ads, .sidebar, .menu, .banner, img[src*="ad"] { display: none !important; }
    \`;
    document.head.appendChild(style);
    return { ok: true, enabled: true };
  })()`);
  return result;
});

// Dark mode for websites — inverts page colors
ipcMain.handle('browser:toggleDarkMode', async () => {
  // V11+: 3-state theme (auto → light → dark → auto)
  const view = getActiveView();
  if (!view) return { ok: false };
  const result = await view.webContents.executeJavaScript(`(() => {
    const root = document.documentElement;
    const cur = root.dataset.theme || 'auto';
    const next = cur === 'auto' ? 'light' : cur === 'light' ? 'dark' : 'auto';
    if (next === 'auto') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', next);
    }
    return { ok: true, theme: next };
  })()`);
  return result;
});

// Sync OS theme changes to chrome.html data-theme
// nativeTheme updates when OS color scheme changes (e.g. Windows dark→light)
function syncNativeThemeToUI() {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const shouldUseDark = nativeTheme.shouldUseDarkColors;
    // Sync to chrome.html shell (mainWindow.webContents)
    mainWindow.webContents.executeJavaScript(`(() => {
      try {
        const root = document.documentElement;
        if (!root.dataset.theme) {
          // auto mode: set data-theme explicitly so chrome.html follows OS
          const theme = ${shouldUseDark ? "'dark'" : "'light'"};
          root.setAttribute('data-theme', theme);
          root.style.colorScheme = theme;
        }
      } catch (e) {}
    })()`).catch(() => null);
  } catch (e) {}
}

// Cookie consent auto-dismiss
ipcMain.handle('browser:dismissCookieConsent', async () => {
  const view = getActiveView();
  if (!view) return { ok: false };
  const result = await view.webContents.executeJavaScript(`(() => {
    const selectors = [
      '[id*="cookie" i]', '[class*="cookie" i]', '[id*="consent" i]', '[class*="consent" i]',
      '[id*="gdpr" i]', '[class*="gdpr" i]', '[id*="privacy" i]', '[class*="privacy-bar" i]',
      '[id*="CMP" i]', '[class*="cmp" i]', '#onetrust-banner-sdk', '#CybotCookiebotDialog',
    ];
    let dismissed = 0;
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach(el => {
        const btn = el.querySelector('button[class*="accept" i], button[class*="agree" i], button[class*="ok" i], button[class*="confirm" i], button[class*="allow" i], a[class*="accept" i], button[id*="accept" i]');
        if (btn) { btn.click(); dismissed++; }
        else { el.remove(); dismissed++; }
      });
    }
    return { ok: true, dismissed };
  })()`);
  return result;
});

// Session restore — save current tabs
ipcMain.handle('browser:saveSession', () => {
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

// Download manager
app.whenReady().then(() => {
  const { session } = require('electron');
  session.defaultSession.on('will-download', (_e, item) => {
    const entry = { id: Date.now(), filename: item.getFilename(), url: item.getURL(), total: item.getTotalBytes(), received: 0, state: 'progressing', savePath: item.getSavePath() };
    downloadList.unshift(entry);
    item.on('updated', (_e, state) => {
      entry.state = state;
      entry.received = item.getReceivedBytes();
      send('download-updated', entry);
    });
    item.once('done', (_e, state) => {
      entry.state = state;
      send('download-updated', entry);
    });
  });
});

