// content.js — Content script for any page (can request cowork tools)
// V18: Lets any web page communicate with Hermes Browser via window.postMessage

window.addEventListener('message', (event) => {
  // Only accept messages from same window
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.type !== 'HERMES_COWORK_REQUEST') return;

  // Forward to background script
  chrome.runtime.sendMessage({
    action: 'callTool',
    name: data.name,
    args: data.args || {},
  }, (response) => {
    window.postMessage({
      type: 'HERMES_COWORK_RESPONSE',
      requestId: data.requestId,
      result: response?.result,
      error: response?.error,
    }, '*');
  });
});

// Expose a simple JS API for any web page
window.HermesCowork = {
  call: (name, args = {}) => {
    return new Promise((resolve, reject) => {
      const requestId = 'req_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const handler = (event) => {
        if (event.source !== window) return;
        const d = event.data;
        if (d?.type !== 'HERMES_COWORK_RESPONSE' || d.requestId !== requestId) return;
        window.removeEventListener('message', handler);
        if (d.error) reject(new Error(d.error));
        else resolve(d.result);
      };
      window.addEventListener('message', handler);
      window.postMessage({
        type: 'HERMES_COWORK_REQUEST',
        requestId,
        name,
        args,
      }, '*');
    });
  },
};

console.log('Hermes Cowork Bridge loaded. Use window.HermesCowork.call(name, args)');