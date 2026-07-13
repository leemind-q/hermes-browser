/**
 * V42 keyboardShortcuts module
 *
 * Single window keydown handler. Maps Escape + Cmd/Ctrl shortcuts.
 *
 * Public API:
 *   init({ handlers })   - register handlers map { 'Escape': fn, 'Cmd+L': fn, ... }
 *   destroy()             - remove keydown listener
 *   getState()             - { initialized, handlersCount }
 *
 * Single instance: multiple init() safe.
 */
window.HermesModules = window.HermesModules || {};

window.HermesModules.keyboardShortcuts = (() => {
  let initialized = false;
  let handlers = {};
  let onKeyDown = null;

  function isMac() {
    return navigator.platform.toLowerCase().includes('mac');
  }

  function matchesCombo(e, combo) {
    const mac = isMac();
    const parts = combo.toLowerCase().split('+');
    let needsMod = false, needsShift = false, needsAlt = false, key = '';
    for (const p of parts) {
      if (p === 'cmd' || p === 'ctrl') { needsMod = true; continue; }
      if (p === 'shift') { needsShift = true; continue; }
      if (p === 'alt' || p === 'option') { needsAlt = true; continue; }
      key = p;
    }
    if (mac) {
      if (needsMod && !e.metaKey) return false;
    } else {
      if (needsMod && !e.ctrlKey) return false;
    }
    if (needsShift && !e.shiftKey) return false;
    if (needsAlt && !e.altKey) return false;
    if (!needsMod && (e.ctrlKey || e.metaKey)) return false;
    return e.key.toLowerCase() === key || e.code.toLowerCase() === 'key' + key;
  }

  function onKeyDownHandler(e) {
    // Plain Escape (no modifier)
    if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (handlers['Escape']) {
        const result = handlers['Escape'](e);
        if (result !== false) e.preventDefault();
        return;
      }
    }
    // Cmd/Ctrl combos
    const combo = (isMac() && e.metaKey ? 'Cmd+' : (e.ctrlKey ? 'Ctrl+' : '')) +
      (e.shiftKey ? 'Shift+' : '') +
      (e.altKey ? 'Alt+' : '') +
      e.key.toLowerCase();
    if (combo && handlers[combo]) {
      const result = handlers[combo](e);
      if (result !== false) e.preventDefault();
    }
  }

  function init(options = {}) {
    if (initialized) return;
    handlers = options.handlers || {};
    onKeyDown = onKeyDownHandler;
    window.addEventListener('keydown', onKeyDown);
    initialized = true;
  }

  function destroy() {
    if (onKeyDown) {
      window.removeEventListener('keydown', onKeyDown);
    }
    onKeyDown = null;
    handlers = {};
    initialized = false;
  }

  function getState() {
    return { initialized, handlersCount: Object.keys(handlers).length };
  }

  return { init, destroy, getState };
})();
