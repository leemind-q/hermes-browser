/**
 * V43 textareaAutosize module — REAL OWNERSHIP
 *
 * Single source of truth for promptInput autosize.
 * renderer.js no longer mutates textarea.style.height directly.
 *
 * Public API:
 *   init(options)  - mount input listener + initial sizing
 *   resize()       - force remeasure (replaces old autoResizePrompt())
 *   destroy()      - remove listener, disconnect observer
 *   getState()     - { initialized, observerActive, currentHeight }
 *
 * Idempotent: multiple init() safe.
 */
window.HermesModules = window.HermesModules || {};

window.HermesModules.textareaAutosize = (() => {
  let initialized = false;
  let textarea = null;
  let observer = null;
  let currentHeight = 0;
  const MAX_HEIGHT = 92;

  function getTextarea() {
    if (textarea && document.body.contains(textarea)) return textarea;
    textarea = document.getElementById('promptInput');
    return textarea;
  }

  function resize() {
    const t = getTextarea();
    if (!t) return;
    t.style.height = 'auto';
    const next = Math.min(t.scrollHeight, MAX_HEIGHT);
    t.style.height = next + 'px';
    currentHeight = next;
  }

  function init(options = {}) {
    if (initialized) return;
    const t = getTextarea();
    if (!t) return;
    initialized = true;

    // Single input listener — replaces renderer.js's L294 addEventListener
    t.addEventListener('input', resize);
    // Initial measure
    resize();
  }

  function destroy() {
    const t = getTextarea();
    if (t && initialized) {
      // Best-effort remove — capture can't easily get original fn reference
      // but the t.addEventListener('input', resize) with named fn allows removal
      t.removeEventListener('input', resize);
    }
    if (textarea) textarea.style.height = '';
    textarea = null;
    currentHeight = 0;
    initialized = false;
  }

  function getState() {
    return {
      initialized,
      textareaAttached: !!getTextarea(),
      currentHeight,
    };
  }

  return { init, resize, destroy, getState };
})();
