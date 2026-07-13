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
