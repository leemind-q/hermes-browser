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
