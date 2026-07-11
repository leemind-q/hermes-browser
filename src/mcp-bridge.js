// src/mcp-bridge.js — HTTP bridge between Electron main and the MCP server
//
// Architecture:
//
//   External AI client (Claude Code / Cursor)
//       │
//       │  stdio JSON-RPC
//       ▼
//   mcp-server/server.js
//       │
//       │  HTTP POST localhost:8780/mcp/tool  (or websocket — currently HTTP)
//       ▼
//   THIS BRIDGE (spawned inside Electron main process)
//       │
//       │  uses AgentService (in-process, no HTTP)
//       ▼
//   Electron main → agent/* → WebContentsView (the actual browser)
//
// Why HTTP and not just in-process?
//   - In dev: we can `curl localhost:8780/mcp/tools` to inspect what we expose
//   - In prod: HTTP is universal — works with any client not just stdio MCP
//   - Easy to add auth, rate-limiting, telemetry later
//
// The bridge is started inside Electron's main.js after `agent = buildAgent()`.

const http = require('http');

/**
 * Create an HTTP server that proxies MCP tool calls into our AgentService.
 *
 * @param {object} deps
 * @param {object} deps.agent      — the AgentService instance from main.js
 * @param {number} [deps.port=8780]
 * @param {string} [deps.host='127.0.0.1']
 * @param {(method: string, path: string, payload: object) => void} [deps.log]
 * @returns {{ server: http.Server, port: number, close: () => Promise<void> }}
 */

// ============ Rate limiter ============
// Sliding window per peer (token). Default: 60 requests / 60 seconds.
// Returns { allowed, retryAfterMs } so callers can respond with 429.
const DEFAULT_RATE_LIMIT = 60;
const DEFAULT_RATE_WINDOW_MS = 60_000;

class RateLimiter {
  constructor({ limit = DEFAULT_RATE_LIMIT, windowMs = DEFAULT_RATE_WINDOW_MS } = {}) {
    this.limit = limit;
    this.windowMs = windowMs;
    // Map<peerId, number[]> of timestamps within window
    this.peers = new Map();
  }

  /**
   * Try to consume a slot for this peer. Returns { allowed, retryAfterMs, remaining }.
   * Memory: bounded by `limit` per peer (oldest timestamp dropped on overflow).
   */
  check(peerId) {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    let history = this.peers.get(peerId) || [];
    // Drop timestamps older than window
    while (history.length > 0 && history[0] < cutoff) history.shift();
    if (history.length >= this.limit) {
      const oldest = history[0];
      const retryAfterMs = Math.max(0, oldest + this.windowMs - now);
      return { allowed: false, retryAfterMs, remaining: 0 };
    }
    history.push(now);
    this.peers.set(peerId, history);
    return { allowed: true, retryAfterMs: 0, remaining: this.limit - history.length };
  }

  /** Periodically GC empty peers to bound memory. */
  gc() {
    const cutoff = Date.now() - this.windowMs;
    for (const [peer, history] of this.peers.entries()) {
      while (history.length > 0 && history[0] < cutoff) history.shift();
      if (history.length === 0) this.peers.delete(peer);
    }
  }

  /** Test hook: clear all state. */
  reset() { this.peers.clear(); }
}

