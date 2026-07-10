// src/renderer/command-palette.js — Quick command palette (Ctrl+Shift+P)
//
// VS Code-style command palette. Fuzzy-search through available commands
// and execute via IPC. Designed as a self-contained module so it can be
// enabled/disabled without touching renderer.js.
//
// Activation: Ctrl+Shift+P (Cmd+Shift+P on macOS) or via menu.
// Dismiss: Escape or click outside.

const { ipcRenderer } = require('electron');

const COMMANDS = [
  // Navigation
  { id: 'nav.google',     label: 'Navigate: Google',         action: () => window.dispatchCommand('navigate', 'https://www.google.com') },
  { id: 'nav.naver',      label: 'Navigate: Naver',          action: () => window.dispatchCommand('navigate', 'https://www.naver.com') },
  { id: 'nav.example',    label: 'Navigate: example.com',    action: () => window.dispatchCommand('navigate', 'https://example.com') },
  // Tab
  { id: 'tab.new',        label: 'Tab: New Tab',             action: () => window.dispatchCommand('createTab') },
  { id: 'tab.close',      label: 'Tab: Close Active Tab',    action: () => window.dispatchCommand('closeActiveTab') },
  // Mode
  { id: 'mode.ask',       label: 'Mode: ask',                action: () => window.dispatchCommand('setMode', 'ask') },
  { id: 'mode.assist',    label: 'Mode: assist',             action: () => window.dispatchCommand('setMode', 'assist') },
  { id: 'mode.agent',     label: 'Mode: agent',              action: () => window.dispatchCommand('setMode', 'agent') },
  { id: 'mode.auto',      label: 'Mode: auto',               action: () => window.dispatchCommand('setMode', 'auto') },
  // Agent tools (most-used subset)
  { id: 'agent.search',   label: 'Agent: Web Search…',       action: () => openArgumentDialog('search', 'Search query:') },
  { id: 'agent.read',     label: 'Agent: Read Page',         action: () => window.dispatchCommand('agent', 'readPage') },
  { id: 'agent.inspect',  label: 'Agent: Inspect Page',      action: () => window.dispatchCommand('agent', 'inspectPage') },
  { id: 'agent.summarize',label: 'Agent: Summarize Page',    action: () => window.dispatchCommand('agent', 'summarize') },
  // Credentials
  { id: 'cred.list',      label: 'Credential: List Saved',   action: () => window.dispatchCommand('credentialList') },
  { id: 'cred.save',      label: 'Credential: Save…',        action: () => openArgumentDialog('credentialSave', 'Domain:') },
  // View
  { id: 'view.zoomIn',    label: 'View: Zoom In',            action: () => window.dispatchCommand('zoomIn') },
  { id: 'view.zoomOut',   label: 'View: Zoom Out',           action: () => window.dispatchCommand('zoomOut') },
  { id: 'view.zoomReset', label: 'View: Reset Zoom',         action: () => window.dispatchCommand('zoomReset') },
  // DevTools
  { id: 'dev.tools',      label: 'Developer: Toggle DevTools', action: () => window.dispatchCommand('toggleDevTools') },
  { id: 'dev.reload',     label: 'Developer: Reload Page',   action: () => window.dispatchCommand('reloadPage') },
];

class CommandPalette {
  constructor() {
    this.commands = COMMANDS;
    this.isOpen = false;
    this.selectedIndex = 0;
    this.filtered = [...this.commands];
    this.el = null;
    this.inputEl = null;
    this.listEl = null;
    this._keyHandler = this._keyHandler.bind(this);
    this._clickOutside = this._clickOutside.bind(this);
  }

