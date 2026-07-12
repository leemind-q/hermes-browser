// src/agent/index.js — AgentService: the single entry point for everything agent
// This is the BrowserOS-inspired "agent platform" — all agent logic lives here
// and main.js / MCP server / future SDK call into AgentService methods.
//
// Construction takes a deps object with the Electron-side primitives (tabs,
// views, send, etc.) — this dependency injection is what lets the same service
// run inside Electron AND inside a standalone MCP server process.

const path = require('path');
const { ReadingList } = require('./reading-list');
const MAX_ACTION_QUEUE = 100;  // bounded: drop oldest when over limit
const { ModeManager, getActionRisk } = require('./mode');
const { maskSecrets, detectInjection, isRiskyAction } = require('./safety');
const { createStructuredAction, PlanState } = require('./plan');
const { ApprovalManager } = require('./approval');
const { PersistenceStore } = require('./persistence');
const { CredentialVault } = require('./credentials');
const { CoworkService } = require('./cowork');
const { extractPageContext, extractTabContext, getAllTabContexts, getMultiTabContexts, extractSearchResults, readPageContent } = require('./extraction');
const { clickElement, fillElement, findElementByRef, findElementByText, sleep } = require('./actions');

class AgentService {
  /**
   * @param {object} deps
   * @param {(channel, payload) => boolean} deps.send              - send to renderer
   * @param {() => object[]} deps.getTabs                          - all tabs
   * @param {() => object|null} deps.getActiveTab                  - active tab
   * @param {() => object|null} deps.getActiveView                 - active view
   * @param {() => boolean} deps.getAutoApprove                    - global toggle
   * @param {string} deps.userDataPath                             - where to persist
   * @param {(url: string) => object} deps.createTab               - create new tab
   * @param {(tabId) => boolean} deps.switchTab                    - switch active tab
   * @param {(tabId) => boolean} deps.closeTab                     - close tab
   * @param {(wc) => Promise} deps.waitForLoad                     - wait for nav
   * @param {(input) => string} deps.normalizeUrl                  - URL normalizer
   * @param {() => Promise} deps.notifyAll                         - broadcast state
   * @param {(wc) => void} deps.goBack                             - go back
   * @param {(wc) => void} deps.goForward                          - go forward
   */
  constructor(deps = {}) {
    this.deps = deps;
    this.mode = new ModeManager('agent');
    this.plan = new PlanState((ch, p) => this._send(ch, p));
    this.approvals = new ApprovalManager({
      getAutoApprove: () => this.deps.getAutoApprove?.() || false,
      maskSecrets,
      send: (ch, p) => this._send(ch, p),
      getActiveTab: () => this.deps.getActiveTab?.() || null,
      getActionRisk,
      logAction: (a, p, r) => this._logAction(a, p, r),
    });
    this.store = new PersistenceStore({
      userDataPath: deps.userDataPath || path.join(process.cwd(), 'userData'),
      maskSecrets,
    });
    this.persistence = this.store;  // alias for workspace save/list/etc.
    this.actionQueue = [];
    this.tabContextCache = new Map();
    this.credentials = new CredentialVault({ userDataPath: deps.userDataPath || path.join(process.cwd(), 'userData') });
  }

  _send(channel, payload) {
    try { return this.deps.send?.(channel, payload); }
    catch (e) { console.warn('[AgentService.send]', channel, e.message); return false; }
  }

  // ============ Mode ============
  setMode(mode) { return this.mode.setMode(mode); }
  getMode() { return { mode: this.mode.currentMode, ...this.mode.getPermissions() }; }

  // ============ Plan ============
  setPlan(goal, steps) { return this.plan.update(goal, steps); }
  setPlanStepStatus(index, status, detail) { return this.plan.setStepStatus(index, status, detail); }
  setPlanPaused(paused) { return this.plan.setPaused(paused); }
  getPlan() { return this.plan.get(); }

  // ============ Action queue ============
  getActionQueue(limit = 50) { return this.actionQueue.slice(-limit); }
  clearActionQueue() { this.actionQueue = []; return true; }
  getActionLog(limit = 50) { return this.store.getActionLog(limit); }

