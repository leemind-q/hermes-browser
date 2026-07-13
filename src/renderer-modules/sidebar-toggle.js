/**
 * V48 sidebarToggle module — REAL OWNERSHIP
 *
 * Single source of truth for left/right sidebar collapse/restore.
 *
 * Boundary with sidebarResize:
 *   sidebarToggle — collapsed/expanded state, rail/panel visibility, aria
 *   sidebarResize — drag-to-resize width of expanded panels
 *
 * Public API:
 *   init(options?)       — mount listeners + restore saved state
 *   collapse(side)      — collapse 'left' or 'right' panel
 *   expand(side)        — expand 'left' or 'right' panel
 *   toggle(side)        — toggle 'left' or 'right' panel
 *   isCollapsed(side)   — boolean or null if side unknown
 *   getState()          — full module state
 *   destroy()           — remove all listeners + cleanup
 *
 * Options:
 *   app              — #app element (default: document.getElementById('app'))
 *   leftPanel        — #leftPanel (default: document.getElementById('leftPanel'))
 *   rightPanel       — #rightPanel (default: document.getElementById('rightPanel'))
 *   leftRail         — #leftRail (default: document.getElementById('leftRail'))
 *   rightRail        — #rightRail (default: document.getElementById('rightRail'))
 *   leftToggle       — #leftToggle element
 *   rightToggle      — #rightToggle element
 *   persistState     — function({ leftCollapsed, rightCollapsed }), default: localStorage
 *   restoreState     — function(), returns { leftCollapsed, rightCollapsed }
 *   notifyMain       — function(side, collapsed), optional IPC notification
 */
window.HermesModules = window.HermesModules || {};

window.HermesModules.sidebarToggle = (() => {
  let initialized = false;
  let leftToggleHandler = null;
  let rightToggleHandler = null;

  const opts = {};

  function e(id) { return document.getElementById(id); }

  function saveState() {
    const state = { leftCollapsed: isCollapsed('left'), rightCollapsed: isCollapsed('right') };
    if (typeof opts.persistState === 'function') {
      opts.persistState(state);
    } else {
      try { localStorage.setItem('sidebarCollapsed', JSON.stringify(state)); } catch {}
    }
  }

  function loadState() {
    if (typeof opts.restoreState === 'function') {
      try { return opts.restoreState(); } catch { return {}; }
    }
    try {
      const raw = localStorage.getItem('sidebarCollapsed');
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }

  function isCollapsed(side) {
    const panel = side === 'left' ? opts.leftPanel : opts.rightPanel;
    if (!panel) return null;
    return panel.classList.contains('collapsed');
  }

  function collapse(side) {
    const app = opts.app;
    const panel = side === 'left' ? opts.leftPanel : opts.rightPanel;
    const rail = side === 'left' ? opts.leftRail : opts.rightRail;
    if (!app || !panel) return;

    app.classList.add(side + '-collapsed');
    panel.classList.add('collapsed');
    if (rail) rail.style.display = 'none';

    const toggle = side === 'left' ? opts.leftToggle : opts.rightToggle;
    if (toggle) toggle.setAttribute('aria-expanded', 'false');

    if (typeof opts.notifyMain === 'function') {
      try { opts.notifyMain(side, true); } catch {}
    }
    saveState();
  }

  function expand(side) {
    const app = opts.app;
    const panel = side === 'left' ? opts.leftPanel : opts.rightPanel;
    const rail = side === 'left' ? opts.leftRail : opts.rightRail;
    if (!app || !panel) return;

    app.classList.remove(side + '-collapsed');
    panel.classList.remove('collapsed');
    if (rail) rail.style.display = '';

    const toggle = side === 'left' ? opts.leftToggle : opts.rightToggle;
    if (toggle) toggle.setAttribute('aria-expanded', 'true');

    if (typeof opts.notifyMain === 'function') {
      try { opts.notifyMain(side, false); } catch {}
    }
    saveState();
  }

  function toggle(side) {
    if (isCollapsed(side)) {
      expand(side);
    } else {
      collapse(side);
    }
  }

  function init(options = {}) {
    if (initialized) return;
    opts.app = options.app || e('app');
    opts.leftPanel = options.leftPanel || e('leftPanel');
    opts.rightPanel = options.rightPanel || e('rightPanel');
    opts.leftRail = options.leftRail || e('leftRail');
    opts.rightRail = options.rightRail || e('rightRail');
    opts.leftToggle = options.leftToggle || e('leftToggle');
    opts.rightToggle = options.rightToggle || e('rightToggle');
    opts.persistState = options.persistState || null;
    opts.restoreState = options.restoreState || null;
    opts.notifyMain = options.notifyMain || null;

    leftToggleHandler = () => toggle('left');
    rightToggleHandler = () => toggle('right');

    if (opts.leftToggle) {
      opts.leftToggle.removeEventListener('click', leftToggleHandler);
      opts.leftToggle.addEventListener('click', leftToggleHandler);
    }
    if (opts.rightToggle) {
      opts.rightToggle.removeEventListener('click', rightToggleHandler);
      opts.rightToggle.addEventListener('click', rightToggleHandler);
    }

    // Restore saved state
    const saved = loadState();
    if (saved.leftCollapsed === true) {
      // Do NOT collapse during init if it's not yet moved to where it belongs
      // The V30 fix module handles DOM placement first
      opts.app.classList.add('left-collapsed');
      opts.leftPanel.classList.add('collapsed');
      if (opts.leftRail) opts.leftRail.style.display = 'none';
    }
    if (saved.rightCollapsed === true) {
      opts.app.classList.add('right-collapsed');
      opts.rightPanel.classList.add('collapsed');
      if (opts.rightRail) opts.rightRail.style.display = 'none';
    }

    initialized = true;
  }

  function destroy() {
    if (opts.leftToggle && leftToggleHandler) {
      opts.leftToggle.removeEventListener('click', leftToggleHandler);
    }
    if (opts.rightToggle && rightToggleHandler) {
      opts.rightToggle.removeEventListener('click', rightToggleHandler);
    }
    leftToggleHandler = null;
    rightToggleHandler = null;
    initialized = false;
  }

  function getState() {
    return {
      initialized,
      leftCollapsed: isCollapsed('left'),
      rightCollapsed: isCollapsed('right'),
      leftToggleId: opts.leftToggle ? opts.leftToggle.id : null,
      rightToggleId: opts.rightToggle ? opts.rightToggle.id : null,
    };
  }

  return { init, collapse, expand, toggle, isCollapsed, getState, destroy };
})();
