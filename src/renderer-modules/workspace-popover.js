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
