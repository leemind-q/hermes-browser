/**
 * V46 temporary UI registry — coordinates ESC close across modules.
 *
 * Each module (aiOverlay, workspacePopover, settingsPopover, findBar)
 * registers itself with id, priority, isOpen(), close() callback.
 *
 * EscapeCoordinator calls closeTopmost() which iterates by priority descending
 * and closes the first open UI only. This guarantees:
 *  - one ESC = exactly one close() call
 *  - second ESC = next priority UI closed
 *  - no duplicate handling from multiple ESC listeners
 *
 * Registry does NOT mutate DOM directly. It only calls module public APIs.
 *
 * Public API:
 *   register({ id, priority, isOpen, close })
 *   unregister(id)
 *   closeTopmost(reason?)        → returns id of closed UI, or null
 *   getOpenStack()                 → array of {id, priority} sorted desc
 *   getState()                     → { entries: number, openCount: number }
 *   clear()                        → unregister all (test helper)
 *
 * Idempotent: register(id) replaces existing entry with same id.
 */
window.HermesModules = window.HermesModules || {};

window.HermesModules.temporaryUIRegistry = (() => {
  const entries = new Map();

  function register(entry) {
    if (!entry || !entry.id) return;
    entries.set(entry.id, {
      id: entry.id,
      priority: typeof entry.priority === 'number' ? entry.priority : 100,
      isOpen: typeof entry.isOpen === 'function' ? entry.isOpen : () => false,
      close: typeof entry.close === 'function' ? entry.close : () => {},
    });
  }

  function unregister(id) {
    entries.delete(id);
  }

  function clear() {
    entries.clear();
  }

  function getOpenStack() {
    const open = [];
    for (const entry of entries.values()) {
      let opened = false;
      try { opened = entry.isOpen(); } catch { /* swallow */ }
      if (opened) open.push({ id: entry.id, priority: entry.priority });
    }
    return open.sort((a, b) => b.priority - a.priority);
  }

  function closeTopmost(reason = 'escape') {
    const stack = getOpenStack();
    if (stack.length === 0) return null;
    const target = stack[0];
    const entry = entries.get(target.id);
    try {
      entry.close({ restoreFocus: true, reason });
    } catch (err) {
      console.error('[temporaryUIRegistry] close failed for', target.id, err);
    }
    return target.id;
  }

  function getState() {
    const stack = getOpenStack();
    return {
      entries: entries.size,
      openCount: stack.length,
      stack,
    };
  }

  return { register, unregister, clear, closeTopmost, getOpenStack, getState };
})();

/**
 * V46 Escape Coordinator — single source of truth for Escape key handling.
 *
 * Registers ONE keydown listener on window. When Escape fires:
 *   1. Close topmost UI via temporaryUIRegistry.closeTopmost('escape')
 *   2. preventDefault ONLY if something was closed
 *   3. Otherwise return false → caller (modules) can run fallback
 *
 * Modules no longer register their own Escape listeners.
 *
 * Public API:
 *   init()                        - mount single keydown listener (idempotent)
 *   destroy()                     - remove listener
 *   getState()                     - { initialized, listenerActive }
 */
window.HermesModules.escapeCoordinator = (() => {
  let initialized = false;
  let listener = null;

  function init() {
    if (initialized) return;
    listener = (e) => {
      if (e.key !== 'Escape') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const closed = window.HermesModules?.temporaryUIRegistry?.closeTopmost?.('escape');
      if (closed) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', listener);
    initialized = true;
  }

  function destroy() {
    if (listener) window.removeEventListener('keydown', listener);
    listener = null;
    initialized = false;
  }

  function getState() {
    return { initialized, listenerActive: listener !== null };
  }

  return { init, destroy, getState };
})();
