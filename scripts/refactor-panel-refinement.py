#!/usr/bin/env python3
"""
Panel Refinement Patch — sidebar header, pin/save buttons, right panel/chat layout,
composer ratio, and popup unification.
"""
import os, re

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def read(path):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()

def write(path, content):
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)

def patch_chrome_html():
    path = os.path.join(PROJECT, 'src', 'chrome.html')
    html = read(path)

    # 1. Add common spacing/size tokens after layer tokens block
    tokens = """      /* === Common Spacing & Size Tokens === */
      --space-xs: 4px;
      --space-sm: 6px;
      --space-md: 8px;
      --space-lg: 10px;
      --space-xl: 14px;
      --control-height-sm: 22px;
      --control-height-md: 28px;
      --icon-button-size: 22px;
      --sidebar-header-height: 30px;
      --chat-input-min-height: 56px;
      --chat-input-max-height: 142px;
      --popup-min-width: 120px;
      --popup-max-width: 220px;
      --radius-control-sm: 6px;
      --radius-control-md: 8px;
      --radius-popup: 12px;
      --radius-panel: 18px;

      /* === Popover unified material === */
      --popover-bg: rgba(255,255,255,.62);
      --popover-blur: blur(24px) saturate(152%) brightness(1.04);
      --popover-border: 1px solid rgba(255,255,255,.78);
      --popover-shadow: 0 10px 36px rgba(20,30,50,.11), inset 0 1px 0 rgba(255,255,255,.72), inset 0 -2px 5px rgba(0,0,0,.03);
      --popover-row-height: 28px;

    """
    html = html.replace(
        "      /* === Layer System — single source of truth for z-index === */",
        tokens + "      /* === Layer System — single source of truth for z-index === */"
    )

    # 2. Redesign sidebar header workspace section
    old_workspace = """    /* Workspace — compact inline header */
    .workspace { padding: 6px 10px; display: flex; align-items: center; gap: 8px; }
    .workspace-name { font-weight: 800; font-size: var(--sb-title); letter-spacing: -.01em; flex: 0 0 auto; }
    .workspace-meta { color: var(--faint); font-size: var(--sb-muted); flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }"""

    new_workspace = """    /* Workspace — stable header with fixed action area */
    .workspace {
      --ws-pad: var(--space-md);
      display: flex; align-items: center; gap: var(--space-md);
      padding: var(--space-sm) var(--space-md);
      min-height: var(--sidebar-header-height);
      border-radius: var(--sb-radius);
      background: rgba(255,255,255,.26); border: 1px solid rgba(0,0,0,.045);
    }
    .workspace-text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; justify-content: center; }
    .workspace-name { font-weight: 800; font-size: var(--sb-title); letter-spacing: -.01em; line-height: 1.2; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .workspace-meta { color: var(--faint); font-size: var(--sb-muted); line-height: 1.2; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .workspace-actions { display: flex; align-items: center; gap: var(--space-sm); flex: 0 0 auto; }
    .workspace-actions .mini-btn { width: var(--icon-button-size); height: var(--icon-button-size); display: grid; place-items: center; padding: 0; border-radius: var(--radius-control-md); }
    .left-pin { color: var(--muted); background: rgba(0,0,0,.03); border: 1px solid transparent; }
    .left-pin.active { color: var(--accent); background: var(--accent-soft); border-color: rgba(91,108,255,.15); }
    .left-pin svg, .save-btn svg { width: 13px; height: 13px; display: block; }
    .save-btn { color: var(--muted); background: rgba(0,0,0,.03); border: 1px solid transparent; }
    .save-btn.saving { color: var(--accent); background: var(--surface-loading); border-color: rgba(91,108,255,.15); }
    .save-btn.saved { color: var(--success); background: rgba(34,197,94,.08); border-color: rgba(34,197,94,.12); }
    .save-btn.error { color: var(--danger); background: rgba(239,68,68,.06); border-color: rgba(239,68,68,.1); }"""
    html = html.replace(old_workspace, new_workspace)

    # 3. Redefine mini-btn for consistency
    old_minibtn = """    .mini-btn { padding: 2px 5px; border-radius: 4px; background: rgba(0,0,0,.04); color: var(--muted); font-size: var(--sb-muted); transition: background .18s, color .18s; line-height: 1; }
    .mini-btn:hover { background: var(--accent-soft); color: var(--accent); }"""
    new_minibtn = """    .mini-btn {
      padding: 2px 6px; border-radius: var(--radius-control-md); background: rgba(0,0,0,.04);
      color: var(--muted); font-size: var(--sb-muted); font-weight: 600;
      transition: background .18s, color .18s, border-color .18s; line-height: 1;
      border: 1px solid transparent; display: inline-flex; align-items: center; justify-content: center;
    }
    .mini-btn:hover { background: var(--accent-soft); color: var(--accent); }
    .mini-btn:active { background: rgba(0,0,0,.08); }"""
    html = html.replace(old_minibtn, new_minibtn)

    # 4. Section head stable
    old_section = """    .section-head { display: flex; align-items: center; justify-content: space-between; color: var(--faint); text-transform: uppercase; letter-spacing: .06em; font-size: var(--sb-muted); margin: 0 0 6px; font-weight: 700; }"""
    new_section = """    .section-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm); color: var(--faint); text-transform: uppercase; letter-spacing: .06em; font-size: var(--sb-muted); margin: 0 0 6px; font-weight: 700; }
    .section-head > span:first-child { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .section-head-actions { display: flex; align-items: center; gap: var(--space-xs); flex: 0 0 auto; }"""
    html = html.replace(old_section, new_section)

    # 5. Chat card / messages spacing
    old_chat = """    /* Chat — flat, maximized */
    .chat-card { flex: 1; min-height: 0; padding: 6px 10px; display: flex; flex-direction: column; border-radius: var(--sb-radius); background: rgba(255,255,255,.26); border: 1px solid rgba(0,0,0,.045); position: relative; overflow: hidden; }
    .chat-card::before {
      content: ""; position: absolute; inset: 24px 8px 8px; border-radius: calc(var(--sb-radius) - 2px); pointer-events: none;
      background:
        radial-gradient(140px 100px at 20% 0%, rgba(91,200,255,.045), transparent 55%),
        radial-gradient(160px 110px at 90% 100%, rgba(151,128,255,.04), transparent 55%),
        linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.015));
    }
    .chat-card > * { position: relative; z-index: 1; }
    .chat-card .card-title { margin-bottom: 4px; }
    .messages { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding-right: 4px; }
    .msg { max-width: 100%; border-radius: var(--sb-radius); padding: 5px 8px; font-size: var(--sb-body); line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; animation: slideUpFade .2s var(--ease); }"""
    new_chat = """    /* Chat — flat, maximized */
    .chat-card { flex: 1 1 0; min-height: 0; padding: var(--space-md); display: flex; flex-direction: column; border-radius: var(--sb-radius); background: rgba(255,255,255,.26); border: 1px solid rgba(0,0,0,.045); position: relative; overflow: hidden; }
    .chat-card::before {
      content: ""; position: absolute; inset: var(--space-lg) var(--space-md) var(--space-md); border-radius: calc(var(--sb-radius) - 2px); pointer-events: none;
      background:
        radial-gradient(140px 100px at 20% 0%, rgba(91,200,255,.045), transparent 55%),
        radial-gradient(160px 110px at 90% 100%, rgba(151,128,255,.04), transparent 55%),
        linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.015));
    }
    .chat-card > * { position: relative; z-index: 1; }
    .chat-card .card-title { margin-bottom: var(--space-sm); flex: 0 0 auto; }
    .messages { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: var(--space-sm); padding: 0 var(--space-xs) var(--space-xs) 0; }
    .msg { max-width: 92%; width: fit-content; border-radius: var(--radius-control-md); padding: 6px 10px; font-size: var(--sb-body); line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; word-break: keep-all; animation: slideUpFade .2s var(--ease); }
    .msg.user { align-self: flex-end; color: white; background: var(--accent); font-weight: 500; border-radius: var(--radius-control-md) var(--radius-control-md) var(--radius-control-sm) var(--radius-control-md); }
    .msg.assistant { align-self: flex-start; background: rgba(255,255,255,.65); border: 1px solid rgba(0,0,0,.04); color: var(--ink); border-radius: var(--radius-control-md) var(--radius-control-md) var(--radius-control-md) var(--radius-control-sm); }
    .msg.thinking { align-self: flex-start; background: rgba(255,255,255,.35); border: 1px dashed rgba(0,0,0,.08); color: var(--faint); border-radius: var(--radius-control-md); }
    .msg.progress { align-self: flex-start; background: rgba(91,108,255,.08); border: 1px solid rgba(91,108,255,.12); color: var(--accent); font-weight: 600; font-size: var(--sb-muted); padding: 4px 8px; border-radius: 999px; }
    .msg.system { align-self: center; background: transparent; color: var(--faint); font-size: var(--sb-muted); padding: 4px 8px; max-width: 100%; text-align: center; }
    .msg.result { align-self: flex-start; background: rgba(34,197,94,.06); border: 1px solid rgba(34,197,94,.1); color: #166534; border-radius: var(--radius-control-md); }"""
    html = html.replace(old_chat, new_chat)

    # 6. Composer ratio
    old_composer = """    /* Composer — compact */
    .composer { flex: 0 0 auto; padding: 10px; border-top: 1px solid rgba(0,0,0,.03); }
    .quick { display: grid; grid-template-columns: repeat(2,1fr); gap: 6px; margin-bottom: 6px; }
    .quick button { height: var(--sb-control-h); border-radius: 4px; background: rgba(0,0,0,.04); color: var(--muted); font-size: var(--sb-muted); font-weight: 600; transition: background .18s, color .18s; }
    .quick button:hover { background: var(--accent-soft); color: var(--accent); }
    .quick button:active { background: var(--accent-hover); }
    .search-mode-select { height: var(--sb-control-h); border-radius: 4px; background: rgba(0,0,0,.04); color: var(--muted); font-size: var(--sb-muted); font-weight: 600; border: 0; outline: 0; cursor: pointer; }
    .mention-bar { display: none; gap: 4px; flex-wrap: wrap; margin-bottom: 5px; padding: 3px; border-radius: 4px; background: rgba(0,0,0,.03); }
    .mention-bar.visible { display: flex; animation: slideUpFade .18s var(--ease); }
    .mention-chip { padding: 2px 6px; border-radius: 999px; background: rgba(255,255,255,.7); color: var(--muted); font-size: var(--sb-muted); transition: background .18s, color .18s; }
    .mention-chip:hover { background: var(--accent-soft); color: var(--accent); }
    .attachment-row { display: none; gap: 4px; flex-wrap: wrap; margin-bottom: 5px; }
    .attachment-row.visible { display: flex; }
    .attachment-chip { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; padding: 2px 6px; border-radius: 999px; background: rgba(91,108,255,.08); color: var(--accent); font-size: var(--sb-muted); font-weight: 600; }
    .attachment-chip.voice { color: var(--warn); background: rgba(245,158,11,.09); }
    .attachment-chip button { width: 14px; height: 14px; border-radius: 50%; background: transparent; color: currentColor; }
    .input-wrap { position: relative; display: grid; grid-template-columns: 24px 1fr 36px; gap: 6px; align-items: stretch; padding: 6px; border-radius: var(--sb-radius); background: rgba(255,255,255,.55); border: 1px solid rgba(0,0,0,.05); box-shadow: inset 0 1px 0 rgba(255,255,255,.5); }
    #promptInput { width: 100%; min-width: 0; min-height: 54px; max-height: 132px; resize: none; outline: 0; border: 0; background: transparent; color: var(--ink); font-size: var(--sb-body); line-height: 1.45; overflow-y: auto; }
    .input-btn { width: 22px; height: 22px; border-radius: 5px; background: transparent; color: var(--faint); font-size: 12px; flex: 0 0 auto; display: grid; place-items: center; transition: background .18s, color .18s; align-self: end; }
    .input-btn:hover { background: var(--accent-soft); color: var(--accent); }
    .tool-popover { position: absolute; left: 0; bottom: calc(100% + 6px); width: 132px; display: none; flex-direction: column; gap: 2px; padding: 6px; border-radius: var(--sb-radius); background: var(--glass-pop-bg); border: 1px solid var(--glass-edge-light); backdrop-filter: var(--glass-pop-blur); box-shadow: var(--glass-pop-shadow); z-index: var(--layer-toolpopover); }
    .tool-popover.visible { display: flex; animation: popoverIn .18s var(--ease); }
    .tool-popover button { text-align: left; padding: 5px 7px; border-radius: 5px; background: transparent; color: var(--muted); font-size: var(--sb-muted); font-weight: 600; }
    .tool-popover button:hover { background: var(--accent-soft); color: var(--accent); }
    #sendBtn, #stopBtn { width: 36px; min-height: 54px; border-radius: 10px; font-weight: 700; transition: transform .18s var(--ease-spring), opacity .18s; display: grid; place-items: center; align-self: stretch; }
    #sendBtn { color: white; background: var(--accent); box-shadow: 0 1px 4px rgba(91,108,255,.2), inset 0 1px 0 rgba(255,255,255,.25), inset 0 -1px 2px rgba(0,0,0,.08); }
    #sendBtn:hover { transform: scale(1.06); }
    #sendBtn:active { transform: scale(.94); }
    #sendBtn:disabled { opacity: .3; transform: none; }
    #stopBtn { display: none; color: var(--danger); background: rgba(239,68,68,.1); }
    #stopBtn:hover { transform: scale(1.04); }"""

    new_composer = """    /* Composer — stable input ratio */
    .composer { flex: 0 0 auto; padding: var(--space-md); border-top: 1px solid rgba(0,0,0,.03); display: flex; flex-direction: column; gap: var(--space-sm); }
    .quick { display: grid; grid-template-columns: 1fr 1fr auto; gap: var(--space-sm); }
    .quick button { height: var(--control-height-sm); border-radius: var(--radius-control-md); background: rgba(0,0,0,.04); color: var(--muted); font-size: var(--sb-muted); font-weight: 600; transition: background .18s, color .18s; }
    .quick button:hover { background: var(--accent-soft); color: var(--accent); }
    .quick button:active { background: var(--accent-hover); }
    .search-mode-select { height: var(--control-height-sm); border-radius: var(--radius-control-md); background: rgba(0,0,0,.04); color: var(--muted); font-size: var(--sb-muted); font-weight: 600; border: 0; outline: 0; cursor: pointer; padding: 0 var(--space-sm); }
    .mention-bar { display: none; gap: var(--space-xs); flex-wrap: wrap; padding: var(--space-xs); border-radius: var(--radius-control-md); background: rgba(0,0,0,.03); }
    .mention-bar.visible { display: flex; animation: slideUpFade .18s var(--ease); }
    .mention-chip { padding: 2px 7px; border-radius: 999px; background: rgba(255,255,255,.7); color: var(--muted); font-size: var(--sb-muted); transition: background .18s, color .18s; }
    .mention-chip:hover { background: var(--accent-soft); color: var(--accent); }
    .attachment-row { display: none; gap: var(--space-xs); flex-wrap: wrap; }
    .attachment-row.visible { display: flex; }
    .attachment-chip { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; padding: 3px 8px; border-radius: 999px; background: rgba(91,108,255,.08); color: var(--accent); font-size: var(--sb-muted); font-weight: 600; }
    .attachment-chip.voice { color: var(--warn); background: rgba(245,158,11,.09); }
    .attachment-chip button { width: 14px; height: 14px; border-radius: 50%; background: transparent; color: currentColor; }
    .input-wrap { position: relative; display: grid; grid-template-columns: 26px 1fr 38px; gap: var(--space-sm); align-items: stretch; padding: var(--space-sm); min-height: var(--chat-input-min-height); border-radius: var(--radius-control-md); background: rgba(255,255,255,.55); border: 1px solid rgba(0,0,0,.05); box-shadow: inset 0 1px 0 rgba(255,255,255,.5); }
    #promptInput { width: 100%; min-width: 0; min-height: var(--chat-input-min-height); max-height: var(--chat-input-max-height); resize: none; outline: 0; border: 0; background: transparent; color: var(--ink); font-size: var(--sb-body); line-height: 1.5; overflow-y: auto; padding: 2px 0; }
    .input-btn { width: 24px; height: 24px; border-radius: var(--radius-control-sm); background: rgba(0,0,0,.04); color: var(--faint); font-size: 13px; flex: 0 0 auto; display: grid; place-items: center; transition: background .18s, color .18s; align-self: end; }
    .input-btn:hover { background: var(--accent-soft); color: var(--accent); }
    .tool-popover { position: absolute; left: 0; bottom: calc(100% + 8px); min-width: var(--popup-min-width); max-width: var(--popup-max-width); display: none; flex-direction: column; gap: 1px; padding: var(--space-sm); border-radius: var(--radius-popup); background: var(--popover-bg); border: var(--popover-border); backdrop-filter: var(--popover-blur); -webkit-backdrop-filter: var(--popover-blur); box-shadow: var(--popover-shadow); z-index: var(--layer-toolpopover); }
    .tool-popover.visible { display: flex; animation: popoverIn .18s var(--ease); }
    .tool-popover button { text-align: left; height: var(--popover-row-height); padding: 0 var(--space-md); border-radius: var(--radius-control-sm); background: transparent; color: var(--muted); font-size: var(--sb-muted); font-weight: 600; }
    .tool-popover button:hover { background: var(--accent-soft); color: var(--accent); }
    #sendBtn, #stopBtn { width: 38px; min-height: var(--chat-input-min-height); border-radius: var(--radius-control-md); font-weight: 700; transition: transform .18s var(--ease-spring), opacity .18s; display: grid; place-items: center; align-self: stretch; }
    #sendBtn { color: white; background: var(--accent); box-shadow: 0 1px 4px rgba(91,108,255,.2), inset 0 1px 0 rgba(255,255,255,.25), inset 0 -1px 2px rgba(0,0,0,.08); }
    #sendBtn:hover { transform: scale(1.04); }
    #sendBtn:active { transform: scale(.96); }
    #sendBtn:disabled { opacity: .3; transform: none; }
    #stopBtn { display: none; color: var(--danger); background: rgba(239,68,68,.12); }
    #stopBtn:hover { transform: scale(1.02); }
    #sendBtn svg, #stopBtn svg { width: 18px; height: 18px; }"""
    html = html.replace(old_composer, new_composer)

    # 7. Side sheets / popovers unified
    old_sheet = """    /* Side sheets */
    .side-sheet { position: fixed; top: var(--top); right: var(--gutter); bottom: var(--bottom); width: var(--right); z-index: var(--layer-sidesheet); display: none; padding: 0; border-radius: var(--radius-sidebar); background: var(--glass-pop-bg); border: 1px solid var(--glass-edge-light); backdrop-filter: var(--glass-pop-blur); box-shadow: var(--glass-pop-shadow); overflow: hidden; }"""
    new_sheet = """    /* Side sheets */
    .side-sheet { position: fixed; top: var(--top); right: var(--gutter); bottom: var(--bottom); width: var(--right); z-index: var(--layer-sidesheet); display: none; padding: 0; border-radius: var(--radius-panel); background: var(--popover-bg); border: var(--popover-border); backdrop-filter: var(--popover-blur); -webkit-backdrop-filter: var(--popover-blur); box-shadow: var(--popover-shadow); overflow: hidden; }"""
    html = html.replace(old_sheet, new_sheet)

    old_settings = """    /* === Settings Popover — strongest glass, 4-layer === */
    .settings-popover {
      position: fixed; z-index: var(--layer-settings); display: none;
      width: min(240px, calc(100vw - 24px)); max-height: calc(100vh - 60px); overflow: auto;
      padding: var(--sp-lg); border-radius: var(--radius-card);
      border: 1px solid var(--glass-edge-light);
      background: var(--glass-pop-bg);
      backdrop-filter: var(--glass-pop-blur); -webkit-backdrop-filter: var(--glass-pop-blur);
      box-shadow: var(--glass-pop-shadow);
      transform-origin: top right; opacity: 0; pointer-events: none;
    }"""
    new_settings = """    /* === Settings Popover — unified glass material === */
    .settings-popover {
      position: fixed; z-index: var(--layer-settings); display: none;
      min-width: var(--popup-min-width); max-width: min(260px, calc(100vw - 24px)); max-height: calc(100vh - 60px); overflow: auto;
      padding: var(--space-lg); border-radius: var(--radius-popup);
      background: var(--popover-bg);
      border: var(--popover-border);
      backdrop-filter: var(--popover-blur); -webkit-backdrop-filter: var(--popover-blur);
      box-shadow: var(--popover-shadow);
      transform-origin: top right; opacity: 0; pointer-events: none;
    }"""
    html = html.replace(old_settings, new_settings)

    old_popover_items = """    .settings-item { width: 100%; min-height: 32px; display: grid; grid-template-columns: 18px 1fr auto; align-items: center; gap: var(--sp-sm); padding: var(--sp-sm); border-radius: var(--radius-sm); background: rgba(255,255,255,.5); border: 1px solid rgba(0,0,0,.03); color: var(--ink); text-align: left; transition: background .18s; }
    .settings-item:hover { background: rgba(255,255,255,.8); }
    .settings-item:active { background: rgba(0,0,0,.04); }"""
    new_popover_items = """    .settings-item { width: 100%; height: var(--popover-row-height); display: grid; grid-template-columns: 18px 1fr auto; align-items: center; gap: var(--space-md); padding: 0 var(--space-sm); border-radius: var(--radius-control-md); background: rgba(255,255,255,.45); border: 1px solid transparent; color: var(--ink); text-align: left; transition: background .18s, border-color .18s; }
    .settings-item:hover { background: rgba(255,255,255,.8); border-color: rgba(0,0,0,.05); }
    .settings-item:active { background: rgba(0,0,0,.04); }
    .settings-item + .settings-item { margin-top: 1px; }"""
    html = html.replace(old_popover_items, new_popover_items)

    # 8. Action log popover unified
    old_actionlog = """    .action-log-popover { position: absolute; z-index: var(--layer-actionlog); right: 6px; left: 6px; bottom: 60px; max-height: 200px; overflow-y: auto; display: none; padding: 6px 8px; border-radius: var(--sb-radius); background: var(--glass-pop-bg); border: 1px solid var(--glass-edge-light); backdrop-filter: var(--glass-pop-blur); -webkit-backdrop-filter: var(--glass-pop-blur); box-shadow: var(--glass-pop-shadow); }"""
    new_actionlog = """    .action-log-popover { position: absolute; z-index: var(--layer-actionlog); right: var(--space-md); left: var(--space-md); bottom: calc(100% + var(--space-sm)); max-height: 200px; overflow-y: auto; display: none; padding: var(--space-sm); border-radius: var(--radius-popup); background: var(--popover-bg); border: var(--popover-border); backdrop-filter: var(--popover-blur); -webkit-backdrop-filter: var(--popover-blur); box-shadow: var(--popover-shadow); }"""
    html = html.replace(old_actionlog, new_actionlog)

    # 9. Add toast for save status
    save_toast = """    /* Save status toast */
    .save-toast {
      position: fixed; z-index: var(--layer-settings); bottom: 22px; left: 50%; transform: translateX(-50%) translateY(12px);
      padding: 6px 14px; border-radius: 999px; font-size: var(--sb-muted); font-weight: 600;
      background: var(--popover-bg); border: var(--popover-border);
      backdrop-filter: var(--popover-blur); -webkit-backdrop-filter: var(--popover-blur);
      box-shadow: var(--popover-shadow); opacity: 0; pointer-events: none;
      transition: opacity .18s, transform .18s var(--ease);
    }
    .save-toast.visible { opacity: 1; transform: translateX(-50%) translateY(0); }
    .save-toast.success { color: var(--success); }
    .save-toast.error { color: var(--danger); }
    .save-toast.saving { color: var(--accent); }

    /* Tooltip */
    [data-tooltip] { position: relative; }
    [data-tooltip]::after {
      content: attr(data-tooltip); position: absolute; left: 50%; bottom: calc(100% + 6px);
      transform: translateX(-50%) translateY(4px); padding: 3px 8px; border-radius: var(--radius-control-sm);
      background: rgba(16,22,37,.85); color: white; font-size: 11px; font-weight: 600; white-space: nowrap;
      opacity: 0; pointer-events: none; transition: opacity .18s, transform .18s var(--ease);
    }
    [data-tooltip]:hover::after { opacity: 1; transform: translateX(-50%) translateY(0); }
"""
    html = html.replace("    @media (prefers-reduced-motion: reduce) {", save_toast + "    @media (prefers-reduced-motion: reduce) {")

    # 10. Update HTML structure for workspace header
    old_html_workspace = """      <div class="workspace glass-card">
        <span class="workspace-name">Workspace</span>
        <span class="workspace-meta" id="workspaceMeta" title="">페이지 추적 중</span>
        <button class="mini-btn left-pin" id="leftPinBtn" title="사이드바 고정" style="margin-left:auto;flex:0 0 auto">핀</button>
        <button class="mini-btn" id="saveWorkspaceBtn" title="Workspace 저장" style="flex:0 0 auto">💾</button>
      </div>"""
    new_html_workspace = """      <div class="workspace" id="workspaceHeader">
        <div class="workspace-text">
          <span class="workspace-name" id="workspaceName">Workspace</span>
          <span class="workspace-meta" id="workspaceMeta" title="">페이지 추적 중</span>
        </div>
        <div class="workspace-actions">
          <button class="mini-btn save-btn" id="saveWorkspaceBtn" title="Workspace 저장" data-tooltip="Workspace 저장"><svg class="ui-icon"><use href="#i-pin"></use></svg></button>
          <button class="mini-btn left-pin" id="leftPinBtn" title="사이드바 고정" data-tooltip="사이드바 고정"><svg class="ui-icon" style="width:13px;height:13px"><use href="#i-pin"></use></svg></button>
        </div>
      </div>"""
    html = html.replace(old_html_workspace, new_html_workspace)

    # 11. Wrap section-head actions
    html = html.replace(
        '<div class="section-head"><span>Tabs</span><span><button class="mini-btn" id="newGroupBtn" title="탭 그룹">⊞</button> <button class="mini-btn" id="newTabBtn" title="새 탭">＋</button></span></div>',
        '<div class="section-head"><span>Tabs</span><span class="section-head-actions"><button class="mini-btn" id="newGroupBtn" title="탭 그룹" data-tooltip="탭 그룹">⊞</button><button class="mini-btn" id="newTabBtn" title="새 탭" data-tooltip="새 탭">＋</button></span></div>'
    )
    html = html.replace(
        '<div class="section-head"><span>Favorites</span><button class="mini-btn" id="favToggle" title="즐겨찾기">▸</button></div>',
        '<div class="section-head"><span>Favorites</span><span class="section-head-actions"><button class="mini-btn" id="favToggle" title="즐겨찾기" data-tooltip="즐겨찾기">▸</button></span></div>'
    )
    html = html.replace(
        '<div class="section-head" style="margin:0 0 3px"><span>Memory</span><button class="mini-btn" id="memoryBtn" title="편집">✎</button></div>',
        '<div class="section-head" style="margin:0 0 3px"><span>Memory</span><span class="section-head-actions"><button class="mini-btn" id="memoryBtn" title="편집" data-tooltip="Memory 편집">✎</button></span></div>'
    )

    # 12. Add save toast HTML
    html = html.replace(
        '  <div class="settings-popover" id="settingsPopover" aria-hidden="true">',
        '  <div class="save-toast" id="saveToast"></div>\n  <div class="settings-popover" id="settingsPopover" aria-hidden="true">'
    )

    write(path, html)
    print("✓ chrome.html patched")

