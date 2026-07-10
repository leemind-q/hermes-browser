// src/agent/actions.js — Browser action primitives (click, fill, highlight, find)
// Extracted from main.js (originally lines 559-687). Pure browser-control primitives
// only — mode/approval/plan/safety are injected by AgentService.runBrowserAction.
//
// The dispatcher (runBrowserAction) lives in index.js since it cross-cuts mode +
// approval + plan + actions. This file stays narrowly scoped to "given a view, do
// one browser primitive."

const sleep = ms => new Promise(r => setTimeout(r, ms));

const extractPageContext = async () => null;  // stub — AgentService supplies the real one if needed

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

async function clickElement(view, params, deps = {}) {
  const sendCursor = deps.send || (() => {});
  const refreshContext = deps.refreshContext || (async () => {});
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
        if (clicked.rect) sendCursor('virtual-cursor', { x: clicked.rect.x, y: clicked.rect.y, action: 'click' });
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
          if (clicked.rect) sendCursor('virtual-cursor', { x: clicked.rect.x, y: clicked.rect.y, action: 'click' });
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


// ============ Exports ============
module.exports = {
  highlightElement,
  findElementByRef,
  findElementByText,
  clickElement,
  fillElement,
  // Re-exported helpers for AgentService to call without importing this file twice
  sleep,
};
