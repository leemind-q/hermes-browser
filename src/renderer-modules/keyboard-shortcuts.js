/**
 * V44 keyboardShortcuts module — DEFAULT HANDLERS + registration API
 *
 * The default handler map (14 entries) is built INTO this module.
 * Callers only need to register additional shortcuts via register(key, fn).
 *
 * Public API:
 *   init()                 - mount window keydown listener with defaults
 *   register(key, fn)      - add or replace a shortcut handler
 *   unregister(key)        - remove a shortcut handler
 *   destroy()              - remove all handlers + listener
 *   getState()             - { initialized, handlersCount, keys }
 *
 * Idempotent: multiple init() safe.
 *
 * DEFAULT HANDLERS:
 *   Escape     — close topmost overlay/popover/settings/find (cascade)
 *   ctrl+f / cmd+f   — toggleFindBar
 *   ctrl+h / cmd+h   — openHistory
 *   ctrl+j / cmd+j   — openDownloads
 *   ctrl+d / cmd+d   — addCurrentBookmark
 *   ctrl+p / cmd+p   — window.hermes.browser.print
 *   ctrl+u / cmd+u   — window.hermes.browser.viewSource
 *   F12              — window.hermes.browser.devTools
 *
 * These handlers reference globally available UI functions
 * (toggleFindBar, openHistory, openDownloads, addCurrentBookmark,
 *  hideFindBar, SettingsPopover). They are V41 UI functions that remain
 * in renderer.js — keyboard-shortcuts is the DISPATCHER.
 */
window.HermesModules = window.HermesModules || {};

window.HermesModules.keyboardShortcuts = (() => {
  let initialized = false;
  let handlers = {};
  let windowListener = null;

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

  // ===== Default handlers =====

  function defaultEscapeHandler(e) {
    // Check AI overlay first
    const aiOverlay = document.getElementById('aiOverlay');
    if (aiOverlay && aiOverlay.classList.contains('visible')) {
      aiOverlay.classList.remove('visible');
      return true;
    }
    // Check workspace popover
    const wsPopover = document.getElementById('workspaceSwitcherPopover');
    if (wsPopover && wsPopover.style.display === 'block') {
      wsPopover.style.display = 'none';
      wsPopover.setAttribute('aria-hidden', 'true');
      const trigger = document.getElementById('workspaceCardTrigger');
      if (trigger) {
        trigger.setAttribute('aria-expanded', 'false');
        trigger.focus();
      }
      return true;
    }
    // Check settings popover
    if (typeof SettingsPopover !== 'undefined' && SettingsPopover.isOpen && SettingsPopover.isOpen()) {
      SettingsPopover.close();
      return true;
    }
    // Find bar (preserved V41 behavior)
    if (typeof hideFindBar === 'function') {
      hideFindBar();
      return true;
    }
    return false;
  }

  function makeSimpleHandler(fnName) {
    return () => {
      if (typeof window[fnName] === 'function') {
        window[fnName]();
        return true;
      }
      return false;
    };
  }

  function makeHermesHandler(channel) {
    return () => {
      if (window.hermes?.browser?.[channel]) {
        window.hermes.browser[channel]();
        return true;
      }
      return false;
    };
  }

  function getDefaultHandlers() {
    return {
      'Escape': defaultEscapeHandler,
      'ctrl+f': makeSimpleHandler('toggleFindBar'),
      'cmd+f': makeSimpleHandler('toggleFindBar'),
      'ctrl+h': makeSimpleHandler('openHistory'),
      'cmd+h': makeSimpleHandler('openHistory'),
      'ctrl+j': makeSimpleHandler('openDownloads'),
      'cmd+j': makeSimpleHandler('openDownloads'),
      'ctrl+d': makeSimpleHandler('addCurrentBookmark'),
      'cmd+d': makeSimpleHandler('addCurrentBookmark'),
      'ctrl+p': makeHermesHandler('print'),
      'cmd+p': makeHermesHandler('print'),
      'ctrl+u': makeHermesHandler('viewSource'),
      'cmd+u': makeHermesHandler('viewSource'),
      'F12': makeHermesHandler('devTools'),
    };
  }

  // ===== Dispatch =====

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

  // ===== Lifecycle =====

  function init() {
    if (initialized) return;

    // Load defaults first, then caller-provided overrides
    handlers = getDefaultHandlers();

    windowListener = (e) => dispatch(e);
    window.addEventListener('keydown', windowListener);
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
    windowListener = null;
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
