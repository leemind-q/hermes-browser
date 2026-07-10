from pathlib import Path
import re
base = Path('/mnt/c/Users/qqwer/OneDrive/Desktop/hermes-browser')
html_p = base/'src/chrome.html'
renderer_p = base/'src/renderer.js'
preload_p = base/'src/preload.js'
main_p = base/'main.js'
test_p = base/'tests/smoke.test.js'

html = html_p.read_text(encoding='utf-8')
renderer = renderer_p.read_text(encoding='utf-8')
preload = preload_p.read_text(encoding='utf-8')
main = main_p.read_text(encoding='utf-8')
test = test_p.read_text(encoding='utf-8')

# === chrome.html: compact layout + liquid glass tokens ===
html = html.replace('--left: 156px; --right: 340px; --top: 88px;', '--left: 112px; --right: 228px; --top: 58px;')
html = html.replace('--gutter: 16px; --gap: 14px; --bottom: 16px;', '--gutter: 10px; --gap: 8px; --bottom: 10px;')
html = html.replace('font-size: 13px;', 'font-size: 12px;', 1)
html = html.replace('--ink: #152030; --muted: rgba(30,42,70,.6); --faint: rgba(30,42,70,.38);', '--ink: #142033; --muted: rgba(28,42,70,.62); --faint: rgba(28,42,70,.40);')
html = html.replace('--line: rgba(255,255,255,.7); --line-cool: rgba(120,150,255,.22);', '--line: rgba(255,255,255,.72); --line-cool: rgba(116,150,255,.20);')
html = html.replace('--glass: rgba(255,255,255,.46); --glass-strong: rgba(255,255,255,.68);', '--glass: rgba(255,255,255,.38); --glass-strong: rgba(255,255,255,.58);')
html = html.replace('--shadow-soft: 0 24px 80px rgba(50,80,150,.16);', '--shadow-soft: 0 16px 48px rgba(50,80,150,.13);')
html = html.replace('--shadow-float: 0 18px 70px rgba(74,104,170,.18), 0 2px 10px rgba(255,255,255,.18), inset 0 1px 0 rgba(255,255,255,.92), inset 0 -1px 0 rgba(120,150,255,.10);', '--shadow-float: 0 12px 42px rgba(74,104,170,.14), 0 1px 8px rgba(255,255,255,.16), inset 0 1px 0 rgba(255,255,255,.88), inset 0 -1px 0 rgba(120,150,255,.10);')
html = html.replace('--blur: blur(34px) saturate(190%);', '--blur: blur(24px) saturate(170%);')
html = html.replace('--fs-xs: 10px; --fs-sm: 11px; --fs-base: 13px; --fs-md: 14px; --fs-lg: 16px; --fs-xl: 18px;', '--fs-xs: 8.5px; --fs-sm: 10px; --fs-base: 11px; --fs-md: 12px; --fs-lg: 13.5px; --fs-xl: 15px;')
html = html.replace('--sp-xs: 4px; --sp-sm: 6px; --sp-md: 10px; --sp-lg: 14px; --sp-xl: 20px;', '--sp-xs: 3px; --sp-sm: 5px; --sp-md: 7px; --sp-lg: 10px; --sp-xl: 14px;')
html = html.replace('--radius-sm: 10px; --radius-md: 16px; --radius-lg: 22px; --radius-xl: 28px;', '--radius-sm: 7px; --radius-md: 11px; --radius-lg: 15px; --radius-xl: 20px;')
html = html.replace('--btn-sm: 28px; --btn-md: 34px; --btn-lg: 38px;', '--btn-sm: 22px; --btn-md: 26px; --btn-lg: 30px;')
html = re.sub(r"body::before \{[\s\S]*?\n    \}\n    body::after \{[\s\S]*?\n    \}", """body::before {
      content: \"\"; position: fixed; inset: 0; pointer-events: none;
      background:
        radial-gradient(720px 460px at 8% 8%, rgba(83,211,255,.34), transparent 60%),
        radial-gradient(620px 420px at 88% 12%, rgba(142,126,255,.28), transparent 62%),
        radial-gradient(680px 500px at 58% 110%, rgba(255,194,163,.30), transparent 60%),
        linear-gradient(135deg, #fbfdff 0%, #edf5ff 48%, #fff5ef 100%);
    }
    body::after {
      content: \"\"; position: fixed; inset: 0; pointer-events: none; opacity: .25;
      background:
        radial-gradient(rgba(255,255,255,.78) .8px, transparent .8px),
        linear-gradient(112deg, rgba(255,255,255,.30), transparent 34%, rgba(118,150,255,.07) 66%, transparent);
      background-size: 22px 22px, 100% 100%;
      mask-image: radial-gradient(circle at 50% 38%, black, transparent 84%);
    }""", html, count=1)