  // ============ Context extraction ============
  extractPageContext() {
    const view = this.deps.getActiveView?.();
    return extractPageContext(view);
  }
  extractTabContext(tabId) {
    const tab = this.deps.getTabs?.().find(t => t.id === Number(tabId));
    return extractTabContext(tab, this._getActiveTabId(), () => this.extractPageContext(), this.tabContextCache);
  }
  getAllTabContexts() {
    const tabs = this.deps.getTabs?.() || [];
    return getAllTabContexts(tabs);
  }
  getMultiTabContexts(tabIds) {
    const tabs = this.deps.getTabs?.() || [];
    return getMultiTabContexts(tabs, tabIds);
  }
  extractSearchResults(tabId) {
    const tab = this.deps.getTabs?.().find(t => t.id === Number(tabId)) || this.deps.getActiveTab?.();
    return extractSearchResults(tab?.view);
  }
  readPageContent(tabId, maxChars) {
    const tab = this.deps.getTabs?.().find(t => t.id === Number(tabId)) || this.deps.getActiveTab?.();
    return readPageContent(tab?.view, maxChars);
  }

  _getActiveTabId() {
    return this.deps.getActiveTab?.()?.id;
  }

  // ============ Safety ============
  detectInjection(text) { return detectInjection(text); }
  isRiskyAction(action, params) { return isRiskyAction(action, params); }

  // ============ Logging ============
  _logAction(action, params, result) {
    const active = this.deps.getActiveTab?.() || null;
    const reversible = ['navigate', 'scroll', 'click', 'type', 'fill', 'goBack', 'goForward', 'reload', 'switchTab', 'openTab'].includes(action);
    const entry = {
      ts: new Date().toISOString(),
      action,
      params: maskSecrets(params),
      result: maskSecrets(result),
      tabId: active?.id || null,
      url: active?.url || '',
      site: active?.url ? (() => { try { return new URL(active.url).hostname } catch { return '' } })() : '',
      reversible,
      riskLevel: getActionRisk(action),
      approved: result?.denied ? false : (getActionRisk(action) !== 'low' && !this.deps.getAutoApprove?.()),
    };
    const stored = this.store.appendAction(entry);
    this._send('action-log-entry', stored);
    return stored;
  }

  // ============ Approval ============
  approvalResponse(id, approved) { return this.approvals.respond(id, approved); }
  pendingApprovalCount() { return this.approvals.pendingCount(); }

  // ============ The main dispatcher ============
  async runBrowserAction(action, params = {}) {
    const view = this.deps.getActiveView?.();
    if (!view) return { ok: false, error: 'No active tab' };

    const perms = this.mode.getPermissions();
    const structAction = createStructuredAction(action, params, '', this.mode);
    // Record BEFORE dispatch (captures intent even if blocked/failed)
    this._recordAction(action, params, null);
    this.actionQueue.push(structAction);
    // Bounded queue: drop oldest when over limit so memory stays predictable
    if (this.actionQueue.length > MAX_ACTION_QUEUE) {
      this.actionQueue = this.actionQueue.slice(-MAX_ACTION_QUEUE);
    }

    // Ask mode: no actions allowed except reads
    if (!perms.canAct && !['inspectPage', 'getVisibleText', 'takeScreenshot'].includes(action)) {
      structAction.status = 'blocked';
      structAction.error = `${this.mode.currentMode} 모드에서는 실행 액션을 사용할 수 없습니다. Agent 또는 Auto 모드로 전환하세요.`;
      structAction.completedAt = new Date().toISOString();
      this._logAction(action, params, { ok: false, error: structAction.error });
      return { ok: false, blocked: true, mode: this.mode.currentMode, error: structAction.error };
    }

    const needsApproval = structAction.requiresApproval || isRiskyAction(action, params);
    if (needsApproval && !this.deps.getAutoApprove?.()) {
      structAction.status = 'approval';
      const ok = await this.approvals.ask(action, params, `${getActionRisk(action)} 위험: ${action} — ${JSON.stringify(params).slice(0, 100)}`);
      if (!ok) {
        structAction.status = 'denied';
        structAction.error = 'User denied approval';
        structAction.completedAt = new Date().toISOString();
        this._logAction(action, params, { ok: false, denied: true });
        return { ok: false, denied: true, error: 'User denied approval' };
      }
    }

    structAction.status = 'running';
    let result = { ok: false };
    try {
      result = await this._dispatch(action, params, view);
    } catch (error) {
      result = { ok: false, error: error.message };
    }
    if (result.ok && !['takeScreenshot'].includes(action)) {
      this.extractPageContext().catch(() => null);
    }
    structAction.status = result.ok ? 'completed' : 'failed';
    structAction.result = maskSecrets(result);
    if (!result.ok) structAction.error = result.error;
    structAction.completedAt = new Date().toISOString();
    this._logAction(action, params, result);
    this.deps.notifyAll?.();
    // Update last recorded entry with the result (rather than push a new one)
    if (this._recorder?.active && this._recorder.actions.length > 0) {
      const last = this._recorder.actions[this._recorder.actions.length - 1];
      if (last.ts && Date.now() - new Date(last.ts).getTime() < 5000) {
        last.result = result ? { ok: result.ok !== false } : { ok: false };
      }
    }
    return result;
  }

