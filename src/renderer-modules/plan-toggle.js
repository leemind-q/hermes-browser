/**
 * V42 planToggle module (OBSERVATION ONLY)
 *
 * V41 already has setupPlanToggle() in renderer.js that handles the click.
 * This module observes state via MutationObserver and exposes getState().
 *
 * Public API:
 *   init()       - mount observer
 *   destroy()    - disconnect observer
 *   getState()   - { initialized, isExpanded }
 *
 * No click handler — V41's setupPlanToggle remains the single source of truth.
 */
window.HermesModules = window.HermesModules || {};

window.HermesModules.planToggle = (() => {
  let initialized = false;
  let observer = null;
  let list = null;
  let lastState = false;

  function readState() {
    if (!list) return false;
    return list.dataset.expanded === 'true';
  }

  function init(options = {}) {
    if (initialized) return;
    list = document.getElementById('planList');
    if (!list) return;
    initialized = true;
    lastState = readState();
    observer = new MutationObserver(() => {
      const cur = readState();
      if (cur !== lastState) {
        lastState = cur;
      }
    });
    observer.observe(list, { attributes: true, attributeFilter: ['data-expanded'] });
  }

  function destroy() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    list = null;
    initialized = false;
  }

  function getState() {
    return { initialized, isExpanded: readState() };
  }

  return { init, destroy, getState };
})();