html = re.sub(r"/\* === Topbar[\s\S]*?\.basics-btn:active \{ transform: scale\(\.88\); \}", """/* === Topbar — compact liquid glass shell === */
    .topbar {
      position: absolute; z-index: 110; -webkit-app-region: drag;
      left: var(--gutter); right: var(--gutter); top: 8px; height: 34px;
      display: flex; align-items: center; gap: 6px;
      padding: 0 7px;
      border: 1px solid rgba(255,255,255,.78); border-radius: 17px;
      background: linear-gradient(145deg, rgba(255,255,255,.52), rgba(255,255,255,.21) 58%, rgba(231,242,255,.17));
      backdrop-filter: var(--blur); box-shadow: var(--shadow-float); overflow: hidden;
    }
    .topbar::before { content:\"\"; position:absolute; inset:1px 1px auto 1px; height:44%; border-radius: inherit; background: linear-gradient(180deg, rgba(255,255,255,.58), transparent); pointer-events:none; }
    .topbar > * { position: relative; z-index: 1; }
    .topbar button, .topbar input { -webkit-app-region: no-drag; }
    .traffic { display: flex; gap: 6px; -webkit-app-region: no-drag; flex: 0 0 auto; padding-right: 2px; }
    .dot { width: 9px; height: 9px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(0,0,0,.12); transition: transform .2s var(--ease-spring), box-shadow .18s; }
    .dot:hover { transform: scale(1.16); box-shadow: inset 0 0 0 1px rgba(0,0,0,.12), 0 0 9px currentColor; }
    .dot:active { transform: scale(.9); }
    .red { background:#ff6058; color:#ff6058; } .yellow { background:#ffbd2e; color:#ffbd2e; } .green { background:#28c840; color:#28c840; }

    .nav-group, .tool-group, .top-actions { display: flex; gap: 3px; flex: 0 0 auto; -webkit-app-region: no-drag; align-items: center; }
    .tool-group { padding-left: 5px; border-left: 1px solid rgba(120,150,255,.12); }
    .top-actions { padding-left: 3px; }
    .ui-icon { display:block; width: 14px; height: 14px; stroke: currentColor; stroke-width: 1.75; fill: none; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
    .icon-btn .ui-icon, .basics-btn .ui-icon { width: 14px; height: 14px; }
    .icon-btn, .basics-btn { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 8px; background: rgba(255,255,255,.05); color: var(--muted); font-size: 12px; line-height: 0; transition: transform .18s var(--ease-spring), background .18s, color .18s, border-color .18s; }
    .icon-btn:hover, .basics-btn:hover { background: rgba(130,120,255,.11); color: var(--ink); transform: translateY(-.5px); }
    .icon-btn:active, .basics-btn:active { transform: scale(.90); background: rgba(255,255,255,.18); }
    .address {
      flex: 1; min-width: 120px; height: 24px;
      display: flex; align-items: center; gap: 5px;
      padding: 0 8px; border-radius: 999px;
      border: 1px solid rgba(116,150,255,.18);
      background: rgba(255,255,255,.42);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.72), inset 0 -1px 0 rgba(118,150,255,.07);
      -webkit-app-region: no-drag;
    }
    #addressInput { flex: 1; min-width: 60px; height: 20px; outline: 0; border: 0; background: transparent; color: var(--ink); font-size: 10.5px; line-height: 20px; }
    #pagePill { max-width: 110px; padding: 2px 7px; border-radius: 999px; background: rgba(255,255,255,.52); color: var(--muted); font-size: 8.5px; line-height: 13px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; transition: opacity .2s; }""", html, count=1)
html = re.sub(r"\.floating-panel \{[\s\S]*?\.right\.collapsed \{ transform: translateX\(110%\); opacity: 0; pointer-events: none; \}", """.floating-panel { position: absolute; z-index: 25; border: 1px solid rgba(255,255,255,.72); border-radius: var(--radius-xl); background: linear-gradient(145deg, rgba(255,255,255,.42), rgba(255,255,255,.18) 58%, rgba(231,242,255,.15)); backdrop-filter: var(--blur); box-shadow: var(--shadow-float); overflow: hidden; transition: transform .18s ease-out, opacity .14s ease-out; }
    .floating-panel::before { content:\"\"; position:absolute; inset:0; pointer-events:none; background: linear-gradient(126deg, rgba(255,255,255,.56), rgba(255,255,255,.08) 32%, transparent 62%), radial-gradient(340px 160px at 25% 0%, rgba(255,255,255,.44), transparent 60%); opacity:.72; }
    .floating-panel::after { content:\"\"; position:absolute; inset:0; border-radius: inherit; pointer-events:none; box-shadow: inset 0 0 0 1px rgba(255,255,255,.38), inset 0 -18px 42px rgba(118,148,255,.06); }
    .floating-panel > * { position: relative; z-index: 1; }
    .left { left: var(--gutter); top: var(--top); bottom: var(--bottom); width: var(--left); padding: 7px; display: flex; flex-direction: column; gap: 7px; overflow-y: auto; }
    .left.collapsed { transform: translateX(-110%); opacity: 0; pointer-events: none; }
    .right { right: var(--gutter); top: var(--top); bottom: var(--bottom); width: var(--right); display: flex; flex-direction: column; }
    .right.collapsed { transform: translateX(110%); opacity: 0; pointer-events: none; }""", html, count=1)
