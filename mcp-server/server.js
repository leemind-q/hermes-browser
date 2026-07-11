// mcp-server/server.js — Hermes Browser MCP Server
// Exposes our browser's agent capabilities as MCP tools so external AI agents
// (Claude Code, Cursor, Cline, etc.) can drive our browser via the standard
// Model Context Protocol.
//
// Architecture:
//   External AI client  ───stdio (JSON-RPC)───  this server  ───HTTP/socket───  Electron main.js
//                                                                  (or in-process bridge for PoC)
//
// For the PoC we use the IN-PROCESS mode: this server connects directly to
// AgentService over an EventEmitter bridge (no Electron needed for testing).
// Production mode would open a TCP socket or WebSocket to the running Electron
// app and forward tool calls via the existing IPC bridge.
//
// Usage:
//   1) Run: `node mcp-server/server.js` (starts MCP server, listens on stdio)
//   2) Configure your MCP client with: command = "node", args = ["path/to/mcp-server/server.js"]
//   3) The client gets a list of `browser.*` tools and can call any of them.

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const path = require('path');

// Pull in our isolated agent package — no Electron dependency, just the agent logic.
const { AgentService } = require('../src/agent');

/**
 * In-process test harness: fakes the Electron-side dependencies so the
 * AgentService can be exercised from the MCP server without launching the
 * full browser. In production this would be replaced by a bridge to the
 * running Electron app (see README).
 */
function makeInProcessDeps() {
  const sent = [];
  let activeTabId = 1;
  const tabs = new Map();
  const fakeView = (url) => ({
    webContents: {
      loadURL: (u) => { fakeView._lastUrl = u; },
      reload: () => {},
      getURL: () => fakeView._lastUrl || url || 'about:blank',
      executeJavaScript: async (code) => {
        // Minimal responses for the actions called from MCP tools
        if (code.includes('document.body.innerText')) return 'page text content';
        if (code.includes('MjjYud h3')) return [{ title: 'Result 1', url: 'https://example.com/1' }];
        if (code.includes('scrollBy')) return { ok: true, y: 100 };
        if (code.includes('getBoundingClientRect')) return { ok: true, text: 'btn', rect: { x: 100, y: 100, width: 80, height: 30 } };
        // autofillForm field detection — return sample form
        if (code.includes('data-hermesRef') || code.includes('offsetParent')) {
          return [
            { role: 'username', id: 'user', name: 'username', type: 'text', ref: 'ref-u', value: '' },
            { role: 'password', id: 'pw',   name: 'password', type: 'password', ref: 'ref-p', value: '' },
          ];
        }
        return { ok: true };
      },
      sendInputEvent: () => {},
      capturePage: async () => ({ toDataURL: () => 'data:image/png;base64,AAA' }),
      setZoomFactor: () => {},
      getZoomFactor: () => 1.0,
    },
  });
  // Seed with one tab so MCP tools can operate on something
  const tab1 = { id: 1, url: 'https://example.com', title: 'Example', view: fakeView('https://example.com') };
  tabs.set(1, tab1);
  return {
    send: (ch, p) => { sent.push({ ch, p }); return true; },
    getTabs: () => [...tabs.values()],
    getActiveTab: () => tabs.get(activeTabId),
    getActiveView: () => tabs.get(activeTabId)?.view,
    getAutoApprove: () => true,  // MCP server always auto-approves (caller is trusted AI agent)
    createTab: (url) => {
      const id = Math.max(...tabs.keys(), 0) + 1;
      const tab = { id, url, title: url, view: fakeView(url) };
      tabs.set(id, tab);
      activeTabId = id;
      return tab;
    },
    switchTab: (id) => { if (tabs.has(id)) { activeTabId = id; return true; } return false; },
    closeTab: (id) => tabs.delete(id),
    waitForLoad: async () => {},
    goBack: () => {},
    goForward: () => {},
    normalizeUrl: (input) => {
      const s = String(input || '').trim();
      if (!s) return 'about:blank';
      if (/^(https?:)/i.test(s)) return s;
      if (/^[\w.-]+\.[a-z]{2,}/i.test(s)) return `https://${s}`;
      return `https://www.google.com/search?q=${encodeURIComponent(s)}`;
    },
    notifyAll: () => {},
    userDataPath: path.join(process.cwd(), 'mcp-server', '.userdata'),
  };
}

