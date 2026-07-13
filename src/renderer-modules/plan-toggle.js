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