# compact overrides/replacements
pairs = [
('.panel-toggle { position: absolute; z-index: 26; width: 24px; height: 40px;', '.panel-toggle { position: absolute; z-index: 26; width: 20px; height: 32px;'),
('font-size: 14px; transition: background .25s', 'font-size: 12px; transition: background .25s'),
('.left-toggle { left: 4px; top: calc(50% - 20px); }', '.left-toggle { left: 3px; top: calc(50% - 16px); }'),
('.right-toggle { right: 4px; top: calc(50% - 20px); }', '.right-toggle { right: 3px; top: calc(50% - 16px); }'),
('border-radius: 18px;', 'border-radius: 13px;'),
('.workspace { padding: 9px; }', '.workspace { padding: 7px; }'),
('font-size: 12px; letter-spacing', 'font-size: 10.5px; letter-spacing'),
('font-size: 9.5px; line-height: 1.35; max-height: 38px;', 'font-size: 8.5px; line-height: 1.25; max-height: 28px;'),
('font-size: 9px; margin: 0 2px 7px;', 'font-size: 8px; margin: 0 1px 5px;'),
('.mini-btn { padding: 4px 7px;', '.mini-btn { padding: 3px 5px;'),
('font-size: var(--fs-xs); box-shadow:', 'font-size: 8.5px; box-shadow:'),
('.tabs { min-height: 60px;', '.tabs { min-height: 42px;'),
('gap: var(--sp-sm); }\n    .tab-group', 'gap: 4px; }\n    .tab-group'),
('margin-bottom: var(--sp-sm); animation', 'margin-bottom: 4px; animation'),
('font-size: var(--fs-xs); font-weight: 700; margin: var(--sp-md) 2px var(--sp-sm);', 'font-size: 8.5px; font-weight: 700; margin: 6px 1px 4px;'),
('.tab { padding: 8px;', '.tab { padding: 6px;'),
('border-radius: var(--radius-md); background: rgba(255,255,255,.4);', 'border-radius: 10px; background: rgba(255,255,255,.32);'),
('.tab-title { font-weight: 700; font-size: 10.5px;', '.tab-title { font-weight: 700; font-size: 9.5px;'),
('.tab-url { grid-column: 1/-1; color: var(--faint); font-size: 9px;', '.tab-url { grid-column: 1/-1; color: var(--faint); font-size: 8px;'),
('.tab-close { width: 20px; height: 20px;', '.tab-close { width: 16px; height: 16px;'),
('.tab-pin { width: 18px; height: 18px;', '.tab-pin { width: 16px; height: 16px;'),
('.memory-mini { padding: 9px; color: var(--muted); font-size: 10px; display: grid; gap: 5px; }', '.memory-mini { padding: 7px; color: var(--muted); font-size: 8.5px; display: grid; gap: 4px; }'),
]
for a,b in pairs:
    html = html.replace(a,b)
html = re.sub(r"\.browser-frame \{[\s\S]*?\.app\.right-collapsed \.browser-frame \{ right: var\(--gutter\); \}", """.browser-frame { position: absolute; z-index: 5; left: calc(var(--gutter) + var(--left) + var(--gap)); right: calc(var(--gutter) + var(--right) + var(--gap)); top: var(--top); bottom: var(--bottom); border-radius: 24px; background: linear-gradient(145deg, rgba(255,255,255,.54), rgba(255,255,255,.18) 62%, rgba(232,243,255,.16)); border: 1px solid rgba(255,255,255,.78); box-shadow: 0 18px 62px rgba(60,90,150,.16), inset 0 1px 0 rgba(255,255,255,.86), inset 0 -1px 0 rgba(120,150,255,.10); pointer-events: none; transition: left .18s ease-out, right .18s ease-out; overflow:hidden; }
    .browser-frame::before { content:\"\"; position:absolute; inset:4px; border-radius: 20px; border:1px solid rgba(255,255,255,.54); box-shadow: inset 0 0 0 1px rgba(120,150,255,.10), inset 0 12px 26px rgba(255,255,255,.24); pointer-events:none; }
    .browser-frame::after { content:\"\"; position:absolute; left:16px; right:16px; top:7px; height:24px; border-radius:999px; background: linear-gradient(180deg, rgba(255,255,255,.46), transparent); opacity:.62; pointer-events:none; }
    .app.left-collapsed .browser-frame { left: calc(var(--gutter) + var(--gap)); }
    .app.right-collapsed .browser-frame { right: var(--gutter); }""", html, count=1)
