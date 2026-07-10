// src/agent/extraction.js — Page context extraction (DOM → structured data)
// Extracted from main.js (originally lines 404-509, 802-870).

/**
 * Extract the active tab's page context: links, controls, headings, tables,
 * main text, user selection, and basic metadata. The result is what the agent
 * "sees" — it's cached per-tab for 30s to avoid repeated expensive calls.
 *
 * Returns null when there's no active view.
 */
async function extractPageContext(view) {
  if (!view) return null;
  try {
    const context = await view.webContents.executeJavaScript(`(() => {
      const clone = document.body ? document.body.cloneNode(true) : null;
      if (clone) {
        clone.querySelectorAll('script,style,noscript,iframe,svg,canvas,nav,footer,header,aside,[class*="ad"],[id*="ad"],[class*="sponsor"],[data-ad]').forEach(n => n.remove());
      }
      const root = clone?.querySelector('main, article, [role="main"]') || clone || document.body;
      const clean = s => String(s || '').replace(/\\s+/g, ' ').trim();
      const links = [...document.querySelectorAll('a[href]')].slice(0, 80).map((a, i) => ({
        ref: 'link-' + i,
        text: clean(a.innerText || a.textContent).slice(0, 120),
        href: a.href,
      }));
      const controls = [...document.querySelectorAll('button,a[href],input,textarea,select,[role="button"],[contenteditable="true"]')].slice(0, 120).map((el, i) => {
        if (!el.dataset.hermesRef) el.dataset.hermesRef = 'ref-' + i;
        const r = el.getBoundingClientRect();
        return {
          ref: el.dataset.hermesRef,
          tag: el.tagName.toLowerCase(),
          type: el.type || '',
          text: clean(el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || el.name).slice(0, 120),
          href: el.href || '',
          visible: r.width > 0 && r.height > 0,
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        };
      });
      const headings = [...document.querySelectorAll('h1,h2,h3')].slice(0,40).map(h => ({ level: h.tagName, text: clean(h.innerText) }));
            const tables = [...document.querySelectorAll('table')].slice(0,8).map(t => clean(t.innerText).slice(0,3000));
            const text = clean(root?.innerText || document.body?.innerText || '').slice(0,50000);
            const selection = clean(window.getSelection()?.toString() || '').slice(0,5000);
            const images = [...document.querySelectorAll('img')].slice(0,20).map(img => ({ src: img.src, alt: clean(img.alt).slice(0,100), w: img.naturalWidth, h: img.naturalHeight }));
            const forms = [...document.querySelectorAll('form')].slice(0,10).map((f, i) => ({ ref: 'form-' + i, action: f.action || '', method: f.method || 'get', fields: [...f.querySelectorAll('input,textarea,select')].slice(0,30).map(el => ({ tag: el.tagName.toLowerCase(), type: el.type || '', name: el.name || '', label: clean(el.labels?.[0]?.innerText || el.placeholder || el.getAttribute('aria-label')).slice(0,80), required: el.required })) }));
            const loginRequired = !!document.querySelector('input[type="password"]');
            const hasCookieBanner = !!document.querySelector('[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[id*="gdpr" i],[class*="gdpr" i]');
            const hasCaptcha = !!document.querySelector('iframe[src*="captcha"],[class*="captcha" i],[id*="captcha" i],.g-recaptcha,#cf-challenge,#challenge-running');
            const meta = {};
            document.querySelectorAll('meta[name],meta[property]').forEach(m => { const k = m.getAttribute('name') || m.getAttribute('property'); if (k) meta[k] = clean(m.getAttribute('content')).slice(0,200); });
            return {
              url: location.href, title: document.title, domain: location.hostname,
              links, controls, headings, tables, text, selection, images, forms,
              loginRequired, hasCookieBanner, hasCaptcha, meta,
              charCount: text.length,
            };
    })()`, true);
    return context;
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Extract context for any tab (active or background). Background tabs execute
 * the lighter version (text + links only, no controls) and get cached for 30s.
 */
async function extractTabContext(tab, activeTabId, activeExtractor, contextCache) {
  if (!tab) return { error: 'tab not found' };
  const cached = contextCache.get(tab.id);
  if (cached && Date.now() - cached.cachedAt < 30000) return cached;
  const isActive = tab.id === activeTabId;
  if (isActive) return activeExtractor();
  try {
    const context = await tab.view.webContents.executeJavaScript(`(() => {
      const clean = s => String(s || '').replace(/\\s+/g, ' ').trim();
      const text = clean(document.body?.innerText || '').slice(0, 20000);
      const links = [...document.querySelectorAll('a[href]')].slice(0, 30).map(a => ({ text: clean(a.innerText).slice(0, 80), href: a.href }));
      return { url: location.href, title: document.title, domain: location.hostname, text, charCount: text.length, links };
    })()`, true);
    contextCache.set(tab.id, { ...context, cachedAt: Date.now() });
    return context;
  } catch (e) {
    return { error: e.message, tabId: tab.id };
  }
}

/**
 * Get all tab contexts (lightweight — titles + URLs + cached summaries).
 */
async function getAllTabContexts(tabs) {
  const result = [];
  for (const tab of tabs) {
    result.push({ id: tab.id, url: tab.url, title: tab.title });
  }
  return result;
}

/**
 * Get context for a specific subset of tabs.
 */
async function getMultiTabContexts(tabs, tabIds) {
  const result = [];
  for (const id of tabIds) {
    const tab = tabs.find(t => t.id === Number(id));
    if (tab) result.push({ id: tab.id, url: tab.url, title: tab.title });
  }
  return result;
}

/**
 * Extract search-engine result links from a SERP. Handles Google, Naver, and Bing
 * with a generic fallback for unknown engines.
 */
async function extractSearchResults(view) {
  if (!view) return [];
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
      const unique = results.filter(r => { if (seen.has(r.url)) return false; seen.add(r.url); return true; });
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

/**
 * Read page content — main text + tables + dates + author from a loaded page.
 */
async function readPageContent(view, maxChars = 12000) {
  if (!view) return { text: '', error: 'no view' };
  try {
    return await view.webContents.executeJavaScript(`(() => {
      const clean = s => String(s || '').replace(/\\s+/g, ' ').trim();
      const clone = document.body ? document.body.cloneNode(true) : null;
      if (clone) clone.querySelectorAll('script,style,noscript,iframe,svg,canvas,nav,footer,header,aside,[class*="ad"],[id*="ad"],[class*="sponsor"]').forEach(n => n.remove());
      const root = clone?.querySelector('main, article, [role="main"], .content, .article-body, #content') || clone || document.body;
      const text = clean(root?.innerText || '').slice(0, ${maxChars});
      const headings = [...document.querySelectorAll('h1,h2,h3')].slice(0,20).map(h => ({ level: h.tagName, text: clean(h.innerText) }));
      const tables = [...document.querySelectorAll('table')].slice(0,5).map(t => clean(t.innerText).slice(0,2000));
      const dateEl = document.querySelector('[datetime], time, .date, .article-date, .publish-date, .reg_date, .date_info');
      const date = dateEl ? clean(dateEl.getAttribute('datetime') || dateEl.innerText).slice(0,50) : '';
      const author = clean(document.querySelector('[rel="author"], .author, .byline, .press')?.innerText || '').slice(0,100);
      return { url: location.href, title: document.title, text, charCount: text.length, headings, tables, date, author };
    })()`, true);
  } catch (e) {
    return { url: view.webContents.getURL(), title: '', text: '', error: e.message };
  }
}

module.exports = {
  extractPageContext,
  extractTabContext,
  getAllTabContexts,
  getMultiTabContexts,
  extractSearchResults,
  readPageContent,
};