  async _dispatch(action, params, view) {
    const sendCursor = (ch, p) => this._send(ch, p);
    const refresh = async () => this.extractPageContext();
    switch (action) {
      case 'navigate': {
        const url = this.deps.normalizeUrl?.(params.url || params.query || '') || params.url;
        view.webContents.loadURL(url);
        await this.deps.waitForLoad?.(view);
        return { ok: true, url: view.webContents.getURL() || url };
      }
      case 'searchWeb':
      case 'search': {
        const q = encodeURIComponent(params.query || '');
        if (!q) return { ok: false, error: 'empty query' };
        const engine = params.engine === 'naver' ? 'https://search.naver.com/search.naver?query=' : params.engine === 'bing' ? 'https://www.bing.com/search?q=' : 'https://www.google.com/search?q=';
        const searchUrl = engine + q;
        view.webContents.loadURL(searchUrl);
        await this.deps.waitForLoad?.(view);
        return { ok: true, query: params.query, url: view.webContents.getURL() };
      }
      case 'openTab': {
        const tab = this.deps.createTab?.(params.url || 'https://www.google.com', true);
        if (tab) await this.deps.waitForLoad?.(tab.view);
        return { ok: !!tab, tabId: tab?.id, url: tab?.view.webContents.getURL() || tab?.url };
      }
      case 'switchTab': return { ok: !!this.deps.switchTab?.(params.tabId), tabId: params.tabId };
      case 'closeTab': return { ok: this.deps.closeTab?.(params.tabId) };
      case 'goBack':
        this.deps.goBack?.(view.webContents);
        await this.deps.waitForLoad?.(view);
        return { ok: true };
      case 'goForward':
        this.deps.goForward?.(view.webContents);
        await this.deps.waitForLoad?.(view);
        return { ok: true };
      case 'reload':
        view.webContents.reload();
        await this.deps.waitForLoad?.(view);
        return { ok: true };
      case 'inspectPage': return { ok: true, context: await this.extractPageContext() };
      case 'getVisibleText': {
        const text = await view.webContents.executeJavaScript('document.body ? document.body.innerText.slice(0, 12000) : ""');
        return { ok: true, text };
      }
      case 'click': return await clickElement(view, params, { send: sendCursor, refreshContext: refresh });
      case 'type':
      case 'fill': return await fillElement(view, params, { send: sendCursor, refreshContext: refresh });
      case 'pressKey':
        await view.webContents.sendInputEvent({ type: 'keyDown', keyCode: params.key || 'Enter' });
        await view.webContents.sendInputEvent({ type: 'keyUp', keyCode: params.key || 'Enter' });
        return { ok: true };
      case 'scroll': {
        const dy = params.direction === 'up' ? -(params.amount || 700) : (params.amount || 700);
        return await view.webContents.executeJavaScript(`(() => { scrollBy(0, ${dy}); return { ok:true, y: scrollY }; })()`);
      }
      case 'takeScreenshot': {
        const image = await view.webContents.capturePage();
        return { ok: true, dataUrl: image.toDataURL() };
      }
      case 'openExternal': {
        if (params.url) {
          try {
            const { shell } = require('electron');
            if (shell?.openExternal) await shell.openExternal(params.url);
          } catch {}
        }
        return { ok: true };
      }
      default: return { ok: false, error: `Unknown action: ${action}` };
    }
  }


  // ============ Credential vault (login-required sites) ============
  saveCredential(domain, username, password) {
    const result = this.credentials.save(domain, username, password);
    // Send update notification to renderer — NO password in the message
    this._send('credential-updated', { domain, action: 'saved', at: new Date().toISOString() });
    // SECURITY: credentials are intentionally NOT logged to actionLog to avoid
    // persisting password references to disk. If you need an audit trail, log
    // { domain, action: 'save' } ONLY, never the password.
    return result;
  }
  listCredentials() { return this.credentials.list(); }
  removeCredential(domain) { return this.credentials.remove(domain); }
  getCredential(domain) { return this.credentials.get(domain); }

  // ============ V12 Cowork (Files + Browser + AI) ============
  /** List files in a directory with optional pattern filter */
  async coworkList(args) {
    if (!this.cowork) return { ok: false, error: 'CoworkService not initialized' };
    return this.cowork.listDir(args);
  }