right_pairs = [
('.agent-head { padding: var(--sp-lg);', '.agent-head { padding: 9px;'),
('.agent-title { font-size: var(--fs-lg);', '.agent-title { font-size: 12px;'),
('.conn { color: var(--faint); font-size: var(--fs-xs); margin-top: 3px; }', '.conn { color: var(--faint); font-size: 8.5px; margin-top: 2px; }'),
('.mode { margin-top: var(--sp-md);', '.mode { margin-top: 7px;'),
('gap: var(--sp-xs); padding: 4px;', 'gap: 3px; padding: 3px;'),
('.mode button { height: 30px;', '.mode button { height: 22px;'),
('.goal { margin-top: var(--sp-md); padding: var(--sp-md);', '.goal { margin-top: 7px; padding: 7px;'),
('.goal-label, .card-title { color: var(--faint); font-size: var(--fs-xs);', '.goal-label, .card-title { color: var(--faint); font-size: 8px;'),
('.goal-text { margin-top: 4px; font-size: var(--fs-sm);', '.goal-text { margin-top: 3px; font-size: 9.5px;'),
('.right-body { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: var(--sp-md); padding: var(--sp-lg); overflow: hidden; }', '.right-body { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 7px; padding: 8px; overflow: hidden; }'),
('.plan-card { flex: 0 0 auto; padding: var(--sp-md); border-radius: var(--radius-lg);', '.plan-card { flex: 0 0 auto; padding: 7px; border-radius: 13px;'),
('max-height: 44px;', 'max-height: 32px;'),
('.plan-card.expanded { max-height: 280px; }', '.plan-card.expanded { max-height: 190px; }'),
('.plan-toggle { width: 28px; height: 26px;', '.plan-toggle { width: 22px; height: 20px;'),
('.step { display: flex; align-items: flex-start; gap: var(--sp-sm); color: var(--muted); font-size: var(--fs-sm); line-height: 1.4; }', '.step { display: flex; align-items: flex-start; gap: 5px; color: var(--muted); font-size: 9px; line-height: 1.32; }'),
('.step-dot { width: 18px; height: 18px;', '.step-dot { width: 14px; height: 14px;'),
('.chat-card { flex: 1; min-height: 0; padding: var(--sp-md);', '.chat-card { flex: 1; min-height: 0; padding: 7px;'),
('.messages { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: var(--sp-md);', '.messages { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 6px;'),
('.msg { max-width: 100%; border-radius: var(--radius-md); padding: var(--sp-md) var(--sp-lg); font-size: var(--fs-sm);', '.msg { max-width: 100%; border-radius: 10px; padding: 7px 8px; font-size: 9.5px;'),
('.composer { flex: 0 0 auto; padding: var(--sp-md);', '.composer { flex: 0 0 auto; padding: 7px;'),
('.quick { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--sp-sm); margin-bottom: var(--sp-md); }', '.quick { display: grid; grid-template-columns: repeat(2, 1fr); gap: 5px; margin-bottom: 7px; }'),
('.quick button { height: 32px;', '.quick button { height: 24px;'),
('.input-wrap { display: flex; gap: var(--sp-sm); align-items: flex-end; padding: var(--sp-sm); border-radius: var(--radius-lg);', '.input-wrap { display: flex; gap: 5px; align-items: flex-end; padding: 5px; border-radius: 13px;'),
('#promptInput { flex: 1; min-height: 44px; max-height: 120px;', '#promptInput { flex: 1; min-height: 32px; max-height: 92px;'),
('#sendBtn, #stopBtn { width: 40px; height: 40px;', '#sendBtn, #stopBtn { width: 30px; height: 30px;'),
]
for a,b in right_pairs:
    html = html.replace(a,b)
html = html.replace('.side-sheet { position: fixed; top: var(--top); right: var(--gutter); bottom: var(--bottom); width: var(--right); z-index: 70;', '.side-sheet { position: fixed; top: var(--top); right: var(--gutter); bottom: var(--bottom); width: var(--right); z-index: 95;')
html = html.replace('.sheet-card { height: 100%; padding: var(--sp-lg);', '.sheet-card { height: 100%; padding: 10px;')
html = html.replace('.sheet-card h2 { margin: 0 0 var(--sp-sm); font-size: var(--fs-lg);', '.sheet-card h2 { margin: 0 0 6px; font-size: 13px;')
html = html.replace('.field { display: flex; flex-direction: column; gap: var(--sp-sm); margin-top: var(--sp-lg); }', '.field { display: flex; flex-direction: column; gap: 5px; margin-top: 9px; }')
html = html.replace('.field input, .field select, .field textarea { width: 100%; border: 1px solid rgba(120,150,255,.16); border-radius: var(--radius-md); padding: var(--sp-md);', '.field input, .field select, .field textarea { width: 100%; border: 1px solid rgba(120,150,255,.16); border-radius: 10px; padding: 7px;')
popover_css = r'''

    /* === Settings Popover — anchored to top-right settings button === */
    .settings-popover {
      position: fixed; z-index: 220; display: none;
      width: min(226px, calc(100vw - 20px)); max-height: calc(100vh - 58px); overflow: auto;
      padding: 9px; border-radius: 16px;
      border: 1px solid rgba(255,255,255,.76);
      background: linear-gradient(145deg, rgba(255,255,255,.50), rgba(255,255,255,.20) 60%, rgba(231,242,255,.16));
      backdrop-filter: blur(26px) saturate(180%);
      box-shadow: 0 18px 54px rgba(50,80,150,.18), inset 0 1px 0 rgba(255,255,255,.82), inset 0 -1px 0 rgba(120,150,255,.10);
      transform-origin: top right; opacity: 0; pointer-events: none;
    }
    .settings-popover.visible { display: block; pointer-events: auto; animation: popoverIn .16s var(--ease) forwards; }
    .settings-popover.closing { display: block; pointer-events: none; animation: popoverOut .12s var(--ease) forwards; }
    .settings-popover::before { content:""; position:absolute; inset:1px; border-radius:15px; pointer-events:none; background: linear-gradient(180deg, rgba(255,255,255,.48), transparent 38%); }
    .settings-popover > * { position: relative; z-index: 1; }
    .popover-arrow { position:absolute; top:-6px; right:14px; width:12px; height:12px; transform: rotate(45deg); border-left:1px solid rgba(255,255,255,.72); border-top:1px solid rgba(255,255,255,.72); background: rgba(255,255,255,.44); backdrop-filter: var(--blur); }
    .popover-head { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:7px; }
    .popover-title { font-size:11px; font-weight:800; letter-spacing:-.03em; }
    .popover-close { width:22px; height:22px; border-radius:8px; background:rgba(255,255,255,.32); color:var(--muted); }
    .popover-close:hover { color:var(--ink); background:rgba(255,255,255,.54); }
    .popover-section { margin-top:8px; }
    .popover-section:first-of-type { margin-top:0; }
    .popover-label { color:var(--faint); text-transform:uppercase; letter-spacing:.09em; font-weight:800; font-size:8px; margin:0 0 5px 2px; }
    .settings-menu { display:grid; gap:4px; }
    .settings-item { width:100%; min-height:30px; display:grid; grid-template-columns:18px 1fr auto; align-items:center; gap:7px; padding:6px 7px; border-radius:11px; background:rgba(255,255,255,.28); border:1px solid rgba(255,255,255,.32); color:var(--ink); text-align:left; transition:transform .16s var(--ease-spring), background .16s, border-color .16s; }
    .settings-item:hover { transform:translateY(-1px); background:rgba(255,255,255,.48); border-color:rgba(255,255,255,.62); }
    .settings-item:active { transform:scale(.98); }
    .settings-item-name { font-size:9.5px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .settings-item-status { font-size:8px; color:var(--faint); white-space:nowrap; }
    .switch { width:26px; height:15px; border-radius:999px; padding:2px; background:rgba(30,42,70,.20); box-shadow:inset 0 1px 2px rgba(0,0,0,.08); }
    .switch::before { content:""; display:block; width:11px; height:11px; border-radius:50%; background:rgba(255,255,255,.9); box-shadow:0 1px 3px rgba(0,0,0,.16); transition:transform .16s var(--ease); }
    .settings-item.active .switch { background:linear-gradient(135deg, var(--aqua), var(--iris)); }
    .settings-item.active .switch::before { transform:translateX(11px); }
    .popover-fields { display:grid; gap:6px; }
    .popover-fields .field { margin-top:0; gap:3px; }
    .popover-fields .field label { font-size:8px; }
    .popover-fields .field input, .popover-fields .field select { height:26px; padding:0 7px; border-radius:9px; font-size:9px; background:rgba(255,255,255,.40); }
    .popover-actions { display:flex; justify-content:flex-end; gap:5px; margin-top:7px; }
    .popover-actions .primary, .popover-actions .secondary { padding:5px 9px; border-radius:9px; font-size:9px; }
    @keyframes popoverIn { 0%{ opacity:0; transform: translateY(-5px) scale(.96); } 100%{ opacity:1; transform: translateY(0) scale(1); } }
    @keyframes popoverOut { 0%{ opacity:1; transform: translateY(0) scale(1); } 100%{ opacity:0; transform: translateY(-5px) scale(.96); } }
'''
if 'settings-popover' not in html.split('::-webkit-scrollbar')[0]:
    html = html.replace('\n    ::-webkit-scrollbar {', popover_css + '\n    ::-webkit-scrollbar {')
