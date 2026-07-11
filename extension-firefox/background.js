// background.js — Hermes Cowork Bridge (Firefox MV2)
// V19: Proxies calls from popup/content to Hermes Browser cowork bridge

// Firefox compatibility — use `browser` if `chrome` not available
const browserAPI = (typeof browser !== 'undefined') ? browser : chrome;

const HERMES_BRIDGE = 'http://127.0.0.1:8780';

// Get auth token from Hermes bridge
async function getAuthToken() {
  try {
    const res = await fetch(`${HERMES_BRIDGE}/auth/token`);
    if (!res.ok) return null;
    const json = await res.json();
    return json.token;
  } catch (e) {
    return null;
  }
}

// Call a cowork MCP tool
async function callCoworkTool(name, args = {}) {
  const token = await getAuthToken();
  if (!token) return { ok: false, error: 'Cannot connect to Hermes Browser. Is it running on port 8780?' };
  try {
    const res = await fetch(`${HERMES_BRIDGE}/mcp/tool`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ name, args }),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `${res.status}: ${text.slice(0, 200)}` };
    }
    const json = await res.json();
    return json.result || json;
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Listen for messages from popup/content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    if (request.action === 'callTool') {
      const result = await callCoworkTool(request.name, request.args);
      sendResponse({ ok: true, result });
    } else if (request.action === 'checkConnection') {
      const token = await getAuthToken();
      sendResponse({ ok: token !== null, token: token ? '***' : null });
    } else if (request.action === 'listTools') {
      try {
        const res = await fetch(`${HERMES_BRIDGE}/mcp/tools`);
        const json = await res.json();
        sendResponse({ ok: true, tools: json.tools });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    } else {
      sendResponse({ ok: false, error: 'unknown action' });
    }
  })();
  return true; // keep channel open for async
});

// Notify when installation completes
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Hermes Cowork Bridge installed.');
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon-128.png',
      title: 'Hermes Cowork Bridge',
      message: 'Start Hermes Browser to use cowork tools from this browser.',
    });
  }
});