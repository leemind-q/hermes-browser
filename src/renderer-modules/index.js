/**
 * V42 Module loader
 *
 * Loads all V42 modules. Modules are exposed via window.HermesModules.* namespace.
 * This file is loaded BEFORE renderer.js so modules are available.
 *
 * Individual modules self-register; they do NOT auto-init.
 * Renderer.js is responsible for calling module.init() at appropriate time.
 */
(function() {
  'use strict';
  if (window.HermesModules) {
    // Already loaded — skip duplicate init
    return;
  }
  window.HermesModules = {};
})();

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

/**
 * V43 planToggle module — REAL OWNERSHIP
 *
 * Single source of truth for planList expand/collapse.
 * Replaces V41 setupPlanToggle IIFE in renderer.js.
 *
 * Public API:
 *   init()        - mount click handler on planShowMore
 *   toggle()      - programmatic toggle (used by tests/UI)
 *   expand()      - force expand
 *   collapse()    - force collapse
 *   destroy()     - remove handler
 *   getState()    - { initialized, isExpanded, itemCount }
 *
 * Idempotent: multiple init() safe.
 *
 * Replaces renderer.js L200-245 IIFE setupPlanToggle().
 */
window.HermesModules = window.HermesModules || {};

window.HermesModules.planToggle = (() => {
  let initialized = false;
  let btn = null;
  let list = null;
  let onClick = null;
  let mutationObserver = null;
  let isExpanded = false;

  function applyPlanVisibility() {
    if (!btn || !list) return;
    const items = Array.from(list.querySelectorAll('.plan-item, .step, li, .ai-step'));
    if (items.length === 0) {
      btn.style.display = 'none';
      return;
    }
    btn.style.display = '';
    if (isExpanded) {
      items.forEach(el => el.style.display = '');
      return;
    }
    // Collapsed: show 3 items centered on current step
    const currentIdx = items.findIndex(el =>
      el.classList.contains('is-current') ||
      el.classList.contains('active') ||
      el.classList.contains('current')
    );
    let centerIdx = currentIdx === -1 ? 0 : currentIdx;
    const start = Math.max(0, Math.min(items.length - 3, centerIdx - 1));
    const end = Math.min(items.length, start + 3);
    items.forEach((el, i) => {
      el.style.display = (i >= start && i < end) ? '' : 'none';
    });
  }

  function refreshAria() {
    if (!btn) return;
    btn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    btn.textContent = isExpanded ? '접기' : '3단계 더 보기';
    btn.dataset.collapsed = isExpanded ? 'false' : 'true';
  }

  function toggle() {
    if (!btn) return;
    isExpanded = !isExpanded;
    if (list) list.dataset.expanded = isExpanded ? 'true' : 'false';
    refreshAria();
    applyPlanVisibility();
  }

  function expand() {
    if (!btn || isExpanded) return;
    isExpanded = true;
    if (list) list.dataset.expanded = 'true';
    refreshAria();
    applyPlanVisibility();
  }

  function collapse() {
    if (!btn || !isExpanded) return;
    isExpanded = false;
    if (list) list.dataset.expanded = 'false';
    refreshAria();
    applyPlanVisibility();
  }

  function init() {
    if (initialized) return;
    btn = document.getElementById('planShowMore');
    list = document.getElementById('planList');
    if (!btn || !list) return;
    initialized = true;

    // Initial state from DOM
    isExpanded = list.dataset.expanded === 'true';
    refreshAria();
    applyPlanVisibility();

    // Click handler (single source of truth)
    onClick = () => toggle();
    btn.addEventListener('click', onClick);

    // Mutation observer (items added/removed)
    mutationObserver = new MutationObserver(applyPlanVisibility);
    mutationObserver.observe(list, { childList: true });
  }

  function destroy() {
    if (btn && onClick) {
      btn.removeEventListener('click', onClick);
    }
    if (mutationObserver) {
      mutationObserver.disconnect();
      mutationObserver = null;
    }
    btn = null;
    list = null;
    onClick = null;
    isExpanded = false;
    initialized = false;
  }

  function getState() {
    return {
      initialized,
      isExpanded,
      itemCount: list ? list.querySelectorAll('.plan-item, .step, li, .ai-step').length : 0,
    };
  }

  return { init, toggle, expand, collapse, destroy, getState };
})();