old_toolbar = '''      <div class="tool-group">
        <button class="basics-btn" id="findBtn" title="페이지 내 검색 (Ctrl+F)"><svg class="ui-icon"><use href="#i-search"></use></svg></button>
        <button class="basics-btn" id="zoomInBtn" title="확대 (Ctrl++)"><svg class="ui-icon"><use href="#i-plus"></use></svg></button>
        <button class="basics-btn" id="zoomOutBtn" title="축소 (Ctrl+-)"><svg class="ui-icon"><use href="#i-minus"></use></svg></button>
        <button class="basics-btn" id="favoriteBtn" title="즐겨찾기 (Ctrl+D)"><svg class="ui-icon"><use href="#i-star"></use></svg></button>
        <button class="basics-btn" id="downloadsBtn" title="다운로드 (Ctrl+J)"><svg class="ui-icon"><use href="#i-download"></use></svg></button>
        <button class="basics-btn" id="historyBtn" title="방문기록 (Ctrl+H)"><svg class="ui-icon"><use href="#i-clock"></use></svg></button>
        <button class="basics-btn" id="printBtn" title="인쇄 (Ctrl+P)"><svg class="ui-icon"><use href="#i-print"></use></svg></button>
        <button class="basics-btn" id="readModeBtn" title="읽기 모드"><svg class="ui-icon"><use href="#i-book"></use></svg></button>
        <button class="basics-btn" id="darkModeBtn" title="사이트 다크모드"><svg class="ui-icon"><use href="#i-moon"></use></svg></button>
        <button class="basics-btn" id="cookieBtn" title="쿠키 동의 자동 닫기"><svg class="ui-icon"><use href="#i-cookie"></use></svg></button>
      </div>
      <button class="icon-btn" id="newTabTopBtn" title="새 탭"><svg class="ui-icon"><use href="#i-plus"></use></svg></button>
      <button class="icon-btn" id="settingsBtn" title="설정"><svg class="ui-icon"><use href="#i-settings"></use></svg></button>'''
new_toolbar = '''      <div class="tool-group">
        <button class="basics-btn" id="findBtn" title="페이지 내 검색 (Ctrl+F)"><svg class="ui-icon"><use href="#i-search"></use></svg></button>
        <button class="basics-btn" id="favoriteBtn" title="즐겨찾기 (Ctrl+D)"><svg class="ui-icon"><use href="#i-star"></use></svg></button>
      </div>
      <div class="top-actions">
        <button class="icon-btn" id="newTabTopBtn" title="새 탭"><svg class="ui-icon"><use href="#i-plus"></use></svg></button>
        <button class="icon-btn" id="settingsBtn" title="설정" aria-expanded="false" aria-controls="settingsPopover"><svg class="ui-icon"><use href="#i-settings"></use></svg></button>
      </div>'''
