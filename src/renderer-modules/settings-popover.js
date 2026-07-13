/**
 * V46 settingsPopover module — REAL OWNERSHIP (extracted from renderer.js)
 *
 * Single source of truth for settings popover UI state.
 *
 * V46 changes:
 *   - ESC delegated to escapeCoordinator (no own listener)
 *   - Registers with temporaryUIRegistry at priority 30
 *   - DI: loadSettings, saveSettings, onOpen, onClose injected via init options
 *   - Does NOT directly call window.hermes (only via callback)
 *
 * Public API:
 *   init(options?)        — mount listeners + register with registry
 *   open(options?)        — open popover (records trigger)
 *   close(options?)       — close popover + restore focus
 *   toggle(options?)      — toggle open/closed
 *   isOpen()              — true if popover visible
 *   getPriority()         — registry priority (30, settings)
 *   getState()            — { initialized, open, triggerId, ... }
 *   destroy()             — remove listeners + unregister
 *
 * Idempotent: multiple init() safe.
 */
window.HermesModules = window.HermesModules || {};

window.HermesModules.settingsPopover = (() => {
  let initialized = false;
  let pop = null;
  let btn = null;
  let outsideHandler = null;
  let resizeHandler = null;
  let lastTrigger = null;
  let pendingCloseTimeout = null;

  const PRIORITY = 30; // Settings — below AI overlay (60), workspace (40)

  // Injected dependencies
  let deps = {
    loadSettings: async () => ({}),
    saveSettings: async () => {},
    onOpen: () => {},
    onClose: () => {},
    triggerSelector: '#settingsBtn',
  };

  function getPopover() {
    if (pop && document.body.contains(pop)) return pop;
    pop = document.getElementById('settingsPopover');
    return pop;
  }

  function getButton() {
    if (btn && document.body.contains(btn)) return btn;
    btn = document.getElementById(deps.triggerSelector.replace('#', ''));
    return btn;
  }

  function isOpen() {
    const p = getPopover();
    if (!p) return false;
    return p.classList.contains('visible');
  }

  function getPriority() {
    return PRIORITY;
  }

  function resolveTrigger(options) {
    if (options && options.trigger && options.trigger.focus) return options.trigger;
    const active = document.activeElement;
    if (active && (active.tagName === 'BUTTON' || active.tagName === 'A')) return active;
    const fallback = document.querySelector(deps.triggerSelector);
    if (fallback) return fallback;
    return document.body;
  }

  async function open(options = {}) {
    const p = getPopover();
    if (!p) return;
    lastTrigger = resolveTrigger(options);
    try {
      const data = await deps.loadSettings();
      // Render data into popover UI (delegated to user-supplied or default)
      render(data);
    } catch (e) {
      console.error('[settingsPopover] loadSettings failed:', e);
    }
    p.classList.remove('closing');
    p.classList.add('visible');
    p.setAttribute('aria-hidden', 'false');
    const trigger = getButton();
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
    position();
    deps.onOpen();
  }

  function close(options = {}) {
    const p = getPopover();
    if (!p || !isOpen()) return;
    if (pendingCloseTimeout) {
      clearTimeout(pendingCloseTimeout);
      pendingCloseTimeout = null;
    }
    p.classList.add('closing');
    const trigger = getButton();
    if (trigger) trigger.setAttribute('aria-expanded', 'false');

    const finalize = () => {
      p.classList.remove('visible', 'closing');
      p.setAttribute('aria-hidden', 'true');
    };
    p.addEventListener('animationend', finalize, { once: true });
    pendingCloseTimeout = setTimeout(finalize, 180);

    if (options.restoreFocus && lastTrigger && lastTrigger.focus && lastTrigger !== document.body) {
      try { lastTrigger.focus(); } catch {}
    }
    deps.onClose();
  }

  function toggle(options = {}) {
    if (isOpen()) close(options);
    else open(options);
  }

  function render(data) {
    // V46: lightweight render — V45 SettingsPopover had full menuConfig render.
    // For V46 we expose the popover element so the existing renderer.js code
    // can still populate it. We keep render as a stub that triggers optional
    // onRender callback if provided.
    const p = getPopover();
    if (!p) return;
    if (typeof deps.onRender === 'function') {
      try { deps.onRender(p, data); } catch (e) {
        console.error('[settingsPopover] onRender failed:', e);
      }
    }
  }

  function position() {
    const p = getPopover();
    const trigger = getButton();
    if (!p || !trigger) return;
    const r = trigger.getBoundingClientRect();
    const margin = 10;
    const width = Math.min(226, window.innerWidth - margin * 2);
    p.style.width = width + 'px';
    const left = Math.min(window.innerWidth - width - margin, Math.max(margin, r.right - width));
    let top = r.bottom + 8;
    const maxTop = Math.max(margin, window.innerHeight - margin - Math.min(p.scrollHeight || 360, window.innerHeight - 58));
    top = Math.max(margin, Math.min(top, maxTop));
    p.style.left = `${left}px`;
    p.style.top = `${top}px`;
  }

  function onOutsideClick(e) {
    if (!isOpen()) return;
    const p = getPopover();
    const trigger = getButton();
    if (!p) return;
    if (p.contains(e.target)) return;
    if (trigger && trigger.contains(e.target)) return;
    close({ restoreFocus: true });
  }

  function onResize() {
    if (isOpen()) position();
  }

  function init(options = {}) {
    if (initialized) return;
    deps = { ...deps, ...options };

    const trigger = getButton();
    if (trigger && !trigger._settingsPopoverBound) {
      trigger._settingsPopoverBound = true;
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        toggle({ trigger });
      });
    }

    outsideHandler = (e) => onOutsideClick(e);
    document.addEventListener('pointerdown', outsideHandler, true);

    resizeHandler = () => onResize();
    window.addEventListener('resize', resizeHandler);

    // V46: register with coordinator registry (no own ESC listener)
    window.HermesModules?.temporaryUIRegistry?.register?.({
      id: 'settingsPopover',
      priority: PRIORITY,
      isOpen,
      close: (opts) => close(opts),
    });

    initialized = true;
  }

  function destroy() {
    try {
      if (outsideHandler) {
        document.removeEventListener('pointerdown', outsideHandler, true);
      }
      if (resizeHandler) {
        window.removeEventListener('resize', resizeHandler);
      }
      const trigger = getButton();
      if (trigger) trigger._settingsPopoverBound = false;
      if (pendingCloseTimeout) {
        clearTimeout(pendingCloseTimeout);
        pendingCloseTimeout = null;
      }
      window.HermesModules?.temporaryUIRegistry?.unregister?.('settingsPopover');
    } catch (err) {
      console.error('[settingsPopover] destroy failed:', err);
    }
    outsideHandler = null;
    resizeHandler = null;
    lastTrigger = null;
    initialized = false;
  }

  function getState() {
    return {
      initialized,
      open: isOpen(),
      priority: PRIORITY,
      triggerId: lastTrigger && lastTrigger.id ? lastTrigger.id : null,
      focusReturnTarget: lastTrigger && lastTrigger.id ? lastTrigger.id : null,
      listenerCount: (outsideHandler ? 1 : 0) + (resizeHandler ? 1 : 0),
    };
  }

  return { init, open, close, toggle, isOpen, getPriority, getState, destroy };
})();