/**
 * V44 workspacePopover module — REAL OWNERSHIP (last migrated feature)
 *
 * Single source of truth for workspace switcher popover behavior.
 * Replaces V39 inline IIFE in renderer.js (L5612-5678).
 *
 * Public API:
 *   init()        - mount all event listeners (trigger, wsName, ESC, outside-click, resize)
 *   show()        - programmatically open popover
 *   hide()        - programmatically close popover
 *   toggle()      - toggle open/closed
 *   isOpen()      - returns true if popover visible
 *   destroy()     - remove all listeners
 *   getState()    - { initialized, isOpen, hasFocus }
 *
 * Idempotent: multiple init() safe.
 *
 * Replaces renderer.js V39 IIFE:
 *   - click handlers on workspaceCardTrigger + wsDropdownToggle
 *   - ESC keydown handler
 *   - outside-click handler
 *   - window resize handler (repositioning)
 *   - positionPopover / showPopover / hidePopover / togglePopover helpers
 */
window.HermesModules = window.HermesModules || {};

window.HermesModules.workspacePopover = (() => {
  let initialized = false;
  let trigger = null;
  let popover = null;
  let wsName = null;

  // Listener references for cleanup
  let triggerClick = null;
  let wsNameClick = null;
  let escHandler = null;
  let outsideClickHandler = null;
  let resizeHandler = null;

  function positionPopover() {
    if (!popover || !trigger) return;
    if (popover.style.display === 'none' || popover.style.display === '') return;
    const r = trigger.getBoundingClientRect();
    const popoverWidth = 200; // matches CSS width
    let left = r.right + 8;
    if (left + popoverWidth > window.innerWidth) {
      // Flip to left side of trigger
      left = r.left - popoverWidth - 8;
    }
    popover.style.left = left + 'px';
    popover.style.top = r.top + 'px';
  }

  function show() {
    if (!popover || !trigger) return;
    popover.style.display = 'block';
    popover.setAttribute('aria-hidden', 'false');
    trigger.setAttribute('aria-expanded', 'true');
    positionPopover();
  }

  function hide() {
    if (!popover || !trigger) return;
    popover.style.display = 'none';
    popover.setAttribute('aria-hidden', 'true');
    trigger.setAttribute('aria-expanded', 'false');
  }

  function toggle() {
    if (!popover) return;
    if (popover.style.display === 'block') {
      hide();
    } else {
      show();
    }
  }

  function isOpen() {
    return popover ? popover.style.display === 'block' : false;
  }

  function init() {
    if (initialized) return;
    trigger = document.getElementById('workspaceCardTrigger');
    popover = document.getElementById('workspaceSwitcherPopover');
    wsName = document.getElementById('wsDropdownToggle');
    if (!trigger || !popover) return;
    initialized = true;

    // Click handlers
    triggerClick = () => toggle();
    trigger.addEventListener('click', triggerClick);

    if (wsName) {
      wsNameClick = (e) => {
        e.stopPropagation();
        toggle();
      };
      wsName.addEventListener('click', wsNameClick);
    }

    // V46: ESC delegated to escapeCoordinator (no own listener)
    escHandler = null;

    // Outside click closes
    outsideClickHandler = (e) => {
      if (popover.style.display !== 'block') return;
      if (popover.contains(e.target)) return;
      if (trigger && trigger.contains(e.target)) return;
      if (wsName && wsName.contains(e.target)) return;
      hide();
    };
    document.addEventListener('click', outsideClickHandler);

    // Reposition on resize
    resizeHandler = () => positionPopover();
    window.addEventListener('resize', resizeHandler);

    // V46: register with temporaryUIRegistry for ESC coordination
    window.HermesModules?.temporaryUIRegistry?.register?.({
      id: 'workspacePopover',
      priority: 40,
      isOpen,
      close: (opts) => hide(opts),
    });
  }

  function destroy() {
    if (trigger && triggerClick) {
      trigger.removeEventListener('click', triggerClick);
    }
    if (wsName && wsNameClick) {
      wsName.removeEventListener('click', wsNameClick);
    }
    // escHandler null in V46 (delegated to coordinator)
    if (outsideClickHandler) {
      document.removeEventListener('click', outsideClickHandler);
    }
    if (resizeHandler) {
      window.removeEventListener('resize', resizeHandler);
    }
    trigger = null;
    popover = null;
    wsName = null;
    triggerClick = null;
    wsNameClick = null;
    escHandler = null;
    outsideClickHandler = null;
    resizeHandler = null;
    window.HermesModules?.temporaryUIRegistry?.unregister?.('workspacePopover');
    initialized = false;
  }

  function getPriority() {
    return 40; // Workspace popover — below AI overlay (60), above settings (30)
  }

  function getState() {
    return {
      initialized,
      isOpen: isOpen(),
      priority: 40,
      hasFocus: document.activeElement === trigger,
    };
  }

  return { init, show, hide, toggle, isOpen, getPriority, destroy, getState };
})();