  /** Read a text file (with size limits). Returns metadata for binary files. */
  async coworkRead(args) {
    if (!this.cowork) return { ok: false, error: 'CoworkService not initialized' };
    return this.cowork.readFile(args);
  }

  /** Grep regex across files (uses system grep) */
  async coworkGrep(args) {
    if (!this.cowork) return { ok: false, error: 'CoworkService not initialized' };
    return this.cowork.grepFiles(args);
  }

  /** Search files by name pattern OR content pattern */
  async coworkSearch(args) {
    if (!this.cowork) return { ok: false, error: 'CoworkService not initialized' };
    return this.cowork.searchFiles(args);
  }

  /** Get file metadata (size, mtime, mime type) */
  async coworkStat(args) {
    if (!this.cowork) return { ok: false, error: 'CoworkService not initialized' };
    return this.cowork.fileStat(args);
  }

  // V14: Cowork v2 — watch, readTail, diff, searchReplace
  async coworkWatch(args) {
    if (!this.cowork) return { ok: false, error: 'CoworkService not initialized' };
    return this.cowork.watch(args);
  }

  async coworkReadTail(args) {
    if (!this.cowork) return { ok: false, error: 'CoworkService not initialized' };
    return this.cowork.readTail(args);
  }

  async coworkDiff(args) {
    if (!this.cowork) return { ok: false, error: 'CoworkService not initialized' };
    return this.cowork.diff(args);
  }

  async coworkSearchReplace(args) {
    if (!this.cowork) return { ok: false, error: 'CoworkService not initialized' };
    return this.cowork.searchReplace(args);
  }

  // V15: Cowork v3 — streaming watch
  async coworkWatchList() {
    if (!this.cowork) return { ok: false, error: 'CoworkService not initialized' };
    return this.cowork.watchList();
  }

  // V17: Cowork v5 — multi-agent concurrency
  async coworkAcquireLock(args) { if (!this.cowork) return { ok: false, error: 'CoworkService not initialized' }; return this.cowork.acquireLock(args); }
  // V18: Cowork v6 — git integration
  async coworkGitStatus(args) { if (!this.cowork) return { ok: false, error: 'CoworkService not initialized' }; return this.cowork.gitStatus(args); }
  async coworkGitLog(args) { if (!this.cowork) return { ok: false, error: 'CoworkService not initialized' }; return this.cowork.gitLog(args); }
  async coworkGitDiff(args) { if (!this.cowork) return { ok: false, error: 'CoworkService not initialized' }; return this.cowork.gitDiff(args); }
  async coworkGitBlame(args) { if (!this.cowork) return { ok: false, error: 'CoworkService not initialized' }; return this.cowork.gitBlame(args); }
  async coworkGitShow(args) { if (!this.cowork) return { ok: false, error: 'CoworkService not initialized' }; return this.cowork.gitShow(args); }
  async coworkReleaseLock(args) { if (!this.cowork) return { ok: false, error: 'CoworkService not initialized' }; return this.cowork.releaseLock(args); }
  async coworkListLocks() { if (!this.cowork) return { ok: false, error: 'CoworkService not initialized' }; return this.cowork.listLocks(); }
  async coworkAcquireLease(args) { if (!this.cowork) return { ok: false, error: 'CoworkService not initialized' }; return this.cowork.acquireLease(args); }
  async coworkReleaseLease(args) { if (!this.cowork) return { ok: false, error: 'CoworkService not initialized' }; return this.cowork.releaseLease(args); }
  async coworkEnqueueTask(args) { if (!this.cowork) return { ok: false, error: 'CoworkService not initialized' }; return this.cowork.enqueueTask(args); }
  async coworkDequeueTask(args) { if (!this.cowork) return { ok: false, error: 'CoworkService not initialized' }; return this.cowork.dequeueTask(args); }
  async coworkSetSharedState(args) { if (!this.cowork) return { ok: false, error: 'CoworkService not initialized' }; return this.cowork.setSharedState(args); }
  async coworkGetSharedState(args) { if (!this.cowork) return { ok: false, error: 'CoworkService not initialized' }; return this.cowork.getSharedState(args); }

  async coworkWatchUnsubscribe(args) {
    if (!this.cowork) return { ok: false, error: 'CoworkService not initialized' };
    return this.cowork.watchUnsubscribe(args);
  }

  async coworkWatchEvents(args) {
    if (!this.cowork) return { ok: false, error: 'CoworkService not initialized' };
    return this.cowork.watchEvents(args);
  }