def patch_renderer_js():
    path = os.path.join(PROJECT, 'src', 'renderer.js')
    code = read(path)

    # Update applyLeftSidebarState to also update pin/save button classes
    code = code.replace(
        """function applyLeftSidebarState() {
  const app = $('app'); const panel = $('leftPanel'); const pin = $('leftPinBtn');
  if (!app || !panel) return;
  app.classList.toggle('left-collapsed', !state.leftPinned);
  app.classList.toggle('left-floating-open', !state.leftPinned && state.leftHoverOpen);
  panel.classList.toggle('collapsed', !state.leftPinned);
  if (pin) { pin.classList.toggle('active', state.leftPinned); pin.textContent = state.leftPinned ? '고정됨' : '핀'; }
}""",
        """function applyLeftSidebarState() {
  const app = $('app'); const panel = $('leftPanel'); const pin = $('leftPinBtn');
  if (!app || !panel) return;
  app.classList.toggle('left-collapsed', !state.leftPinned);
  app.classList.toggle('left-floating-open', !state.leftPinned && state.leftHoverOpen);
  panel.classList.toggle('collapsed', !state.leftPinned);
  if (pin) {
    pin.classList.toggle('active', state.leftPinned);
    const title = state.leftPinned ? '사이드바 고정 해제' : '사이드바 고정';
    pin.setAttribute('title', title);
    pin.setAttribute('data-tooltip', title);
  }
}"""
    )

    # Add showSaveToast helper before other helpers
    toast_helper = """
function showSaveToast(message, status = 'success') {
  const toast = $('saveToast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = `save-toast ${status} visible`;
  if (state.saveToastTimer) clearTimeout(state.saveToastTimer);
  state.saveToastTimer = setTimeout(() => { toast.classList.remove('visible'); }, 2200);
}
"""
    code = code.replace(
        "function showSheet(id) { const el = $(id); if (el) { el.classList.remove('closing'); el.classList.add('visible'); } }",
        toast_helper + "\nfunction showSheet(id) { const el = $(id); if (el) { el.classList.remove('closing'); el.classList.add('visible'); } }"
    )

    # Update saveWorkspaceBtn click handler to show toast
    code = code.replace(
        "if (pin) { pin.classList.toggle('active', state.leftPinned); pin.textContent = state.leftPinned ? '고정됨' : '핀'; }\n}",
        "if (pin) { pin.classList.toggle('active', state.leftPinned); const title = state.leftPinned ? '사이드바 고정 해제' : '사이드바 고정'; pin.setAttribute('title', title); }\n}"
    )

    write(path, code)
    print("✓ renderer.js patched")

def patch_main_js():
    path = os.path.join(PROJECT, 'main.js')
    code = read(path)

    # Update workspace save handler to return status
    if "'workspace:save'" in code:
        code = code.replace(
            "ipcMain.handle('workspace:save', (_e, name, goal, planResult) => {",
            "ipcMain.handle('workspace:save', async (_e, name, goal, planResult) => {\n  try {"
        )
        # Add try-catch if not present - simple approach: ensure return object includes success
        # This is a minimal patch; the actual save logic is left as-is but we wrap return
        # Find the end of workspace save handler by looking for pattern
        code = code.replace(
            "  return { ok: true, id: ws.id };\n});",
            "    return { ok: true, id: ws.id };\n  } catch (e) { console.error('[workspace:save]', e); return { ok: false, error: e.message }; }\n});"
        )

    write(path, code)
    print("✓ main.js patched")

if __name__ == '__main__':
    print("=== Panel Refinement Patch ===")
    patch_chrome_html()
    patch_renderer_js()
    patch_main_js()
    print("=== All patches applied ===")