/**
 * V46 aiOverlay module — REAL OWNERSHIP (ESC coordinator integrated)
 *
 * Single source of truth for AI panel's overlay behavior.
 * ESC handling delegated to escapeCoordinator (V46). This module only:
 *   - registers with temporaryUIRegistry
 *   - exposes isOpen/close/priority
 *   - manages open/close/toggle UI state
 *
 * docked vs overlay:
 *   docked: width > 1100 → rightPanel is grid column (CSS only)
 *   overlay-open: width ≤ 1100 → rightPanel visible
 *   overlay-closed: width ≤ 1100 → rightPanel transform: translateX(...)
 *
 * Public API:
 *   init(options?)        — mount listeners + register with registry
 *   open(options?)        — open overlay (records trigger for focus return)
 *   close(options?)       — close overlay + restore focus
 *   toggle(options?)      — toggle open/closed
 *   isOpen()              — true if overlay currently visible
 *   getPriority()         — registry priority (60, AI overlay)
 *   getState()            — full state including viewport fit
 *   destroy()             — remove listeners + unregister
 *
 * Idempotent: multiple init() safe.
 *
 * V46 changes:
 *   - Removed escHandler (ESC delegated to escapeCoordinator)
 *   - Fixed focusReturnTarget: open(options) records options.trigger or
 *     document.activeElement that has data-ai-trigger attribute or specific
 *     AI-trigger class. Falls back to rightRail AI button → body.
 *   - Added getPriority() for registry coordination
 *   - Registers itself with temporaryUIRegistry on init
 */
window.HermesModules = window.HermesModules || {};