html = html.replace(old_toolbar, new_toolbar)
settings_old = re.search(r'\n  <div class="side-sheet" id="settingsModal">[\s\S]*?\n  </div></div>\n\n  <div class="side-sheet" id="memoryModal">', html)
if settings_old:
    settings_pop = '''
  <div class="settings-popover" id="settingsPopover" aria-hidden="true">
    <div class="popover-arrow"></div>
    <div class="popover-head"><div class="popover-title">Settings</div><button class="popover-close" id="settingsClose" title="닫기">×</button></div>
    <div class="popover-section"><div class="popover-label">빠른 기능</div><div class="settings-menu" id="settingsQuickList"></div></div>
    <div class="popover-section"><div class="popover-label">화면 설정</div><div class="settings-menu" id="settingsDisplayList"></div></div>
    <div class="popover-section"><div class="popover-label">브라우저 데이터</div><div class="settings-menu" id="settingsDataList"></div></div>
    <div class="popover-section"><div class="popover-label">AI 연결</div><div class="popover-fields">
      <div class="field"><label>Provider</label><select id="providerSelect"><option value="mock">Mock Provider</option><option value="openai-compatible">OpenAI-compatible</option></select></div>
      <div class="field"><label>Gateway URL</label><input id="gatewayInput" placeholder="https://.../v1" /></div>
      <div class="field"><label>API Key</label><input id="apiKeyInput" type="password" placeholder="저장된 키가 있으면 비워둬도 됩니다" /></div>
      <div class="field"><label>Model</label><input id="modelInput" placeholder="deepseek-v4-flash" /></div>
      <div class="field"><label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="autoApproveToggle" style="width:auto;height:auto" /> 자동 승인</label></div>
      <div class="popover-actions"><button class="secondary" id="settingsCancel">닫기</button><button class="primary" id="settingsSave">저장</button></div>
    </div></div>
  </div>

  <div class="side-sheet" id="memoryModal">'''
    html = html[:settings_old.start()] + settings_pop + html[settings_old.end():]

# === renderer.js ===
renderer = renderer.replace("bookmarks: [], tabGroups: [], collapsedGroups: new Set(), selectedMentions: [], favoritesExpanded: false,", "bookmarks: [], tabGroups: [], collapsedGroups: new Set(), selectedMentions: [], favoritesExpanded: false,\n  settingsPopoverOpen: false, readModeEnabled: false, darkModeEnabled: false,")
renderer = renderer.replace("  $('settingsBtn').addEventListener('click', openSettings);", "  SettingsPopover.init();\n  $('settingsBtn').addEventListener('click', (e) => { e.stopPropagation(); SettingsPopover.toggle(); });")
for line in [
"  $('zoomInBtn').addEventListener('click', () => window.hermes.browser.zoom('in'));\n",
"  $('zoomOutBtn').addEventListener('click', () => window.hermes.browser.zoom('out'));\n",
"  $('printBtn').addEventListener('click', () => window.hermes.browser.print());\n",
"  $('readModeBtn').addEventListener('click', () => window.hermes.browser.toggleReadMode());\n",
"  $('darkModeBtn').addEventListener('click', () => window.hermes.browser.toggleDarkMode());\n",
"  $('cookieBtn').addEventListener('click', async () => { const r = await window.hermes.browser.dismissCookieConsent(); log('cookie', r.dismissed ? `${r.dismissed}개 닫음` : '없음'); });\n",
"  $('downloadsBtn').addEventListener('click', openDownloads);\n",
"  $('historyBtn').addEventListener('click', openHistory);\n",
]:
    renderer = renderer.replace(line, '')
renderer = renderer.replace("  $('settingsCancel').addEventListener('click', () => hideSheet('settingsModal'));", "  $('settingsClose').addEventListener('click', () => SettingsPopover.close());\n  $('settingsCancel').addEventListener('click', () => SettingsPopover.close());")
renderer = renderer.replace("function handleGlobalShortcuts(e) {\n  if (!e.ctrlKey && !e.metaKey && e.key !== 'F12') return;", "function handleGlobalShortcuts(e) {\n  if (e.key === 'Escape') {\n    if (SettingsPopover.isOpen()) { e.preventDefault(); SettingsPopover.close(); return; }\n    hideFindBar();\n    return;\n  }\n  if (!e.ctrlKey && !e.metaKey && e.key !== 'F12') return;")
for line in [
"  if (key === '+' || key === '=') { e.preventDefault(); window.hermes.browser.zoom('in'); }\n",
"  if (key === '-') { e.preventDefault(); window.hermes.browser.zoom('out'); }\n",
"  if (key === '0') { e.preventDefault(); window.hermes.browser.zoom('reset'); }\n",
]:
    renderer = renderer.replace(line, '')
