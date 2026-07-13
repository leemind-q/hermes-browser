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
