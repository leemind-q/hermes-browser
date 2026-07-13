/**
 * V43 keyboardShortcuts module — REAL OWNERSHIP
 *
 * Single source of truth for global keyboard shortcuts.
 * Replaces renderer.js's handleGlobalShortcuts() function and
 * `document.addEventListener('keydown', handleGlobalShortcuts)` registration.
 *
 * Public API:
 *   init({ handlers })   - mount window keydown listener
 *   register(key, fn)    - add or replace a shortcut handler
 *   unregister(key)      - remove a shortcut handler
 *   destroy()             - remove all handlers + listener
 *   getState()             - { initialized, handlersCount }
 *
 * Idempotent: multiple init() safe.
 *
 * Replaces renderer.js L324 addEventListener + L391 function handleGlobalShortcuts.
 */
window.HermesModules = window.HermesModules || {};

window.HermesModules.keyboardShortcuts = (() => {
  let initialized = false;
  let handlers = {};
  let onKeyDown = null;
  let windowListener = null;
  let documentListener = null;

  function isMac() {
    return navigator.platform.toLowerCase().includes('mac');
  }

  function buildCombo(e) {
    if (e.ctrlKey || e.metaKey) {
      return (isMac() && e.metaKey ? 'cmd+' : 'ctrl+') +
        (e.shiftKey ? 'shift+' : '') +
        (e.altKey ? 'alt+' : '') +
        e.key.toLowerCase();
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      return 'alt+' + e.key.toLowerCase();
    }
    return e.key;
  }

  function dispatch(e) {
    // Plain Escape (no modifier)
    if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const fn = handlers['Escape'];
      if (fn) {
        const result = fn(e);
        if (result !== false) e.preventDefault();
        return;
      }
    }
    // Cmd/Ctrl combos
    if (e.ctrlKey || e.metaKey || e.altKey) {
      const combo = buildCombo(e);
      if (combo && handlers[combo]) {
        const result = handlers[combo](e);
        if (result !== false) e.preventDefault();
        return;
      }
    }
    // F12 alone
    if (e.key === 'F12' && !e.ctrlKey && !e.metaKey) {
      const fn = handlers['F12'];
      if (fn) {
        const result = fn(e);
        if (result !== false) e.preventDefault();
      }
    }
  }

  function init(options = {}) {
    if (initialized) return;
    handlers = options.handlers || {};

    // Window-level listener (F12, Ctrl-based)
    onKeyDown = (e) => dispatch(e);
    window.addEventListener('keydown', onKeyDown);
    windowListener = onKeyDown;

    initialized = true;
  }

  function register(key, fn) {
    if (typeof fn !== 'function') return;
    handlers[key] = fn;
  }

  function unregister(key) {
    delete handlers[key];
  }

  function destroy() {
    if (windowListener) {
      window.removeEventListener('keydown', windowListener);
    }
    if (documentListener) {
      document.removeEventListener('keydown', documentListener);
    }
    onKeyDown = null;
    windowListener = null;
    documentListener = null;
    handlers = {};
    initialized = false;
  }

  function getState() {
    return {
      initialized,
      handlersCount: Object.keys(handlers).length,
      keys: Object.keys(handlers),
    };
  }

  return { init, register, unregister, destroy, getState };
})();