renderer = renderer.replace("  hideSheet('settingsModal');", "  SettingsPopover.close();")
renderer = renderer.replace("function openSettings() { showSheet('settingsModal'); loadSettings(); }", "function openSettings() { SettingsPopover.open(); }")
settings_component = r'''
// === Settings Popover Component ===
const SettingsPopover = (() => {
  let outsideCleanup = null;
  const menuConfig = [
    { group: 'settingsQuickList', key: 'print', icon: 'i-print', label: '인쇄', status: '현재 페이지', run: async () => { await window.hermes.browser.print(); log('print', 'called'); } },
    { group: 'settingsQuickList', key: 'downloads', icon: 'i-download', label: '다운로드', status: '목록 열기', run: async () => { close(); await openDownloads(); } },
    { group: 'settingsQuickList', key: 'read', icon: 'i-book', label: '읽기모드', status: () => state.readModeEnabled ? '활성' : '비활성', run: async () => { const r = await window.hermes.browser.toggleReadMode(); state.readModeEnabled = !!r?.enabled; render(); log('read-mode', state.readModeEnabled ? 'on' : 'off'); } },
    { group: 'settingsDisplayList', key: 'dark', icon: 'i-moon', label: '다크모드', kind: 'switch', status: () => state.darkModeEnabled ? 'ON' : 'OFF', run: async () => { const r = await window.hermes.browser.toggleDarkMode(); state.darkModeEnabled = !!r?.enabled; render(); log('dark-mode', state.darkModeEnabled ? 'on' : 'off'); } },
    { group: 'settingsDataList', key: 'history', icon: 'i-clock', label: '방문기록', status: '패널 열기', run: async () => { close(); await openHistory(); } },
  ];
  function init() { render(); position(); window.addEventListener('resize', position); }
  function icon(id) { return `<svg class="ui-icon"><use href="#${id}"></use></svg>`; }
  function render() {
    for (const group of ['settingsQuickList', 'settingsDisplayList', 'settingsDataList']) {
      const box = $(group); if (box) box.replaceChildren();
    }
    for (const item of menuConfig) {
      const box = $(item.group); if (!box) continue;
      const btn = document.createElement('button');
      btn.className = 'settings-item' + ((item.key === 'dark' && state.darkModeEnabled) || (item.key === 'read' && state.readModeEnabled) ? ' active' : '');
      btn.dataset.settingAction = item.key;
      const iconWrap = document.createElement('span'); iconWrap.innerHTML = icon(item.icon);
      const name = document.createElement('span'); name.className = 'settings-item-name'; name.textContent = item.label;
      const status = document.createElement('span'); status.className = 'settings-item-status';
      if (item.kind === 'switch') { const sw = document.createElement('span'); sw.className = 'switch'; status.appendChild(sw); }
      else status.textContent = typeof item.status === 'function' ? item.status() : (item.status || '');
      btn.append(iconWrap, name, status);
      btn.addEventListener('click', async (e) => { e.stopPropagation(); await item.run(); });
      box.appendChild(btn);
    }
  }
  function position() {
    const pop = $('settingsPopover'); const btn = $('settingsBtn');
    if (!pop || !btn) return;
    const r = btn.getBoundingClientRect();
    const margin = 10;
    const width = Math.min(226, window.innerWidth - margin * 2);
    pop.style.width = width + 'px';
    const left = Math.min(window.innerWidth - width - margin, Math.max(margin, r.right - width));
    let top = r.bottom + 8;
    const maxTop = Math.max(margin, window.innerHeight - margin - Math.min(pop.scrollHeight || 360, window.innerHeight - 58));
    top = Math.max(margin, Math.min(top, maxTop));
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }
  function bindOutside() {
    cleanupOutside();
    const onPointer = (e) => {
      const pop = $('settingsPopover'); const btn = $('settingsBtn');
      if (!pop || !state.settingsPopoverOpen) return;
      if (pop.contains(e.target) || btn?.contains(e.target)) return;
      close();
    };
    const onKey = (e) => { if (e.key === 'Escape' && state.settingsPopoverOpen) { e.preventDefault(); close(); } };
    setTimeout(() => document.addEventListener('pointerdown', onPointer, true), 0);
    document.addEventListener('keydown', onKey, true);
    outsideCleanup = () => { document.removeEventListener('pointerdown', onPointer, true); document.removeEventListener('keydown', onKey, true); };
  }
  function cleanupOutside() { if (outsideCleanup) { outsideCleanup(); outsideCleanup = null; } }
  async function open() {
    const pop = $('settingsPopover'); if (!pop) return;
    await loadSettings(); render(); position();
    pop.classList.remove('closing'); pop.classList.add('visible'); pop.setAttribute('aria-hidden', 'false');
    $('settingsBtn')?.setAttribute('aria-expanded', 'true');
    state.settingsPopoverOpen = true; bindOutside();
  }
  function close() {
    const pop = $('settingsPopover'); if (!pop || !state.settingsPopoverOpen) return;
    cleanupOutside(); state.settingsPopoverOpen = false; $('settingsBtn')?.setAttribute('aria-expanded', 'false');
    pop.classList.add('closing');
    pop.addEventListener('animationend', () => { pop.classList.remove('visible', 'closing'); pop.setAttribute('aria-hidden', 'true'); }, { once: true });
  }
  function toggle() { state.settingsPopoverOpen ? close() : open(); }
  function isOpen() { return state.settingsPopoverOpen; }
  return { init, render, open, close, toggle, position, isOpen, menuConfig };
})();

'''
if 'const SettingsPopover = (()' not in renderer:
    renderer = renderer.replace('// === UI Helpers ===\n', settings_component + '// === UI Helpers ===\n')
renderer = renderer.replace("async function openDownloads() {\n  showSheet('downloadsModal');", "async function openDownloads() {\n  SettingsPopover.close();\n  showSheet('downloadsModal');")
renderer = renderer.replace("async function openHistory() {\n  showSheet('historyModal');", "async function openHistory() {\n  SettingsPopover.close();\n  showSheet('historyModal');")
renderer = renderer.replace("Math.min(t.scrollHeight, 120)", "Math.min(t.scrollHeight, 92)")
renderer = renderer.replace('설정창(⚙)에서', '설정 팝오버에서')

# preload remove zoom
preload = preload.replace("    zoom: (direction) => ipcRenderer.invoke('browser:zoom', direction),\n", '')

