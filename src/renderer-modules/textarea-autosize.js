/**
 * V42 textareaAutosize module (OBSERVATION ONLY)
 *
 * V41 has autoResizePrompt() in renderer.js that handles the actual sizing.
 * This module wraps the existing behavior with a state observer.
 *
 * Public API:
 *   init()       - wrap the existing handler, force initial measure
 *   destroy()    - unwrap
 *   getState()   - { initialized, observerActive, currentHeight }
 *
 * Pure observation — does NOT mutate textarea.height.
 */
window.HermesModules = window.HermesModules || {};

window.HermesModules.textareaAutosize = (() => {
  let initialized = false;
  let observer = null;
  let textarea = null;
  let currentHeight = 0;

  function init(options = {}) {
    if (initialized) return;
    textarea = document.getElementById('promptInput');
    if (!textarea) return;
    initialized = true;
    currentHeight = textarea.offsetHeight;

    observer = new ResizeObserver(() => {
      currentHeight = textarea.offsetHeight;
    });
    observer.observe(textarea);
  }

  function destroy() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    textarea = null;
    currentHeight = 0;
    initialized = false;
  }

  function getState() {
    return { initialized, observerActive: observer !== null, currentHeight };
  }

  return { init, destroy, getState };
})();
