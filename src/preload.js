// src/preload.js — Miraecle secure bridge
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, cb) => {
  const listener = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('hermes', {
  window: { close: () => ipcRenderer.invoke('win:close'), min: () => ipcRenderer.invoke('win:min'), max: () => ipcRenderer.invoke('win:max') },
  browser: {
    newTab: (url) => ipcRenderer.invoke('browser:newTab', url),
    switchTab: (id) => ipcRenderer.invoke('browser:switchTab', id),
    closeTab: (id) => ipcRenderer.invoke('browser:closeTab', id),
    navigate: (url) => ipcRenderer.invoke('browser:navigate', url),
    action: (action, params) => ipcRenderer.invoke('browser:action', action, params),
    getState: () => ipcRenderer.invoke('browser:getState'),
    togglePanel: () => ipcRenderer.invoke('browser:togglePanel'),
    toggleLeftPanel: () => ipcRenderer.invoke('browser:toggleLeftPanel'),
    toggleRightPanel: () => ipcRenderer.invoke('browser:toggleRightPanel'),
    findInPage: (query) => ipcRenderer.invoke('browser:findInPage', query),
    stopFind: () => ipcRenderer.invoke('browser:stopFind'),
    print: () => ipcRenderer.invoke('browser:print'),
    viewSource: () => ipcRenderer.invoke('browser:viewSource'),
    devTools: () => ipcRenderer.invoke('browser:devTools'),
    reorderTabs: (orderedIds) => ipcRenderer.invoke('browser:reorderTabs', orderedIds),
    getDownloads: () => ipcRenderer.invoke('browser:getDownloads'),
    clearDownloads: () => ipcRenderer.invoke('browser:clearDownloads'),
    getHistory: () => ipcRenderer.invoke('browser:getHistory'),
    clearHistory: () => ipcRenderer.invoke('browser:clearHistory'),
    getActionLog: () => ipcRenderer.invoke('browser:getActionLog'),
    clearActionLog: () => ipcRenderer.invoke('browser:clearActionLog'),
    approvalResponse: (id, approved) => ipcRenderer.invoke('browser:approvalResponse', id, approved),
    getAutoApprove: () => ipcRenderer.invoke('settings:getAutoApprove'),
    setAutoApprove: (val) => ipcRenderer.invoke('settings:setAutoApprove', val),
    pinTab: (id) => ipcRenderer.invoke('browser:pinTab', id),
    toggleReadMode: () => ipcRenderer.invoke('browser:toggleReadMode'),
    toggleDarkMode: () => ipcRenderer.invoke('browser:toggleDarkMode'),
    dismissCookieConsent: () => ipcRenderer.invoke('browser:dismissCookieConsent'),
    saveSession: () => ipcRenderer.invoke('browser:saveSession'),
    restoreSession: () => ipcRenderer.invoke('browser:restoreSession'),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (s) => ipcRenderer.invoke('settings:set', s),
    getAutoApprove: () => ipcRenderer.invoke('settings:getAutoApprove'),
    setAutoApprove: (val) => ipcRenderer.invoke('settings:setAutoApprove', val),
  },
  memory: {
    get: (type) => ipcRenderer.invoke('memory:get', type),
    set: (type, content) => ipcRenderer.invoke('memory:set', type, content),
  },
  agent: {
    setMode: (mode) => ipcRenderer.invoke('agent:setMode', mode),
    getMode: () => ipcRenderer.invoke('agent:getMode'),
    getPlan: () => ipcRenderer.invoke('agent:getPlan'),
    setPlan: (goal, steps) => ipcRenderer.invoke('agent:setPlan', goal, steps),
    setStepStatus: (index, status, detail) => ipcRenderer.invoke('agent:setStepStatus', index, status, detail),
    pausePlan: (paused) => ipcRenderer.invoke('agent:pausePlan', paused),
    getActionQueue: () => ipcRenderer.invoke('agent:getActionQueue'),
    clearActionQueue: () => ipcRenderer.invoke('agent:clearActionQueue'),
    checkInjection: (text) => ipcRenderer.invoke('agent:checkInjection', text),
    pause: () => ipcRenderer.invoke('agent:pause'),
    resume: () => ipcRenderer.invoke('agent:resume'),
    undoAction: (logIndex) => ipcRenderer.invoke('agent:undoAction', logIndex),
    getActionLog: () => ipcRenderer.invoke('agent:getActionLog'),
  },
  multiTab: {
    getTabContext: (tabId) => ipcRenderer.invoke('browser:getTabContext', tabId),
    getAllTabContexts: () => ipcRenderer.invoke('browser:getAllTabContexts'),
    getMultiTabContexts: (tabIds) => ipcRenderer.invoke('browser:getMultiTabContexts', tabIds),
    autoGroupTabs: () => ipcRenderer.invoke('browser:autoGroupTabs'),
  },
  workspace: {
    save: (name, goal, planResult) => ipcRenderer.invoke('workspace:save', name, goal, planResult),
    list: () => ipcRenderer.invoke('workspace:list'),
    restore: (id) => ipcRenderer.invoke('workspace:restore', id),
    delete: (id) => ipcRenderer.invoke('workspace:delete', id),
  },
  research: {
    createResultTab: (opts) => ipcRenderer.invoke('browser:createResultTab', opts),
  },
  sessionMemory: {
    get: () => ipcRenderer.invoke('memory:getSession'),
    add: (key, value, scope) => ipcRenderer.invoke('memory:addSession', key, value, scope),
    remove: (id) => ipcRenderer.invoke('memory:removeSession', id),
    clear: () => ipcRenderer.invoke('memory:clearSession'),
  },
  skill: {
    save: (skill) => ipcRenderer.invoke('skill:save', skill),
    list: () => ipcRenderer.invoke('skill:list'),
    get: (id) => ipcRenderer.invoke('skill:get', id),
    delete: (id) => ipcRenderer.invoke('skill:delete', id),
    updateResult: (id, result) => ipcRenderer.invoke('skill:updateResult', id, result),
  },
  inlineAI: {
    inject: () => ipcRenderer.invoke('browser:injectInlineAI'),
    remove: () => ipcRenderer.invoke('browser:removeInlineAI'),
  },
  file: {
    readContent: (filePath) => ipcRenderer.invoke('file:readContent', filePath),
  },
  credential: {
    save: (domain, username, password) => ipcRenderer.invoke('credential:save', domain, username, password),
    list: () => ipcRenderer.invoke('credential:list'),
    remove: (domain) => ipcRenderer.invoke('credential:remove', domain),
  },
  search: {
    extractResults: (tabId) => ipcRenderer.invoke('search:extractResults', tabId),
    readPage: (tabId, maxChars) => ipcRenderer.invoke('search:readPage', tabId, maxChars),
    readUrl: (url) => ipcRenderer.invoke('search:readUrl', url),
  },
  zoom: {
    set: (factor) => ipcRenderer.invoke('zoom:set', factor),
    get: () => ipcRenderer.invoke('zoom:get'),
    setDomain: (domain, factor) => ipcRenderer.invoke('zoom:setDomain', domain, factor),
    getDomain: (domain) => ipcRenderer.invoke('zoom:getDomain', domain),
    reset: () => ipcRenderer.invoke('zoom:reset'),
    autoFit: () => ipcRenderer.invoke('zoom:autoFit'),
  },
  diag: {
    webview: () => ipcRenderer.invoke('diag:webview'),
  },
  events: {
    onBrowserState: (cb) => on('browser-state', cb),
    onPageContext: (cb) => on('page-context', cb),
    onApprovalRequest: (cb) => on('approval-request', cb),
    onActionLogEntry: (cb) => on('action-log-entry', cb),
    onDownloadUpdated: (cb) => on('download-updated', cb),
    onLayoutState: (cb) => on('layout-state', cb),
    onVirtualCursor: (cb) => on('virtual-cursor', cb),
    onPlanState: (cb) => on('plan-state', cb),
    onModeChanged: (cb) => on('mode-changed', cb),
    onInjectionWarning: (cb) => on('injection-warning', cb),
  },
});