# main update + zoom removal
main = main.replace("const UI = {\n  left: 156,\n  right: 340,\n  top: 88,\n  gutter: 16,\n  gap: 14,\n  bottom: 16,\n  frameInset: 10,\n  minBrowserWidth: 640,\n  minBrowserHeight: 440,\n};", "const UI = {\n  left: 112,\n  right: 228,\n  top: 58,\n  gutter: 10,\n  gap: 8,\n  bottom: 10,\n  frameInset: 8,\n  minBrowserWidth: 560,\n  minBrowserHeight: 380,\n};")
main = main.replace("    minWidth: 1120,\n    minHeight: 680,", "    minWidth: 920,\n    minHeight: 620,")
main = main.replace("        tab.view.setBorderRadius(28);", "        tab.view.setBorderRadius(22);")
main = main.replace("// === Browser basics: find-in-page, zoom, downloads, history, print ===", "// === Browser basics: find-in-page, downloads, history, print ===")
main = re.sub(r"ipcMain\.handle\('browser:zoom',[\s\S]*?\n\}\);\n", "", main, count=1)

# tests update
test = test.replace("assert(html.includes('--left: 156px'), 'left panel compact 156px');", "assert(html.includes('--left: 112px'), 'left panel compact 112px');")
test = test.replace("assert(html.includes('--right: 340px'), 'right panel 340px WIDER');", "assert(html.includes('--right: 228px'), 'right panel compact 228px');")
test = test.replace("assert(html.includes('readModeBtn'), 'reading mode button');", "assert(!html.includes('readModeBtn'), 'reading mode moved out of toolbar');")
test = test.replace("assert(html.includes('tool-group'), 'tool-group separated from address');", "assert(html.includes('tool-group'), 'tool-group separated from address');\nassert(html.includes('top-actions'), 'new tab/settings isolated no-drag action group');\nassert(html.includes('settings-popover'), 'settings must use anchored popover');\nassert(html.includes('settingsQuickList'), 'settings quick menu container');\nassert(html.includes('settingsDisplayList'), 'settings display menu container');\nassert(html.includes('settingsDataList'), 'settings data menu container');")
for a,b in {
"assert(renderer.includes('readModeBtn'), 'read mode binding');":"assert(renderer.includes('SettingsPopover'), 'settings popover component');",
"assert(renderer.includes('darkModeBtn'), 'dark mode binding');":"assert(renderer.includes('settingsDisplayList'), 'display settings binding');",
"assert(renderer.includes('cookieBtn'), 'cookie consent binding');":"assert(renderer.includes('menuConfig'), 'settings menu array config');",
"assert(html.includes('darkModeBtn'), 'dark mode button');":"assert(!html.includes('darkModeBtn'), 'dark mode moved into settings popover');",
"assert(html.includes('cookieBtn'), 'cookie button');":"assert(!html.includes('zoomInBtn') && !html.includes('zoomOutBtn'), 'zoom toolbar buttons removed');",
"assert(html.includes('side-sheet'), 'settings must use side sheet');":"assert(!html.includes('settingsModal'), 'settings side sheet removed');",
"assert(html.includes('zoomInBtn'), 'zoom in');":"assert(!html.includes('zoomInBtn') && !html.includes('zoomOutBtn'), 'zoom buttons removed');",
"assert(html.includes('downloadsBtn'), 'downloads');":"assert(!html.includes('downloadsBtn'), 'downloads moved to settings popover');",
"assert(html.includes('historyBtn'), 'history');":"assert(!html.includes('historyBtn'), 'history moved to settings popover');",
"assert(html.includes('printBtn'), 'print');":"assert(!html.includes('printBtn'), 'print moved to settings popover');",
"assert(preload.includes('zoom'), 'zoom');":"assert(!preload.includes('browser:zoom') && !preload.includes('zoom:'), 'custom zoom IPC removed');",
"assert(main.includes('setZoomFactor'), 'zoom');":"assert(!main.includes('browser:zoom') && !main.includes('setZoomFactor'), 'custom zoom handler removed');",
}.items():
    test = test.replace(a,b)
if "outsideCleanup" not in test:
    test = test.replace("assert(renderer.includes('handleGlobalShortcuts'), 'keyboard shortcuts');", "assert(renderer.includes('handleGlobalShortcuts'), 'keyboard shortcuts');\nassert(renderer.includes('SettingsPopover') && renderer.includes('outsideCleanup'), 'settings popover outside-click cleanup');\nassert(renderer.includes(\"e.key === 'Escape'\"), 'ESC closes popover');")

html_p.write_text(html, encoding='utf-8')
renderer_p.write_text(renderer, encoding='utf-8')
preload_p.write_text(preload, encoding='utf-8')
main_p.write_text(main, encoding='utf-8')
test_p.write_text(test, encoding='utf-8')

print('patched files')
print('html zoom ids', 'zoomInBtn' in html, 'zoomOutBtn' in html)
print('preload zoom', 'browser:zoom' in preload, 'zoom:' in preload)
print('main zoom', 'browser:zoom' in main, 'setZoomFactor' in main)
print('renderer zoom', 'zoomInBtn' in renderer, 'zoomOutBtn' in renderer, 'browser.zoom' in renderer)
print('settings popover', 'settings-popover' in html, 'SettingsPopover' in renderer)
print('tokens', '--left: 112px' in html, '--right: 228px' in html, 'top: 58' in main)
