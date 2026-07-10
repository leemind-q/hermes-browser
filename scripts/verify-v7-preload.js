// Test preload for V7 UI verification. Loaded only by scripts/verify-v7-ui.js.
window.__testState = {
  tabs: [{ id: 1, url: 'https://www.google.com', title: 'Google', loading: false }],
  activeTabId: 1,
  newTabCalls: [],
  actions: [],
  printCalls: 0,
  downloadsOpened: 0,
  historyOpened: 0,
  readModeEnabled: false,
  darkModeEnabled: false,
  settingsSaved: null,
  autoApprove: false,
  callbacks: {},
};

function emitBrowserState() {
  const cb = window.__testState.callbacks.browserState;
  if (cb) cb({
    tabs: window.__testState.tabs,
    activeTabId: window.__testState.activeTabId,
    activeUrl: window.__testState.tabs.find(t => t.id === window.__testState.activeTabId)?.url || '',
    activeTitle: window.__testState.tabs.find(t => t.id === window.__testState.activeTabId)?.title || '',
  });
}

window.hermes = {
  window: { close: async () => true, min: async () => true, max: async () => true },
  browser: {
    newTab: async (url = 'https://www.google.com') => {
      const id = window.__testState.tabs.length + 1;
      const tab = { id, url, title: 'New Tab', loading: false };
      window.__testState.tabs.push(tab);
      window.__testState.activeTabId = id;
      window.__testState.newTabCalls.push({ id, url });
      emitBrowserState();
      return id;
    },
    switchTab: async (id) => { window.__testState.activeTabId = Number(id); emitBrowserState(); return true; },
    closeTab: async (id) => { window.__testState.tabs = window.__testState.tabs.filter(t => t.id !== Number(id)); emitBrowserState(); return true; },
    navigate: async (url) => { window.__testState.actions.push({ action: 'navigate', params: { url } }); return { ok: true, url }; },
    action: async (action, params = {}) => { window.__testState.actions.push({ action, params }); return { ok: true, action, params }; },
    getState: async () => ({ tabs: window.__testState.tabs, activeTabId: window.__testState.activeTabId, activeUrl: 'https://www.google.com', activeTitle: 'Google' }),
    toggleLeftPanel: async () => true,
    toggleRightPanel: async () => true,
    findInPage: async (query) => { window.__testState.actions.push({ action: 'find', params: { query } }); return { ok: true }; },
    stopFind: async () => ({ ok: true }),
    print: async () => { window.__testState.printCalls += 1; return { ok: true }; },
    viewSource: async () => ({ ok: true }),
    devTools: async () => ({ ok: true }),
    reorderTabs: async () => window.__testState.tabs,
    getDownloads: async () => { window.__testState.downloadsOpened += 1; return []; },
    clearDownloads: async () => true,
    getHistory: async () => { window.__testState.historyOpened += 1; return [{ title: 'Google', url: 'https://www.google.com', ts: new Date().toISOString() }]; },
    clearHistory: async () => true,
    getActionLog: async () => [],
    clearActionLog: async () => true,
    approvalResponse: async () => true,
    pinTab: async () => ({ ok: true }),
    toggleReadMode: async () => { window.__testState.readModeEnabled = !window.__testState.readModeEnabled; return { ok: true, enabled: window.__testState.readModeEnabled }; },
    toggleDarkMode: async () => { window.__testState.darkModeEnabled = !window.__testState.darkModeEnabled; return { ok: true, enabled: window.__testState.darkModeEnabled }; },
    dismissCookieConsent: async () => ({ ok: true, dismissed: 0 }),
    saveSession: async () => ({ ok: true }),
    restoreSession: async () => ({ ok: true }),
  },
  settings: {
    get: async () => ({ provider: 'mock', gatewayUrl: 'https://opencode.ai/zen/go/v1', model: 'deepseek-v4-flash', apiKey: '' }),
    set: async (s) => { window.__testState.settingsSaved = s; return { ok: true }; },
    getAutoApprove: async () => window.__testState.autoApprove,
    setAutoApprove: async (v) => { window.__testState.autoApprove = !!v; return window.__testState.autoApprove; },
  },
  memory: { get: async () => '', set: async () => ({ ok: true }) },
  events: {
    onBrowserState: (cb) => { window.__testState.callbacks.browserState = cb; setTimeout(emitBrowserState, 0); return () => {}; },
    onPageContext: () => () => {},
    onApprovalRequest: () => () => {},
    onActionLogEntry: () => () => {},
    onDownloadUpdated: () => () => {},
    onLayoutState: () => () => {},
    onVirtualCursor: () => () => {},
  },
};