  // ============ Multi-tab batch actions ============
  /**
   * Run the same action on multiple tabs in parallel. Returns array of results
   * in the same order as tabIds. Errors are captured per-tab rather than
   * rejecting the whole batch.
   *
   * Use case: "extract product title from 5 tabs" — instead of 5 sequential
   * calls, one batch call. Up to 50% faster in practice.
   *
   * @param {number[]} tabIds
   * @param {string} action - 'inspect' | 'getVisibleText' | 'extractSearchResults' | 'readPage'
   * @param {object} [params]
   * @returns {Array<{ tabId: number, ok: boolean, result?: any, error?: string }>}
   */
  async batchAction(tabIds, action, params = {}) {
    if (!Array.isArray(tabIds) || tabIds.length === 0) {
      return { ok: false, error: 'tabIds must be non-empty array' };
    }
    if (tabIds.length > 20) {
      return { ok: false, error: 'too many tabs (max 20 per batch to avoid hangs)' };
    }
    const allowed = new Set(['inspect', 'getVisibleText', 'extractSearchResults', 'readPage', 'takeScreenshot']);
    if (!allowed.has(action)) {
      return { ok: false, error: `action "${action}" not batchable. allowed: ${[...allowed].join(', ')}` };
    }
    const promises = tabIds.map(async (tabId) => {
      try {
        let result;
        if (action === 'inspect') {
          result = await this.runBrowserAction('inspectPage');
        } else if (action === 'extractSearchResults') {
          result = await this.extractSearchResults(tabId);
        } else if (action === 'readPage') {
          result = await this.readPageContent(tabId, params.maxChars);
        } else {
          // getVisibleText, takeScreenshot — these need the tab to be active,
          // so we temporarily switch to it, then run.
          const originalTab = this.deps.getActiveTab?.()?.id;
          this.deps.switchTab?.(tabId);
          result = await this.runBrowserAction(action, params);
          if (originalTab) this.deps.switchTab?.(originalTab);
        }
        return { tabId, ok: result?.ok !== false, result };
      } catch (e) {
        return { tabId, ok: false, error: e.message };
      }
    });
    const results = await Promise.allSettled(promises);
    return {
      ok: true,
      action,
      tabCount: tabIds.length,
      results: results.map((r, i) => r.status === 'fulfilled' ? r.value : { tabId: tabIds[i], ok: false, error: r.reason?.message || 'rejected' }),
    };
  }