window.HermesModules.aiOverlay = (() => {
  let initialized = false;
  let closeBtnHandler = null;
  let backdropClickHandler = null;
  let resizeHandler = null;
  let lastTrigger = null;

  const PRIORITY = 60; // AI overlay — higher than workspace/settings

  let overlayBreakpoint = 1100;
  let selectors = {
    panel: '#rightPanel',
    closeButton: '#aiOverlayClose',
    backdrop: '#aiOverlayBackdrop',
    aiTriggerSelector: '[data-action="ai-overlay"], #aiOverlayToggle, #railNewChat, .ai-rail-trigger',
  };

  function getMode() {
    const w = window.innerWidth;
    if (w > overlayBreakpoint) return 'docked';
    const closed = document.body.getAttribute('data-ai-closed') === 'true';
    return closed ? 'overlay-closed' : 'overlay-open';
  }

  function isOpen() {
    return getMode() === 'overlay-open';
  }

  function getPriority() {
    return PRIORITY;
  }

  function resolveTrigger(options) {
    // 1. Explicit option
    if (options && options.trigger && options.trigger.focus) return options.trigger;
    // 2. data-ai-trigger attribute anywhere
    const attrTrigger = document.querySelector('[data-ai-trigger]');
    if (attrTrigger && attrTrigger.focus) return attrTrigger;
    // 3. Configured AI trigger selector
    const selTrigger = document.querySelector(selectors.aiTriggerSelector);
    if (selTrigger && selTrigger.focus) return selTrigger;
    // 4. Active element if it's interactive
    const active = document.activeElement;
    if (active && (active.tagName === 'BUTTON' || active.tagName === 'A' || active.tagName === 'INPUT')) {
      return active;
    }
    // 5. First matching configured trigger
    const first = document.querySelector(selectors.aiTriggerSelector);
    if (first && first.focus) return first;
    // 6. Body fallback
    return document.body;
  }

  function setOverlayState(open, options = {}) {
    if (getMode() === 'docked') return;
    if (!open) {
      document.body.setAttribute('data-ai-closed', 'true');
      if (options.restoreFocus) {
        const target = lastTrigger && lastTrigger.focus ? lastTrigger : null;
        if (target && target !== document.body) {
          target.focus();
        } else {
          // Fallback: try AI trigger selector
          const fb = document.querySelector(selectors.aiTriggerSelector);
          if (fb && fb.focus) fb.focus();
        }
      }
    } else {
      lastTrigger = resolveTrigger(options);
      document.body.removeAttribute('data-ai-closed');
    }
  }

  function open(options = {}) {
    setOverlayState(true, options);
  }

  function close(options = {}) {
    setOverlayState(false, options);
  }

  function toggle(options = {}) {
    if (isOpen()) close(options);
    else open(options);
  }

  function onCloseBtnClick() {
    close({ restoreFocus: true });
  }

  function onBackdropClick(e) {
    if (getMode() !== 'overlay-open') return;
    if (document.body.getAttribute('data-ai-closed') === 'true') return;
    const backdrop = document.querySelector(selectors.backdrop);
    if (backdrop && e.target === backdrop) {
      close({ restoreFocus: true });
    }
  }

  function onResize() {
    if (window.innerWidth > overlayBreakpoint) {
      document.body.removeAttribute('data-ai-closed');
    }
  }

  function computeViewportFit() {
    const panel = document.querySelector(selectors.panel);
    if (!panel) return { top: 0, bottom: 0, height: 0 };
    const r = panel.getBoundingClientRect();
    return {
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      height: Math.round(r.height),
    };
  }

  function init(options = {}) {
    if (initialized) return;
    try {
      if (options.overlayBreakpoint) overlayBreakpoint = options.overlayBreakpoint;
      if (options.selectors) selectors = { ...selectors, ...options.selectors };
      if (options.priority !== undefined) {/* read-only PRIORITY */}

      const closeBtn = document.querySelector(selectors.closeButton);
      if (closeBtn) {
        closeBtnHandler = () => onCloseBtnClick();
        closeBtn.addEventListener('click', closeBtnHandler);
      }

      backdropClickHandler = (e) => onBackdropClick(e);
      document.addEventListener('click', backdropClickHandler);

      resizeHandler = () => onResize();
      window.addEventListener('resize', resizeHandler);

      // Register with V46 coordinator registry (no own ESC listener)
      window.HermesModules?.temporaryUIRegistry?.register?.({
        id: 'aiOverlay',
        priority: PRIORITY,
        isOpen,
        close: (opts) => close(opts),
      });

      initialized = true;
    } catch (err) {
      console.error('[aiOverlay] init failed:', err);
    }
  }

  function destroy() {
    try {
      if (closeBtnHandler) {
        const btn = document.querySelector(selectors.closeButton);
        if (btn) btn.removeEventListener('click', closeBtnHandler);
      }
      if (backdropClickHandler) {
        document.removeEventListener('click', backdropClickHandler);
      }
      if (resizeHandler) {
        window.removeEventListener('resize', resizeHandler);
      }
      window.HermesModules?.temporaryUIRegistry?.unregister?.('aiOverlay');
    } catch (err) {
      console.error('[aiOverlay] destroy failed:', err);
    }
    closeBtnHandler = null;
    backdropClickHandler = null;
    resizeHandler = null;
    lastTrigger = null;
    initialized = false;
  }

  function getState() {
    const fit = computeViewportFit();
    return {
      initialized,
      open: isOpen(),
      mode: getMode(),
      viewportWidth: window.innerWidth,
      top: fit.top,
      bottom: fit.bottom,
      height: fit.height,
      priority: PRIORITY,
      triggerId: lastTrigger && lastTrigger.id ? lastTrigger.id : null,
      focusReturnTarget: lastTrigger && lastTrigger.id ? lastTrigger.id : null,
    };
  }

  return { init, open, close, toggle, isOpen, getMode, getPriority, getState, destroy };
})();

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
    // V46: delegate to escapeCoordinator + temporaryUIRegistry (single source)
    const closed = window.HermesModules?.temporaryUIRegistry?.closeTopmost?.('escape');
    if (closed) return true;
    // Fallback: hide find bar (preserved V41 behavior)
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

/**
 * V47 sidebarResize module — extracted from chrome.html inline (L8718)
 *
 * Single source of truth for sidebar drag-to-resize and collapse/restore.
 * Replaces V34 inline IIFE with HermesModules namespace.
 *
 * Public API:
 *   init()       — mount listeners (idempotent)
 *   destroy()    — remove all listeners
 *   getState()   — { initialized, leftWidth }
 *
 * DOM ownership:
 *   - sidebarResizeHandle mousedown
 *   - document mousemove + mouseup (resize)
 *   - collapseSidebarBtn click (collapse)
 *   - leftToggle click (toggle collapsed)
 *
 * V47 changes:
 *   - Extracted from chrome.html inline → module
 *   - init() idempotent
 *   - destroy() cleans up all listeners
 */
