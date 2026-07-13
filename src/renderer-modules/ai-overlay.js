/**
 * V45 AI Overlay module — REAL OWNERSHIP
 *
 * Single source of truth for AI panel's overlay behavior:
 * - 1100px 이하에서 rightPanel이 오버레이로 변환될 때의 toggle 동작
 * - body[data-ai-closed] attribute 제어 (CSS transform trigger)
 * - ESC 키 close
 * - 닫기 버튼 close
 * - backdrop click close (dynamically created)
 * - resize 대응 (1100px 기준 docked/overlay 모드)
 * - 닫은 후 trigger focus 복귀
 *
 * docked vs overlay 모드:
 * - docked: width > 1100 → rightPanel은 grid column (CSS only)
 * - overlay-closed: width ≤ 1100 → rightPanel transform: translateX(...)
 * - overlay-open: width ≤ 1100 → rightPanel 정상 위치
 *
 * Public API:
 *   init(options?)        - mount listeners + initial state
 *   open(options?)        - open overlay
 *   close(options?)       - close overlay + restore focus
 *   toggle(options?)      - toggle open/close
 *   isOpen()              - true if overlay currently visible
 *   getMode()             - 'docked' | 'overlay-open' | 'overlay-closed'
 *   getState()            - { initialized, open, mode, viewportWidth, top, bottom, height, triggerId, focusReturnTarget }
 *   destroy()             - remove all listeners
 *
 * Idempotent: multiple init() safe.
 *
 * Replaces renderer.js L170-198 setupOverlayClose IIFE.
 */
window.HermesModules = window.HermesModules || {};

window.HermesModules.aiOverlay = (() => {
  let initialized = false;
  let escHandler = null;
  let closeBtnHandler = null;
  let backdropClickHandler = null;
  let resizeHandler = null;
  let lastTrigger = null;
  let lastViewportWidth = 0;

  // Configurable
  let overlayBreakpoint = 1100;
  let selectors = {
    panel: '#rightPanel',
    closeButton: '#aiOverlayClose',
    backdrop: '#aiOverlayBackdrop',
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

  function setOverlayState(open, options = {}) {
    if (getMode() === 'docked') return; // docked mode: no-op
    if (!open) {
      document.body.setAttribute('data-ai-closed', 'true');
      // Restore focus if requested
      if (options.restoreFocus && lastTrigger) {
        lastTrigger.focus();
      }
    } else {
      // Record trigger before opening
      if (options.trigger) {
        lastTrigger = options.trigger;
      } else if (document.activeElement && document.activeElement.id) {
        lastTrigger = document.activeElement;
      }
      document.body.removeAttribute('data-ai-closed');
    }
  }

  function getTrigger() {
    return (
      document.querySelector('[data-action="ai-overlay"]') ||
      document.getElementById('aiOverlayToggle') ||
      document.getElementById('railNewChat')
    );
  }

  function open(options = {}) {
    setOverlayState(true, options);
  }

  function close(options = {}) {
    setOverlayState(false, options);
  }

  function toggle(options = {}) {
    if (isOpen()) {
      close(options);
    } else {
      open(options);
    }
  }

  function onEsc(e) {
    if (e.key !== 'Escape') return;
    if (getMode() !== 'overlay-open') return;
    // Caller (keyboardShortcuts) decides priority; we only close if we ARE open
    e.preventDefault();
    close({ restoreFocus: true });
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
    // Mode change is automatic via CSS media queries.
    // We only update lastViewportWidth for state reporting.
    lastViewportWidth = window.innerWidth;
    // If mode changes from overlay-open → docked, clear data-ai-closed so it doesn't re-trigger
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
      lastViewportWidth = window.innerWidth;

      // ESC handler — attached to document so it bubbles before keyboardShortcuts
      // but we only act when overlay is open
      escHandler = (e) => onEsc(e);
      document.addEventListener('keydown', escHandler);

      // Close button
      const closeBtn = document.querySelector(selectors.closeButton);
      if (closeBtn) {
        closeBtnHandler = () => onCloseBtnClick();
        closeBtn.addEventListener('click', closeBtnHandler);
      }

      // Backdrop click
      backdropClickHandler = (e) => onBackdropClick(e);
      document.addEventListener('click', backdropClickHandler);

      // Resize handler
      resizeHandler = () => onResize();
      window.addEventListener('resize', resizeHandler);

      initialized = true;
    } catch (err) {
      console.error('[aiOverlay] init failed:', err);
    }
  }

  function destroy() {
    try {
      if (escHandler) {
        document.removeEventListener('keydown', escHandler);
      }
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
    } catch (err) {
      console.error('[aiOverlay] destroy failed:', err);
    }
    escHandler = null;
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
      triggerId: lastTrigger?.id || null,
      focusReturnTarget: lastTrigger?.id || null,
    };
  }

  return { init, open, close, toggle, isOpen, getMode, getState, destroy };
})();