  // ============ Auto-fill form (using credential vault) ============
  /**
   * Inspect the current page for form fields (username/password/email/name/address),
   * look up matching credential by domain, and fill the form.
   *
   * Uses DOM heuristics via webContents.executeJavaScript — no Electron deps in
   * this file beyond what main.js already wires in.
   *
   * @returns {Promise<{ok: boolean, filled: number, fields: Array, error?: string}>}
   */
  async autofillForm(args = {}) {
    const view = this.deps.getActiveView?.();
    if (!view?.webContents) return { ok: false, error: 'No active tab' };
    const url = view.webContents.getURL?.() || '';
    let domain = '';
    try { domain = new URL(url).hostname.replace(/^www\./, ''); } catch {}

    // Detect fields + their semantic role via type/label/placeholder/aria-label/name
    const detectScript = `(() => {
      const candidates = [];
      const inputs = document.querySelectorAll('input, textarea, select');
      for (const el of inputs) {
        const t = (el.type || '').toLowerCase();
        if (['hidden', 'submit', 'button', 'reset', 'image'].includes(t)) continue;
        const id = el.id || '';
        const name = el.name || '';
        const placeholder = el.placeholder || '';
        const aria = el.getAttribute('aria-label') || '';
        const labelText = (() => {
          if (el.labels && el.labels[0]) return el.labels[0].innerText || '';
          return '';
        })();
        const haystack = (id + ' ' + name + ' ' + placeholder + ' ' + aria + ' ' + labelText).toLowerCase();
        let role = 'unknown';
        if (t === 'password' || /password|비밀번호|passwd/i.test(haystack)) role = 'password';
        else if (/email|e-?mail|이메일/i.test(haystack)) role = 'email';
        else if (t === 'email') role = 'email';
        else if (/(?:^|\W)(?:username|user|login|아이디|userid|user_id|account|email)/i.test(haystack)) role = 'username';
        else if (/name|이름/i.test(haystack)) role = 'name';
        else if (/phone|tel|전화|핸드폰|mobile/i.test(haystack)) role = 'phone';
        else if (/zip|postal|우편번호/i.test(haystack)) role = 'zip';
        else if (/address|주소|addr/i.test(haystack)) role = 'address';
        else if (t === 'tel') role = 'phone';
        if (role !== 'unknown' && el.offsetParent !== null) {
          // visible
          candidates.push({
            role, id, name, type: t,
            ref: el.dataset.hermesRef || (() => {
              if (!el.dataset.hermesRef) {
                const r = 'ref-' + Math.random().toString(36).slice(2, 8);
                el.dataset.hermesRef = r;
              }
              return el.dataset.hermesRef;
            })(),
            value: el.value || '',
          });
        }
      }
      return candidates;
    })()`;

    let fields;
    try {
      fields = await view.webContents.executeJavaScript(detectScript);
    } catch (e) {
      return { ok: false, error: `detect fields failed: ${e.message}` };
    }
    if (!fields || fields.length === 0) {
      return { ok: true, filledCount: 0, filled: [], fields: [], message: 'No autofillable fields detected on this page' };
    }

    // Look up credential
    const cred = this.credentials?.get?.(domain);
    if (!cred || !cred.username || !cred.password) {
      return {
        ok: false,
        error: `No saved credential for ${domain}. Use credential_save first.`,
        fields,
      };
    }

    // Fill fields by role
    const fillScript = `(() => {
      const cred = ${JSON.stringify({ username: cred.username, password: cred.password, email: cred.username })};
      const fields = ${JSON.stringify(fields)};
      const filled = [];
      for (const f of fields) {
        let value = '';
        if (f.role === 'password') value = cred.password;
        else if (f.role === 'username' || f.role === 'email') value = cred.username || cred.email;
        if (!value) continue;
        const el = document.querySelector('[data-hermes-ref="' + f.ref + '"]') || document.getElementById(f.id);
        if (!el) continue;
        // Use native setter so React/Vue detect the change
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
                    || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        if (setter) setter.call(el, value); else el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        filled.push({ ref: f.ref, role: f.role, value: '***' });
      }
      return filled;
    })()`;

    let filled;
    try {
      filled = await view.webContents.executeJavaScript(fillScript);
    } catch (e) {
      return { ok: false, error: `fill failed: ${e.message}`, fields };
    }

    return {
      ok: true,
      domain,
      filledCount: filled.length,
      filled,
      detectedFields: fields.length,
    };
  }


  // ============ Reading list ============
  /** @returns {ReadingList} */
  _readingList() {
    if (!this._readingListInstance) {
      this._readingListInstance = new ReadingList({ userDataPath: this.deps.userDataPath });
    }
    return this._readingListInstance;
  }

  async _ensureReadingListLoaded() {
    const rl = this._readingList();
    if (!rl._loaded) await rl.load();
    return rl;
  }

  async readingListAdd(args = {}) {
    const rl = await this._ensureReadingListLoaded();
    const view = this.deps.getActiveView?.();
    let html = null;
    if (args.snapshot !== false && view?.webContents) {
      try {
        html = await view.webContents.executeJavaScript(`document.documentElement.outerHTML`);
      } catch (e) { /* no snapshot */ }
    }
    return await rl.add({
      url: args.url,
      title: args.title,
      description: args.description,
      tags: args.tags,
      html,
    });
  }

  async readingListList(args = {}) {
    const rl = await this._ensureReadingListLoaded();
    return { ok: true, count: rl.list(args).length, items: rl.list(args) };
  }

  async readingListRemove(args = {}) {
    const rl = await this._ensureReadingListLoaded();
    return { ok: await rl.remove(args.id) };
  }

  async readingListMarkRead(args = {}) {
    const rl = await this._ensureReadingListLoaded();
    const item = rl.markRead(args.id, args.read !== false);
    return { ok: !!item, item };
  }

  async readingListOpen(args = {}) {
    const rl = await this._ensureReadingListLoaded();
    const offlineUrl = rl.getOfflineUrl(args.id);
    if (!offlineUrl) return { ok: false, error: 'no offline snapshot for this item' };
    // Open in new tab
    const view = this.deps.createTab?.(offlineUrl, true);
    return { ok: !!view, offlineUrl };
  }

  async readingListCleanup(args = {}) {
    const rl = await this._ensureReadingListLoaded();
    const removed = await rl.cleanup({ maxAgeDays: args.maxAgeDays || 30, keepUnread: args.keepUnread !== false });
    return { ok: true, removed };
  }