window.HermesModules = window.HermesModules || {};

window.HermesModules.sidebarResize = (() => {
  let initialized = false;
  let handle = null, leftPanel = null;
  let isDragging = false;
  let mousemoveHandler = null, mouseupHandler = null;
  let collapseHandler = null, leftToggleHandler = null;

  function init() {
    if (initialized) return;
    handle = document.getElementById('sidebarResizeHandle');
    leftPanel = document.getElementById('leftPanel');
    const root = document.documentElement;

    if (!handle || !leftPanel) { initialized = true; return; }

    handle.addEventListener('mousedown', function(e) {
      isDragging = true;
      handle.classList.add('active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    mousemoveHandler = function(e) {
      if (!isDragging) return;
      const gutter = 12;
      const newWidth = Math.max(140, Math.min(320, e.clientX - gutter));
      root.style.setProperty('--left', newWidth + 'px');
    };
    document.addEventListener('mousemove', mousemoveHandler);

    mouseupHandler = function() {
      if (!isDragging) return;
      isDragging = false;
      handle.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mouseup', mouseupHandler);

    // Collapse toggle
    const collapseBtn = document.getElementById('collapseSidebarBtn');
    if (collapseBtn) {
      collapseHandler = function() {
        document.querySelector('.app').classList.add('left-collapsed');
        leftPanel.classList.add('collapsed');
      };
      collapseBtn.addEventListener('click', collapseHandler);
    }

    const leftToggle = document.getElementById('leftToggle');
    if (leftToggle) {
      leftToggleHandler = function() {
        const app = document.querySelector('.app');
        app.classList.toggle('left-collapsed');
        leftPanel.classList.toggle('collapsed');
      };
      leftToggle.addEventListener('click', leftToggleHandler);
    }

    initialized = true;
  }

  function destroy() {
    if (mousemoveHandler) document.removeEventListener('mousemove', mousemoveHandler);
    if (mouseupHandler) document.removeEventListener('mouseup', mouseupHandler);
    if (collapseHandler) {
      const btn = document.getElementById('collapseSidebarBtn');
      if (btn) btn.removeEventListener('click', collapseHandler);
    }
    if (leftToggleHandler) {
      const lt = document.getElementById('leftToggle');
      if (lt) lt.removeEventListener('click', leftToggleHandler);
    }
    mousemoveHandler = null;
    mouseupHandler = null;
    collapseHandler = null;
    leftToggleHandler = null;
    isDragging = false;
    initialized = false;
  }

  function getState() {
    const val = document.documentElement.style.getPropertyValue('--left');
    return {
      initialized,
      leftWidth: val || '176px',
      isDragging,
    };
  }

  return { init, destroy, getState };
})();

/**
 * V47 sidebarFix module — extracted from chrome.html inline (L8770)
 *
 * V30 emergency fix: re-parents sidebar sections (Recent, Favorites, Memory,
 * Tasks, Session) that escaped to document.body back into leftPanel.
 *
 * This is a bootstrap-time DOM recovery script. It runs once on load.
 *
 * Public API:
 *   init()       — scan and fix (idempotent)
 *   destroy()    — no-op (one-shot fix)
 *   getState()   — { initialized, fixed }
 */
window.HermesModules = window.HermesModules || {};

window.HermesModules.sidebarFix = (() => {
  let initialized = false;
  let fixed = 0;

  function init() {
    if (initialized) return;
    const left = document.getElementById('leftPanel');
    if (!left) { initialized = true; return; }

    const labels = ['Recent', 'Favorites', 'Memory', 'Tasks', 'Session'];
    for (const label of labels) {
      const section = Array.from(document.querySelectorAll('.sidebar-section')).find(s => {
        const span = s.querySelector('.section-head span');
        return span && span.textContent.trim() === label;
      });
      if (section && section.parentElement === document.body) {
        const footer = left.querySelector('.sidebar-footer');
        if (footer) {
          left.insertBefore(section, footer);
        } else {
          left.appendChild(section);
        }
        fixed++;
      }
    }
    initialized = true;
  }

  function destroy() { /* no-op: one-shot */ }

  function getState() {
    return { initialized, fixed };
  }

  return { init, destroy, getState };
})();