function createBridge({ agent, port = 8780, host = '127.0.0.1', log = () => {}, token = null, timeoutMs = 30_000 }) {
  if (!agent) throw new Error('createBridge: agent required');
  // SECURITY: localhost-only is not enough — other local users / scripts could
  // connect. We require a bearer token on every tool call. Token is generated
  // at startup if not provided (recommended), or can be passed for fixed tokens
  // (e.g. CI). Health check and tools list are public for dev convenience.
  const authToken = token || require('crypto').randomBytes(16).toString('hex');
  const rateLimiter = new RateLimiter({ limit: 60, windowMs: 60_000 });

  const checkAuth = (req, res) => {
    const auth = req.headers['authorization'] || '';
    const expected = `Bearer ${authToken}`;
    if (auth !== expected) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized', hint: 'provide Authorization: Bearer <token>' }));
      return false;
    }
    return true;
  };

  const server = http.createServer(async (req, res) => {
    // CORS so browser tools can hit this directly during dev
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // Health check — public
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, agent: 'hermes-browser-agent', version: '1.0.0', authRequired: true }));
      return;
    }

    // Token endpoint — returns the auth token for local processes.
    // Only available when host is 127.0.0.1 (refuses on 0.0.0.0).
    if (req.method === 'GET' && req.url === '/auth/token' && host === '127.0.0.1') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ token: authToken }));
      return;
    }

    // List tools — public for dev/debugging (read-only, no credentials)
    if (req.method === 'GET' && req.url === '/mcp/tools') {
      const tools = listTools();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ tools }));
      return;
    }

    // Call a tool — requires auth + rate limit
    if (req.method === 'POST' && req.url === '/mcp/tool') {
      if (!checkAuth(req, res)) return;
      // Rate limit per token. We use the token as the peer key — same token
      // shares a quota. Reject before parsing the body to save CPU on floods.
      const auth = (req.headers['authorization'] || '').replace(/^Bearer\s+/, '');
      const rl = rateLimiter.check(auth);
      res.setHeader('X-RateLimit-Limit', String(rateLimiter.limit));
      res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
      if (!rl.allowed) {
        res.setHeader('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)));
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'rate_limited', retryAfterMs: rl.retryAfterMs }));
        return;
      }
      let body = '';
      req.on('data', chunk => { body += chunk; if (body.length > 1e6) req.destroy(); });
      req.on('end', async () => {
        let parsed;
        try { parsed = JSON.parse(body); }
        catch { res.writeHead(400); res.end(JSON.stringify({ error: 'invalid JSON' })); return; }
        const { name, args = {} } = parsed;
        // === Request ID: per-call UUID for log correlation ===
        const reqId = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
        res.setHeader('X-Request-Id', reqId);
        if (!name) { log('warn', reqId, '400 missing name'); res.writeHead(400); res.end(JSON.stringify({ error: 'name required' })); return; }
        try {
          // === Timeout: hard cap on tool execution so a stuck agent
          // (e.g. infinite retry loop, slow navigation) doesn't hang the bridge.
          const TIMEOUT_MS = timeoutMs || 30_000;
          const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout after ${TIMEOUT_MS}ms`)), TIMEOUT_MS));
          const result = await Promise.race([dispatchTool(agent, name, args), timeoutPromise]);
          log('tool', reqId, name, args);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, result, requestId: reqId }));
        } catch (e) {
          log('error', reqId, name, e.message);
          const isTimeout = /timeout/.test(e.message);
          res.writeHead(isTimeout ? 504 : 500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message, requestId: reqId }));
        }
      });
      return;
    }

    // Unknown route
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found', routes: ['GET /health', 'GET /mcp/tools', 'GET /auth/token (localhost only)', 'POST /mcp/tool (requires Bearer token)'] }));
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const addr = server.address();
      const actualPort = addr.port;
      log('start', `bridge listening on http://${host}:${actualPort}`);
      // GC rate limiter every 5 minutes; clear interval on server close.
      const rlGcInterval = setInterval(() => rateLimiter.gc(), 5 * 60_000);
      const _origClose = server.close.bind(server);
      server.close = (cb) => { clearInterval(rlGcInterval); return _origClose(cb); };
      if (host !== '127.0.0.1') {
        console.warn(`[mcp-bridge] WARNING: bound to ${host} — auth token required but be aware of network exposure`);
      } else {
        console.log(`[mcp-bridge] auth token (localhost only): ${authToken}`);
      }
      resolve({
        server,
        port: actualPort,
        token: authToken,
        close: () => new Promise(r => server.close(r)),
      });
    });
  });
}

// ============ Tool registry (kept in sync with mcp-server/server.js) ============
// We duplicate this list (rather than importing from mcp-server/) so the
// Electron side has zero coupling to the MCP-protocol layer. The MCP server
// itself imports AgentService, but the bridge does NOT need to know about MCP.