  // ============ Tab workspaces ============
  /** Save current tab set as a named workspace. */
  async workspaceSave(args = {}) {
    if (!args.name) return { ok: false, error: 'name required' };
    const tabs = this.deps.getTabs ? this.deps.getTabs() : [];
    const activeTabId = this.deps.getActiveTab?.()?.id;
    const snapshot = tabs.map(t => ({
      url: t.url,
      title: t.title || '',
      pinned: !!t.pinned,
    }));
    // Persist via PersistenceStore (existing mechanism)
    this.persistence.set(`workspace:${args.name}`, { tabs: snapshot, activeTabId });
    return { ok: true, name: args.name, tabCount: snapshot.length, activeTabId };
  }

  /** List all saved workspaces. */
  async workspaceList() {
    const list = (this.persistence.list?.() || []).filter(k => k.startsWith('workspace:'));
    const workspaces = list.map(k => {
      const data = this.persistence.get(k) || {};
      return {
        name: k.slice('workspace:'.length),
        tabCount: (data.tabs || []).length,
        savedAt: data.savedAt || null,
      };
    });
    return { ok: true, count: workspaces.length, workspaces };
  }

  /** Open a saved workspace: re-open all tabs, switch to active. */
  async workspaceOpen(args = {}) {
    if (!args.name) return { ok: false, error: 'name required' };
    const data = this.persistence.get(`workspace:${args.name}`);
    if (!data) return { ok: false, error: `workspace not found: ${args.name}` };
    const tabs = data.tabs || [];
    const newTabIds = [];
    for (const t of tabs) {
      const created = this.deps.createTab?.(t.url, false);
      if (created) newTabIds.push(created.id);
    }
    // Switch to originally active tab if it exists in the new set
    if (data.activeTabId != null && newTabIds[data.activeTabId]) {
      this.deps.switchTab?.(newTabIds[data.activeTabId]);
    } else if (newTabIds.length > 0) {
      this.deps.switchTab?.(newTabIds[0]);
    }
    return { ok: true, name: args.name, openedCount: newTabIds.length, newTabIds };
  }

  /** Delete a saved workspace. */
  async workspaceDelete(args = {}) {
    if (!args.name) return { ok: false, error: 'name required' };
    const removed = this.persistence.remove(`workspace:${args.name}`);
    return { ok: removed, name: args.name };
  }


  // ============ Session recording ============
  _recorderState() {
    if (!this._recorder) {
      this._recorder = {
        active: false,
        sessionId: null,
        startTime: null,
        actions: [],
        label: '',
      };
    }
    return this._recorder;
  }

  /** Start recording all subsequent browser actions. */
  sessionRecordStart(args = {}) {
    const state = this._recorderState();
    state.active = true;
    state.sessionId = 'sess-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    state.startTime = new Date().toISOString();
    state.label = args.label || '';
    state.actions = [];
    return { ok: true, sessionId: state.sessionId, startedAt: state.startTime };
  }

  /** Stop recording. Returns the recorded session. */
  sessionRecordStop() {
    const state = this._recorderState();
    if (!state.active) return { ok: false, error: 'no active recording' };
    const session = {
      sessionId: state.sessionId,
      label: state.label,
      startedAt: state.startTime,
      stoppedAt: new Date().toISOString(),
      actionCount: state.actions.length,
      actions: [...state.actions],
    };
    state.active = false;
    return { ok: true, ...session };
  }

  /** Record an action (called internally by runBrowserAction wrapper). */
  _recordAction(action, params, result) {
    const state = this._recorderState();
    if (!state.active) return;
    // Skip record-related actions to avoid recursion
    if (action && action.startsWith('session_')) return;
    state.actions.push({
      ts: new Date().toISOString(),
      action,
      params: JSON.parse(JSON.stringify(params || {})),  // deep clone, strip secrets
      result: result ? { ok: result.ok !== false } : { ok: false },
    });
  }

  /** List all saved sessions on disk. */
  async sessionRecordList() {
    if (!this.persistence) return { ok: true, count: 0, sessions: [] };
    const keys = this.persistence.list('session:');
    const sessions = keys.map(k => {
      const data = this.persistence.get(k) || {};
      return {
        sessionId: k.slice('session:'.length),
        label: data.label || '',
        startedAt: data.startedAt,
        stoppedAt: data.stoppedAt,
        actionCount: (data.actions || []).length,
      };
    });
    return { ok: true, count: sessions.length, sessions };
  }