  init() {
    // Register keyboard shortcut at document level
    document.addEventListener('keydown', (e) => {
      const isMac = navigator.platform.includes('Mac');
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        this.toggle();
      } else if (this.isOpen && e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
    // Expose API for menu/shortcuts to call us
    window.openCommandPalette = () => this.toggle();
    window.openArgumentDialog = openArgumentDialog;
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.selectedIndex = 0;
    this.filtered = [...this.commands];
    this._render();
    setTimeout(() => this.inputEl?.focus(), 0);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
    this.el = null;
    this.inputEl = null;
    this.listEl = null;
  }

  _render() {
    if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
    const wrap = document.createElement('div');
    wrap.id = 'cmd-palette';
    wrap.style.cssText = `
      position: fixed; top: 80px; left: 50%; transform: translateX(-50%);
      width: 600px; max-width: 90vw;
      background: rgba(28, 28, 32, 0.98);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 12px;
      box-shadow: 0 12px 48px rgba(0,0,0,0.5);
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: #e6e8f0;
      backdrop-filter: blur(20px);
    `;
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Type a command or search…';
    input.style.cssText = `
      width: 100%; padding: 16px 20px;
      background: transparent; border: none; outline: none;
      color: #e6e8f0; font-size: 16px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      box-sizing: border-box;
    `;
    input.addEventListener('input', (e) => this._filter(e.target.value));
    input.addEventListener('keydown', (e) => this._onInputKeydown(e));
    this.inputEl = input;
    const list = document.createElement('div');
    list.style.cssText = 'max-height: 360px; overflow-y: auto; padding: 8px 0;';
    this.listEl = list;
    wrap.appendChild(input);
    wrap.appendChild(list);
    document.body.appendChild(wrap);
    this.el = wrap;
    document.addEventListener('click', this._clickOutside);
    this._renderList();
  }

  _clickOutside(e) {
    if (this.el && !this.el.contains(e.target)) this.close();
  }

  _filter(query) {
    const q = query.trim().toLowerCase();
    if (!q) {
      this.filtered = [...this.commands];
    } else {
      // Fuzzy match: substring match on label (case-insensitive)
      // Tighter match (earlier position or contiguous) ranks higher.
      this.filtered = this.commands
        .map(c => ({ c, score: scoreMatch(c.label, q) }))
        .filter(x => x.score >= 0)
        .sort((a, b) => b.score - a.score)
        .map(x => x.c);
    }
    this.selectedIndex = 0;
    this._renderList();
  }

  _renderList() {
    if (!this.listEl) return;
    this.listEl.innerHTML = '';
    if (this.filtered.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'No matching commands';
      empty.style.cssText = 'padding: 12px 20px; color: #6b7280; font-size: 14px;';
      this.listEl.appendChild(empty);
      return;
    }
    this.filtered.forEach((cmd, i) => {
      const item = document.createElement('div');
      item.className = 'cmd-palette-item';
      item.dataset.idx = i;
      item.style.cssText = `
        padding: 10px 20px;
        cursor: pointer;
        font-size: 14px;
        background: ${i === this.selectedIndex ? 'rgba(91, 108, 255, 0.25)' : 'transparent'};
        color: ${i === this.selectedIndex ? '#fff' : '#e6e8f0'};
      `;
      item.textContent = cmd.label;
      item.addEventListener('click', () => this._execute(cmd));
      item.addEventListener('mouseenter', () => {
        this.selectedIndex = i;
        this._renderList();
      });
      this.listEl.appendChild(item);
    });
  }

  _onInputKeydown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.selectedIndex = Math.min(this.filtered.length - 1, this.selectedIndex + 1);
      this._renderList();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this._renderList();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = this.filtered[this.selectedIndex];
      if (cmd) this._execute(cmd);
    }
  }

  _execute(cmd) {
    try {
      cmd.action();
    } catch (e) {
      console.error('[command-palette] execute failed:', e);
    }
    this.close();
  }
}

// Fuzzy scoring: contiguous substring scores higher; earlier positions rank higher.
function scoreMatch(text, query) {
  if (!query) return 0;
  const idx = text.toLowerCase().indexOf(query);
  if (idx < 0) {
    // fallback: char-by-char in-order match (loose)
    let ti = 0;
    for (const ch of query) {
      ti = text.toLowerCase().indexOf(ch, ti);
      if (ti < 0) return -1;
      ti++;
    }
    return 1;
  }
  // Earlier index = higher score.
  return 100 - idx;
}

// Argument dialog: simple prompt() fallback — fine for PoC.
function openArgumentDialog(intent, message) {
  const v = prompt(message);
  if (v === null || v.trim() === '') return;
  const arg = { intent, value: v.trim() };
  window.dispatchCommand(intent, v.trim());
}

// Singleton — let renderer.js init once.
const palette = new CommandPalette();
module.exports = { CommandPalette, palette };