function listTools() {
  return [
    { name: 'browser_navigate', description: 'Navigate active tab', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
    { name: 'browser_search', description: 'Run web search', inputSchema: { type: 'object', properties: { query: { type: 'string' }, engine: { type: 'string', enum: ['google', 'naver', 'bing'] } }, required: ['query'] } },
    { name: 'browser_click', description: 'Click element', inputSchema: { type: 'object', properties: { selector: { type: 'string' }, ref: { type: 'string' }, text: { type: 'string' } } } },
    { name: 'browser_fill', description: 'Fill input', inputSchema: { type: 'object', properties: { selector: { type: 'string' }, ref: { type: 'string' }, value: { type: 'string' } } } },
    { name: 'browser_autofill_form', description: 'Auto-fill all form fields on the current page using saved credentials. Detects username/password/email/name/address fields, looks up credential by domain, fills it.', inputSchema: { type: 'object', properties: {} } },
    { name: 'reading_list_add', description: 'Add current page (or given URL) to offline reading list.', inputSchema: { type: 'object', properties: { url: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, snapshot: { type: 'boolean' } } } },
    { name: 'reading_list_list', description: 'List reading list items.', inputSchema: { type: 'object', properties: { unreadOnly: { type: 'boolean' }, tag: { type: 'string' } } } },
    { name: 'reading_list_remove', description: 'Remove item by id.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
    { name: 'reading_list_mark_read', description: 'Mark item read/unread.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, read: { type: 'boolean' } }, required: ['id'] } },
    { name: 'reading_list_open', description: 'Open the offline snapshot of an item in a new tab.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
    { name: 'reading_list_cleanup', description: 'Remove old read items.', inputSchema: { type: 'object', properties: { maxAgeDays: { type: 'number' }, keepUnread: { type: 'boolean' } } } },
    { name: 'workspace_save', description: 'Save current tabs as a named workspace.', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
    { name: 'workspace_list', description: 'List all saved workspaces.', inputSchema: { type: 'object', properties: {} } },
    { name: 'workspace_open', description: 'Re-open all tabs of a saved workspace.', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
    { name: 'workspace_delete', description: 'Delete a saved workspace.', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
    { name: 'session_record_start', description: 'Start recording browser actions.', inputSchema: { type: 'object', properties: { label: { type: 'string' } } } },
    { name: 'session_record_stop', description: 'Stop recording.', inputSchema: { type: 'object', properties: {} } },
    { name: 'session_record_save', description: 'Save recording to disk.', inputSchema: { type: 'object', properties: { sessionId: { type: 'string' } } } },
    { name: 'session_record_list', description: 'List saved sessions.', inputSchema: { type: 'object', properties: {} } },
    { name: 'session_record_play', description: 'Re-run a saved session.', inputSchema: { type: 'object', properties: { sessionId: { type: 'string' } }, required: ['sessionId'] } },
    { name: 'session_record_delete', description: 'Delete a saved session.', inputSchema: { type: 'object', properties: { sessionId: { type: 'string' } }, required: ['sessionId'] } },


    { name: 'browser_get_visible_text', description: 'Read page text', inputSchema: { type: 'object' } },
    { name: 'browser_inspect_page', description: 'Get page context', inputSchema: { type: 'object' } },
    { name: 'browser_extract_search_results', description: 'Extract SERP results', inputSchema: { type: 'object', properties: { tabId: { type: 'number' } } } },
    { name: 'browser_read_page', description: 'Read structured page', inputSchema: { type: 'object', properties: { tabId: { type: 'number' }, maxChars: { type: 'number' } } } },
    { name: 'browser_open_tab', description: 'Open new tab', inputSchema: { type: 'object', properties: { url: { type: 'string' } } } },
    { name: 'browser_switch_tab', description: 'Switch active tab', inputSchema: { type: 'object', properties: { tabId: { type: 'number' } }, required: ['tabId'] } },
    { name: 'browser_close_tab', description: 'Close tab', inputSchema: { type: 'object', properties: { tabId: { type: 'number' } } } },
    { name: 'browser_get_tabs', description: 'List tabs', inputSchema: { type: 'object' } },
    { name: 'browser_take_screenshot', description: 'Capture screenshot', inputSchema: { type: 'object' } },
    { name: 'browser_scroll', description: 'Scroll page', inputSchema: { type: 'object', properties: { direction: { type: 'string', enum: ['up', 'down'] }, amount: { type: 'number' } } } },
    { name: 'browser_check_injection', description: 'Check for prompt injection', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
    { name: 'browser_get_mode', description: 'Get agent mode', inputSchema: { type: 'object' } },
    { name: 'browser_set_mode', description: 'Set agent mode', inputSchema: { type: 'object', properties: { mode: { type: 'string', enum: ['ask', 'assist', 'agent', 'auto'] } }, required: ['mode'] } },
    { name: 'browser_provider_list', description: 'List all supported LLM provider presets (mock, lmstudio, ollama, openai, anthropic, google, openrouter, minimax, browseros, openai-compatible).', inputSchema: { type: 'object' } },
    { name: 'browser_test_provider', description: 'Test connection to a provider. Verifies reachability, returns latency in ms. Supports OpenAI-compat, Anthropic-native, and Google-native endpoints.', inputSchema: { type: 'object', properties: { provider: { type: 'string' }, gatewayUrl: { type: 'string' }, apiKey: { type: 'string' }, model: { type: 'string' } }, required: ['provider', 'gatewayUrl'] } },
  ];
}

// V12: Provider presets + test — dispatched via MCP
async function getProviderPresets() {
  return [
    { id: 'mock', gatewayUrl: 'https://opencode.ai/zen/go/v1', model: 'deepseek-v4-flash', description: 'Mock — uses opencode-go proxy' },
    { id: 'lmstudio', gatewayUrl: 'http://127.0.0.1:1234/v1', model: 'qwen2.5-3b-instruct', description: 'LM Studio local (:1234)' },
    { id: 'ollama', gatewayUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:3b', description: 'Ollama local (:11434)' },
    { id: 'openai', gatewayUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', description: 'OpenAI cloud' },
    { id: 'anthropic', gatewayUrl: 'https://api.anthropic.com', model: 'claude-3-5-haiku-20241022', description: 'Anthropic native /v1/messages', nativeAnthropic: true },
    { id: 'google', gatewayUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash', description: 'Google Gemini native REST', nativeGoogle: true },
    { id: 'openrouter', gatewayUrl: 'https://openrouter.ai/api/v1', model: 'deepseek/deepseek-chat-v3-0324', description: 'OpenRouter aggregator' },
    { id: 'minimax', gatewayUrl: 'https://api.minimax.io/anthropic', model: 'MiniMax-M3', description: 'MiniMax M3 (anthropic-compat)', nativeAnthropic: true },
    { id: 'browseros', gatewayUrl: 'https://browseros.com/api/v1', model: 'kimi-k2-0711', description: 'BrowserOS — open-source Chromium AI browser' },
    { id: 'openai-compatible', gatewayUrl: '', model: '', description: 'Custom OpenAI-compatible endpoint' },
  ];
}

async function testProviderConnection(args) {
  const { provider, gatewayUrl, apiKey, model } = args || {};
  if (!provider || !gatewayUrl) return { ok: false, error: 'provider and gatewayUrl required' };
  const start = Date.now();
  try {
    const base = gatewayUrl.replace(/\/+$/, '');
    const presets = await getProviderPresets();
    const preset = presets.find(p => p.id === provider) || {};
    let url, headers, body;
    if (preset.nativeAnthropic || provider === 'anthropic' || provider === 'minimax') {
      // All nativeAnthropic providers: POST {base}/v1/messages
      // For MiniMax: base = https://api.minimax.io/anthropic → endpoint = {base}/v1/messages
      // MiniMax uses X-Api-Key (capitalized) per Hermes memory
      url = `${base}/v1/messages`;
      const apiKeyHeader = provider === 'minimax' ? 'X-Api-Key' : 'x-api-key';
      headers = {
        'Content-Type': 'application/json',
        [apiKeyHeader]: apiKey || '',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      };
      body = JSON.stringify({
        model: model || preset.model || 'claude-3-5-haiku-20241022',
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
    return { ok: true, latencyMs, model: model || preset.model, provider };
  } catch (e) {
    return { ok: false, error: e.message, latencyMs: Date.now() - start };
  }
}

async function dispatchTool(agent, name, args) {
  switch (name) {
    case 'browser_navigate': return agent.runBrowserAction('navigate', { url: args.url });
    case 'browser_search': return agent.runBrowserAction('search', { query: args.query, engine: args.engine });
    case 'browser_click': return agent.runBrowserAction('click', args);
    case 'browser_fill': return agent.runBrowserAction('fill', args);
    case 'browser_autofill_form': return agent.autofillForm(args);
    case 'reading_list_add': return await agent.readingListAdd(args);
    case 'reading_list_list': return await agent.readingListList(args);
    case 'reading_list_remove': return await agent.readingListRemove(args);
    case 'reading_list_mark_read': return await agent.readingListMarkRead(args);
    case 'reading_list_open': return await agent.readingListOpen(args);
    case 'reading_list_cleanup': return await agent.readingListCleanup(args);
    case 'workspace_save': return await agent.workspaceSave(args);
    case 'workspace_list': return await agent.workspaceList();
    case 'workspace_open': return await agent.workspaceOpen(args);
    case 'workspace_delete': return await agent.workspaceDelete(args);
    case 'session_record_start': return agent.sessionRecordStart(args);
    case 'session_record_stop': return agent.sessionRecordStop();
    case 'session_record_save': return await agent.sessionRecordSave(args);
    case 'session_record_list': return await agent.sessionRecordList();
    case 'session_record_play': return await agent.sessionRecordPlay(args);
    case 'session_record_delete': return await agent.sessionRecordDelete(args);
    case 'browser_get_visible_text': return agent.runBrowserAction('getVisibleText');
    case 'browser_inspect_page': return agent.runBrowserAction('inspectPage');
    case 'browser_extract_search_results': return agent.extractSearchResults(args.tabId);
    case 'browser_read_page': return agent.readPageContent(args.tabId, args.maxChars);
    case 'browser_open_tab': return agent.runBrowserAction('openTab', { url: args.url });
    case 'browser_switch_tab': return agent.runBrowserAction('switchTab', { tabId: args.tabId });
    case 'browser_close_tab': return agent.runBrowserAction('closeTab', { tabId: args.tabId });
    case 'browser_get_tabs': return agent.getAllTabContexts();
    case 'browser_batch_action': return await agent.batchAction(args.tabIds, args.action, { maxChars: args.maxChars });
    case 'schedule_task': return agent.scheduler?.add({ id: args.id, cron: args.cron, action: args.action, args: args.args || {} });
    case 'schedule_list': return { ok: true, tasks: agent.scheduler?.list() || [] };
    case 'schedule_remove': return { ok: agent.scheduler?.remove(args.id) };
    case 'schedule_run_now': {
      const task = agent.scheduler?.list().find(t => t.id === args.id);
      if (!task) return { ok: false, error: `task not found: ${args.id}` };
      return await agent.scheduler._runOne(task, new Date());
    }
    case 'browser_take_screenshot': return agent.runBrowserAction('takeScreenshot');
    case 'browser_scroll': return agent.runBrowserAction('scroll', args);
    case 'browser_check_injection': return agent.detectInjection(args.text);
    case 'browser_get_mode': return agent.getMode();
    case 'browser_set_mode': return agent.setMode(args.mode);
    case 'credential_save': return agent.saveCredential(args.domain, args.username, args.password);
    case 'credential_list': return agent.listCredentials();
    case 'credential_remove': return agent.removeCredential(args.domain);
    case 'browser_provider_list': return await getProviderPresets();
    case 'browser_test_provider': return await testProviderConnection(args);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

module.exports = { createBridge, listTools, dispatchTool, RateLimiter };