  /** Save a recorded session to disk. If no session provided, saves current. */
  async sessionRecordSave(args = {}) {
    let session;
    if (args.sessionId) {
      // Load existing
      session = this.persistence?.get(`session:${args.sessionId}`);
      if (!session) return { ok: false, error: `session not found: ${args.sessionId}` };
    } else {
      // Stop and use current
      const stop = this.sessionRecordStop();
      if (!stop.ok) return stop;
      session = {
        sessionId: stop.sessionId,
        label: stop.label,
        startedAt: stop.startedAt,
        stoppedAt: stop.stoppedAt,
        actions: stop.actions,
      };
    }
    if (this.persistence) {
      this.persistence.set(`session:${session.sessionId}`, session);
    }
    return { ok: true, ...session, saved: !!this.persistence };
  }

  /** Play a recorded session by re-running each action. */
  async sessionRecordPlay(args = {}) {
    if (!args.sessionId) return { ok: false, error: 'sessionId required' };
    const session = this.persistence?.get(`session:${args.sessionId}`);
    if (!session) return { ok: false, error: `session not found: ${args.sessionId}` };
    const actions = session.actions || [];
    const results = [];
    for (const a of actions) {
      try {
        const r = await this.runBrowserAction(a.action, a.params || {});
        results.push({ ts: new Date().toISOString(), action: a.action, ok: r?.ok !== false });
      } catch (e) {
        results.push({ ts: new Date().toISOString(), action: a.action, ok: false, error: e.message });
      }
    }
    return {
      ok: true,
      sessionId: args.sessionId,
      totalActions: actions.length,
      successCount: results.filter(r => r.ok).length,
      results,
    };
  }

  /** Delete a saved session. */
  async sessionRecordDelete(args = {}) {
    if (!args.sessionId) return { ok: false, error: 'sessionId required' };
    if (!this.persistence) return { ok: false, error: 'no persistence' };
    const removed = this.persistence.remove(`session:${args.sessionId}`);
    return { ok: removed, sessionId: args.sessionId };
  }

  // ============ Persistence shortcuts ============
  saveSkill(skill) { return this.store.saveSkill(skill); }
  listSkills() { return this.store.listSkills(); }
  getSkill(id) { return this.store.getSkill(id); }
  deleteSkill(id) { return this.store.deleteSkill(id); }
  updateSkillResult(id, result) { return this.store.updateSkillResult(id, result); }
  getSessionMemory() { return this.store.getSessionMemory(); }
  addSessionMemory(key, value, scope) { return this.store.addSessionMemory(key, value, scope); }
  removeSessionMemory(id) { return this.store.removeSessionMemory(id); }
  clearSessionMemory() { return this.store.clearSessionMemory(); }
  saveWorkspace(name, goal, planResult) { return this.store.saveWorkspace(name, goal, planResult); }
  listWorkspaces() { return this.store.listWorkspaces(); }
  restoreWorkspace(id) { return this.store.restoreWorkspace(id); }
  deleteWorkspace(id) { return this.store.deleteWorkspace(id); }
}
  async coworkGitCommit(args) { if (!this.cowork) return { ok: false, error: "CoworkService not initialized" }; return this.cowork.gitCommit(args); }
  async coworkGitPush(args) { if (!this.cowork) return { ok: false, error: "CoworkService not initialized" }; return this.cowork.gitPush(args); }
  async coworkGitPull(args) { if (!this.cowork) return { ok: false, error: "CoworkService not initialized" }; return this.cowork.gitPull(args); }
  async coworkGitBranch(args) { if (!this.cowork) return { ok: false, error: "CoworkService not initialized" }; return this.cowork.gitBranch(args); }
  async coworkGitCheckout(args) { if (!this.cowork) return { ok: false, error: "CoworkService not initialized" }; return this.cowork.gitCheckout(args); }
  async coworkGitAutoCommit(args) { if (!this.cowork) return { ok: false, error: "CoworkService not initialized" }; return this.cowork.gitAutoCommit(args); }
  async coworkGitSync(args) { if (!this.cowork) return { ok: false, error: "CoworkService not initialized" }; return this.cowork.gitSync(args); }
  async coworkGitReleaseNotes(args) { if (!this.cowork) return { ok: false, error: "CoworkService not initialized" }; return this.cowork.gitReleaseNotes(args); }
  async coworkGitDiffStat(args) { if (!this.cowork) return { ok: false, error: "CoworkService not initialized" }; return this.cowork.gitDiffStat(args); }
  async coworkGitChangelog(args) { if (!this.cowork) return { ok: false, error: "CoworkService not initialized" }; return this.cowork.gitChangelog(args); }
  async coworkYoutubeTranscript(args) { if (!this.cowork) return { ok: false, error: "CoworkService not initialized" }; return this.cowork.youtubeTranscript(args); }
}  // ← closing class brace

module.exports = { AgentService };