// ============ Build AgentService ============
const agent = new AgentService(makeInProcessDeps());

// ============ MCP Tool Definitions ============
// Each tool corresponds to one AgentService method. The MCP client sees these
// as the capabilities our browser exposes. Names are namespaced "browser_*"
// to avoid collisions with built-in MCP tools.

const TOOLS = [
  {
    name: 'browser_navigate',
    description: 'Navigate the active tab to a URL or search query. If the input is not a URL, it is treated as a Google search.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'URL or search query' } },
      required: ['url'],
    },
  },
  {
    name: 'browser_search',
    description: 'Run a web search on the active tab.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        engine: { type: 'string', enum: ['google', 'naver', 'bing'], description: 'search engine (default: google)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'browser_click',
    description: 'Click an element in the active tab. Can target by CSS selector, by hermes-ref attribute, or by visible text.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string' },
        ref: { type: 'string' },
        text: { type: 'string' },
        description: { type: 'string' },
      },
    },
  },
  {
    name: 'browser_fill',
    description: 'Fill an input field in the active tab.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string' },
        ref: { type: 'string' },
        text: { type: 'string' },
        value: { type: 'string' },
      },
    },
  },
  {
    name: 'browser_autofill_form',
    description: 'Auto-fill all form fields on the current page using saved credentials. Detects username/password/email/name/address fields, looks up credential by domain, fills it.',
    inputSchema: { type: 'object', properties: {} } },
  {
    name: 'reading_list_add',
    description: 'Add current page to offline reading list.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, snapshot: { type: 'boolean' } } },
  },
  {
    name: 'reading_list_list',
    description: 'List reading list items.',
    inputSchema: { type: 'object', properties: { unreadOnly: { type: 'boolean' }, tag: { type: 'string' } } },
  },
  {
    name: 'reading_list_remove',
    description: 'Remove reading list item.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'reading_list_mark_read',
    description: 'Mark reading list item read/unread.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, read: { type: 'boolean' } }, required: ['id'] },
  },
  {
    name: 'reading_list_open',
    description: 'Open offline snapshot in new tab.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'reading_list_cleanup',
    description: 'Cleanup old read items.',
    inputSchema: { type: 'object', properties: { maxAgeDays: { type: 'number' }, keepUnread: { type: 'boolean' } } },
  },
  {
    name: 'workspace_save',
    description: 'Save current tabs as a named workspace.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'workspace_list',
    description: 'List all saved workspaces.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'workspace_open',
    description: 'Re-open a saved workspace (restores its tabs).',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'workspace_delete',
    description: 'Delete a saved workspace.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'session_record_start',
    description: 'Start recording browser actions.',
    inputSchema: { type: 'object', properties: { label: { type: 'string' } } },
  },
  {
    name: 'session_record_stop',
    description: 'Stop recording.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'session_record_save',
    description: 'Save recording to disk.',
    inputSchema: { type: 'object', properties: { sessionId: { type: 'string' } } },
  },
  {
    name: 'session_record_list',
    description: 'List saved sessions.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'session_record_play',
    description: 'Re-run a saved session.',
    inputSchema: { type: 'object', properties: { sessionId: { type: 'string' } }, required: ['sessionId'] },
  },
  {
    name: 'session_record_delete',
    description: 'Delete a saved session.',
    inputSchema: { type: 'object', properties: { sessionId: { type: 'string' } }, required: ['sessionId'] },
  },




  {
    name: 'browser_get_visible_text',
    description: 'Read the visible text of the active page (up to 12000 chars).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_inspect_page',
    description: 'Get structured context of the active page: links, controls, headings, tables, loginRequired, hasCaptcha, etc.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_extract_search_results',
    description: 'Extract structured search-result links from a SERP (Google/Naver/Bing).',
    inputSchema: {
      type: 'object',
      properties: { tabId: { type: 'number' } },
    },
  },
  {
    name: 'browser_read_page',
    description: 'Read structured content (text, headings, tables, date, author) from a page.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'number' },
        maxChars: { type: 'number', description: 'Max chars of main text (default 12000)' },
      },
    },
  },
  {
    name: 'browser_open_tab',
    description: 'Open a new tab with the given URL.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
    },
  },
  {
    name: 'browser_switch_tab',
    description: 'Switch the active tab.',
    inputSchema: {
      type: 'object',
      properties: { tabId: { type: 'number' } },
      required: ['tabId'],
    },
  },
  {
    name: 'browser_close_tab',
    description: 'Close a tab.',
    inputSchema: {
      type: 'object',
      properties: { tabId: { type: 'number' } },
    },
  },
  {
    name: 'schedule_task',
    description: 'Add a cron-scheduled browser action. BrowserOS-style automation.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        cron: { type: 'string', description: '5-field cron expression' },
        action: { type: 'string' },
        args: { type: 'object' },
      },
      required: ['id', 'cron', 'action'],
    },
  },
  {
    name: 'schedule_list',
    description: 'List scheduled tasks.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'schedule_remove',
    description: 'Remove a scheduled task.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'schedule_run_now',
    description: 'Run a task immediately.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'browser_batch_action',
    description: 'Run a read-only action on multiple tabs in parallel. Actions: inspect | getVisibleText | extractSearchResults | readPage | takeScreenshot.',
    inputSchema: {
      type: 'object',
      properties: { tabIds: { type: 'array', items: { type: 'number' } }, action: { type: 'string', enum: ['inspect', 'getVisibleText', 'extractSearchResults', 'readPage', 'takeScreenshot'] }, maxChars: { type: 'number' } },
      required: ['tabIds', 'action'],
    },
  },
  {
    name: 'browser_get_tabs',
    description: 'List all open tabs (id, url, title).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_take_screenshot',
    description: 'Capture a PNG screenshot of the active tab. Returns base64 data URL.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_scroll',
    description: 'Scroll the active tab up or down by N pixels (default 700).',
    inputSchema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up', 'down'] },
        amount: { type: 'number' },
      },
    },
  },
  {
    name: 'browser_check_injection',
    description: 'Check a string for prompt injection patterns. Returns { injected: bool, patterns: [] }.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
  },
  {
    name: 'browser_get_mode',
    description: 'Get current agent mode (ask/assist/agent/auto) and its permissions.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'credential_save',
    description: 'Save (or replace) credentials for a domain. Stored encrypted with OS keychain via Electron safeStorage. Plaintext is never logged or exposed via list/get tools.',
    inputSchema: {
      type: 'object',
      properties: { domain: { type: 'string' }, username: { type: 'string' }, password: { type: 'string' } },
      required: ['domain', 'username', 'password'],
    },
  },
  {
    name: 'credential_list',
    description: 'List all saved credential domains with usernames (NEVER passwords).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'credential_remove',
    description: 'Delete credentials for a domain.',
    inputSchema: {
      type: 'object',
      properties: { domain: { type: 'string' } },
      required: ['domain'],
    },
  },
  {
    name: 'browser_set_mode',
    description: 'Switch agent mode.',
    inputSchema: {
      type: 'object',
      properties: { mode: { type: 'string', enum: ['ask', 'assist', 'agent', 'auto'] } },
      required: ['mode'],
    },
  },
];

// ============ Dispatcher: tool name → AgentService call ============

async function dispatchTool(name, args = {}) {
  switch (name) {
    case 'browser_navigate': return agent.runBrowserAction('navigate', { url: args.url });
    case 'browser_search': return agent.runBrowserAction('search', { query: args.query, engine: args.engine });
    case 'browser_click': return agent.runBrowserAction('click', args);
    case 'browser_fill': return agent.runBrowserAction('fill', args);
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
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

// ============ MCP Server ============

const server = new Server(
  { name: 'hermes-browser', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await dispatchTool(name, args || {});
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (e) {
    return {
      content: [{ type: 'text', text: `Error: ${e.message}` }],
      isError: true,
    };
  }
});

// ============ Stdio transport (Claude Code / Cursor etc.) ============

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[hermes-mcp] Server started on stdio');
}

main().catch((e) => {
  console.error('[hermes-mcp] Fatal:', e);
  process.exit(1);
});
