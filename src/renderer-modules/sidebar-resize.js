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
