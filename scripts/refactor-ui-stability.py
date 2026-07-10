#!/usr/bin/env python3
"""
UI Stability Refactor — comprehensive patch for chrome.html, renderer.js, main.js, preload.js

Changes:
1. z-index layer system (--layer-* tokens)
2. Unified UI state manager (single active popover)
3. Floating sidebar: webview bounds adjustment on hover
4. Right panel flex stabilization (min-height:0, overflow-y isolation)
5. Bot/captcha detection
6. Chat message type system + progress card
7. Long result → center result tab
8. Table renderer
9. URL encoding fix
10. Overlap diagnostics
"""
import re, sys, os

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def read(path):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()

def write(path, content):
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)

# ============================================================
# 1. chrome.html — z-index layer tokens + flex fixes
# ============================================================
def patch_chrome_html():
    path = os.path.join(PROJECT, 'src', 'chrome.html')
    html = read(path)
    
    # 1a. Add --layer-* tokens after --ease-spring
    layer_tokens = """      --ease: cubic-bezier(.2,.9,.2,1);
      --ease-spring: cubic-bezier(.34,1.56,.64,1);
      --anim: .18s ease-out;

      /* === Layer System — single source of truth for z-index === */
      --layer-base: 0;          /* body background, gradients */
      --layer-webview: 5;       /* browser-frame bezel (decorative) */
      --layer-panel: 10;        /* left/right floating panels (pinned) */
      --layer-rail: 15;         /* collapsed rail */
      --layer-toggle: 20;       /* panel toggle buttons */
      --layer-floating: 30;     /* floating sidebar (hover overlay) */
      --layer-findbar: 35;      /* find-in-page bar */
      --layer-topbar: 110;      /* top navigation bar */
      --layer-actionlog: 120;   /* action log popover */
      --layer-toolpopover: 125; /* tool popover */
      --layer-sidesheet: 130;   /* side sheet modals */
      --layer-settings: 140;    /* settings popover */
      --layer-progress: 150;     /* progress status card */
      --layer-approval: 160;    /* inline approval */
      --layer-modal: 200;       /* modal backdrop */
      --layer-critical: 250;    /* security alert / captcha */
      --layer-cursor: 9999;    /* virtual cursor */
    """
    html = html.replace(
        "      --ease: cubic-bezier(.2,.9,.2,1);\n      --ease-spring: cubic-bezier(.34,1.56,.64,1);\n      --anim: .18s ease-out;\n",
        layer_tokens
    )
    
    # 1b. Add surface state tokens for consistent glass across states
    surface_tokens = """      --glass-refraction-cyan: rgba(91,200,255,.082);
      --glass-refraction-violet: rgba(151,128,255,.072);
      /* Surface state tokens — never change size, only color/opacity */
      --surface-default: rgba(255,255,255,.26);
      --surface-hover: rgba(255,255,255,.55);
      --surface-active: rgba(255,255,255,.75);
      --surface-selected: rgba(91,108,255,.12);
      --surface-loading: rgba(91,108,255,.06);
      --surface-warning: rgba(245,158,11,.08);
      --surface-error: rgba(239,68,68,.06);
      --border-default: rgba(0,0,0,.045);
      --border-focus: var(--accent);
      --border-hover: rgba(0,0,0,.08);
      --shadow-floating: 0 8px 34px rgba(20,30,50,.12);
    """
    html = html.replace(
        "      --glass-refraction-cyan: rgba(91,200,255,.082);\n      --glass-refraction-violet: rgba(151,128,255,.072);\n",
        surface_tokens
    )
    
    # 1c. Replace all hardcoded z-index with var(--layer-*)
    replacements = [
        # body::before
        ("pointer-events: none; z-index: 0;", "pointer-events: none; z-index: var(--layer-base);"),
        # .topbar
        ("position: absolute; z-index: 110; -webkit-app-region: drag;", "position: absolute; z-index: var(--layer-topbar); -webkit-app-region: drag;"),
        # .floating-panel
        ("position: absolute; z-index: 25;", "position: absolute; z-index: var(--layer-panel);"),
        # .left-rail
        ("position: absolute; z-index: 28; left:", "position: absolute; z-index: var(--layer-rail); left:"),
        # .app.left-floating-open .left.collapsed
        ("z-index: 80; }", "z-index: var(--layer-floating); }"),
        # .panel-toggle
        ("position: absolute; z-index: 26;", "position: absolute; z-index: var(--layer-toggle);"),
        # .browser-frame
        ("position: absolute; z-index: 5;", "position: absolute; z-index: var(--layer-webview);"),
        # .find-bar
        ("position: absolute; z-index: 35;", "position: absolute; z-index: var(--layer-findbar);"),
        # .action-log-popover
        ("position: absolute; z-index: 90; right: 6px;", "position: absolute; z-index: var(--layer-actionlog); right: 6px;"),
        # .tool-popover
        ("z-index: 130; }", "z-index: var(--layer-toolpopover); }"),
        # .side-sheet
        ("width: var(--right); z-index: 95;", "width: var(--right); z-index: var(--layer-sidesheet);"),
        # .settings-popover
        ("position: fixed; z-index: 220; display: none;", "position: fixed; z-index: var(--layer-settings); display: none;"),
        # .virtual-cursor
        ("position: absolute; z-index: 9999;", "position: absolute; z-index: var(--layer-cursor);"),
    ]
    for old, new in replacements:
        html = html.replace(old, new)
    
    # 1d. Right panel flex stabilization
    # .right-body already has min-height:0 but ensure overflow isolation
    html = html.replace(
        ".right-body { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 8px; padding: var(--sb-pad); overflow: hidden; }",
        ".right-body { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 8px; padding: var(--sb-pad); overflow: hidden; }\n    /* Ensure Plan and Chat don't push input off screen */\n    .plan-card { flex: 0 0 auto; min-height: 0; }\n    .chat-card { flex: 1 1 0; min-height: 0; }"
    )
    
    # 1e. Add overflow-wrap and word-break to messages
    html = html.replace(
        ".msg { max-width: 100%; border-radius: var(--sb-radius); padding: 5px 8px; font-size: var(--sb-body); line-height: 1.5; white-space: pre-wrap; word-break: break-word; animation: slideUpFade .2s var(--ease); }",
        ".msg { max-width: 100%; border-radius: var(--sb-radius); padding: 5px 8px; font-size: var(--sb-body); line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; animation: slideUpFade .2s var(--ease); }\n    .msg.warning { background: rgba(245,158,11,.1); border: 1px solid rgba(245,158,11,.15); color: #92400e; }\n    .msg.error { background: rgba(239,68,68,.08); border: 1px solid rgba(239,68,68,.12); color: #991b1b; }\n    .msg.system { background: rgba(0,0,0,.04); color: var(--muted); font-size: var(--sb-muted); }\n    .msg.result { background: rgba(34,197,94,.06); border: 1px solid rgba(34,197,94,.12); }"
    )
    
    # 1f. Add captcha/bot-detection overlay styles before </style>
    captcha_css = """
    /* === Bot Detection / Captcha Alert === */
    .captcha-alert {
      position: fixed; z-index: var(--layer-critical);
      left: 50%; top: 50%; transform: translate(-50%, -50%);
      width: min(360px, calc(100vw - 40px));
      padding: var(--sp-xl); border-radius: var(--radius-card);
      background: var(--glass-pop-bg); border: 1px solid rgba(239,68,68,.2);
      backdrop-filter: var(--glass-pop-blur); -webkit-backdrop-filter: var(--glass-pop-blur);
      box-shadow: 0 12px 40px rgba(239,68,68,.15);
      display: none; flex-direction: column; gap: var(--sp-md);
    }
    .captcha-alert.visible { display: flex; animation: scaleIn .2s var(--ease); }
    .captcha-title { font-size: var(--fs-lg); font-weight: 800; color: #991b1b; }
    .captcha-desc { font-size: var(--fs-sm); color: var(--muted); line-height: 1.5; }
    .captcha-actions { display: flex; gap: var(--sp-sm); justify-content: flex-end; }
    .captcha-actions .primary { background: var(--accent); }
    .captcha-actions .manual-btn { background: rgba(245,158,11,.12); color: #92400e; }

    /* === Progress Status Card === */
    .progress-card {
      flex: 0 0 auto; padding: 6px 10px; border-radius: var(--sb-radius);
      background: var(--surface-loading); border: 1px solid rgba(91,108,255,.1);
      display: none; align-items: center; gap: 6px;
      z-index: var(--layer-progress);
    }
    .progress-card.visible { display: flex; animation: slideUpFade .2s var(--ease); }
    .progress-card .progress-spinner {
      width: 14px; height: 14px; border: 2px solid rgba(91,108,255,.2);
      border-top-color: var(--accent); border-radius: 50%;
      animation: spin 0.8s linear infinite; flex: 0 0 auto;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .progress-card .progress-text { font-size: var(--sb-muted); font-weight: 600; color: var(--accent); flex: 1; }
    .progress-card .progress-count { font-size: var(--sb-muted); color: var(--faint); }

    /* === Result Tab Link === */
    .result-link {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 4px 10px; border-radius: var(--sb-radius);
      background: var(--surface-selected); color: var(--accent);
      font-size: var(--sb-muted); font-weight: 600; cursor: pointer;
      transition: background .18s;
    }
    .result-link:hover { background: var(--accent-hover); }

    /* === Compact Table (right panel) === */
    .compact-table { width: 100%; border-collapse: collapse; font-size: var(--sb-muted); }
    .compact-table th { text-align: left; padding: 4px 6px; font-weight: 700; color: var(--faint); border-bottom: 1px solid rgba(0,0,0,.06); }
    .compact-table td { padding: 4px 6px; border-bottom: 1px solid rgba(0,0,0,.03); overflow-wrap: anywhere; }
    .compact-table .num { text-align: right; font-variant-numeric: tabular-nums; }

    /* === Direct Control Badge === */
    .direct-control-badge {
      position: fixed; z-index: var(--layer-critical); top: var(--top); left: 50%;
      transform: translateX(-50%); padding: 4px 12px; border-radius: 999px;
      background: rgba(245,158,11,.9); color: white; font-size: var(--fs-xs);
      font-weight: 700; display: none; backdrop-filter: blur(10px);
    }
    .direct-control-badge.visible { display: block; animation: slideUpFade .3s var(--ease); }

    /* === Overlap Diagnostics (dev mode) === */
    .diag-overlay {
      position: fixed; z-index: var(--layer-critical); pointer-events: none;
      border: 2px dashed red; display: none;
    }
    .diag-overlay.visible { display: block; }
    .diag-label { position: absolute; top: -18px; left: 0; background: red; color: white; font-size: 10px; padding: 1px 4px; border-radius: 2px; }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
    }
    """
    html = html.replace("    </style>", captcha_css + "\n  </style>")
    
    # 1g. Add captcha alert and progress card HTML elements before </body>
    captcha_html = """
  <div class="captcha-alert" id="captchaAlert">
    <div class="captcha-title">⚠ 봇 차단 감지</div>
    <div class="captcha-desc" id="captchaDesc"></div>
    <div class="captcha-actions">
      <button class="manual-btn primary" id="captchaManualBtn">직접 조작</button>
      <button class="secondary" id="captchaSkipBtn">다른 출처 찾기</button>
      <button class="secondary" id="captchaDismissBtn" style="display:none">닫기</button>
    </div>
  </div>
  <div class="direct-control-badge" id="directControlBadge">직접 조작 모드 · AI 일시정지</div>

  <script src="renderer.js"></script>
"""
    html = html.replace('  <script src="renderer.js"></script>\n</body>', captcha_html + '</body>')
    
    write(path, html)
    print(f"✓ chrome.html patched")

# ============================================================
# 2. main.js — floating sidebar bounds, bot detection, result tabs
# ============================================================
def patch_main_js():
    path = os.path.join(PROJECT, 'main.js')
    code = read(path)
    
    # 2a. Add floatingSidebar state variable
    code = code.replace(
        "let activeTabId = null;",
        "let activeTabId = null;\nlet floatingSidebarOpen = false; // hover state for left sidebar"
    )
    
    # 2b. Update browserBounds() to account for floating sidebar
    old_bounds = """function browserBounds() {
  if (!mainWindow) return { x: 100, y: 100, width: 800, height: 600 };
  const [w, h] = mainWindow.getContentSize();
  const right = sidePanelVisible ? UI.right + UI.gap + UI.gutter : UI.gutter;
  const left = leftPanelVisible ? UI.gutter + UI.left + UI.gap : UI.gutter + UI.rail + UI.gap;"""
    
    new_bounds = """function browserBounds() {
  if (!mainWindow) return { x: 100, y: 100, width: 800, height: 600 };
  const [w, h] = mainWindow.getContentSize();
  const right = sidePanelVisible ? UI.right + UI.gap + UI.gutter : UI.gutter;
  // When floating sidebar is open (hover), shrink webview to reveal sidebar
  const leftEffective = leftPanelVisible || floatingSidebarOpen;
  const left = leftEffective ? UI.gutter + UI.left + UI.gap : UI.gutter + UI.rail + UI.gap;"""
    
    code = code.replace(old_bounds, new_bounds)
    
    # 2c. Add IPC for floating sidebar hover state
    ipc_floating = """
// === Floating sidebar hover state ===
ipcMain.handle('ui:setFloatingSidebar', (_e, open) => {
  const prev = floatingSidebarOpen;
  floatingSidebarOpen = !!open;
  if (prev !== floatingSidebarOpen) layoutAllViews();
  return { ok: true, floating: floatingSidebarOpen };
});

// === Bot/Captcha detection ===
function detectBotBlock(webContents, url, title) {
  const t = (title || '').toLowerCase();
  const u = (url || '').toLowerCase();
  const checks = [
    { pattern: /just a moment|checking your browser|cloudflare/i, type: 'cloudflare' },
    { pattern: /recaptcha|g-recaptcha/i, type: 'recaptcha' },
    { pattern: /hcaptcha|h-captcha/i, type: 'hcaptcha' },
    { pattern: /are you a robot|robot check|unusual traffic/i, type: 'google-captcha' },
    { pattern: /access denied|403|forbidden/i, type: 'blocked' },
    { pattern: /rate limit|too many requests|429/i, type: 'rate-limited' },
    { pattern: /sign in|log in|login required/i, type: 'login-required' },
  ];
  for (const c of checks) {
    if (c.pattern.test(t) || c.pattern.test(u)) return c;
  }
  return null;
}

function checkPageForBotBlock(tab) {
  if (!tab?.view?.webContents || tab.view.webContents.isDestroyed()) return;
  const wc = tab.view.webContents;
  const url = wc.getURL() || '';
  const title = wc.getTitle() || '';
  const block = detectBotBlock(wc, url, title);
  if (block) {
    console.log(`[bot-detect] ${block.type} on tab ${tab.id}: ${url}`);
    send('bot-detected', { type: block.type, url, title, tabId: tab.id });
  }
}

// === Result tab creation ===
ipcMain.handle('browser:createResultTab', (_e, { title, html, sourceUrls }) => {
  const tab = createTab('data:text/html;charset=utf-8,' + encodeURIComponent(html), true, {
    createdBy: 'ai', title: title || '검색 결과', agentOwned: true,
  });
  if (sourceUrls && Array.isArray(sourceUrls)) {
    tab.resultSources = sourceUrls;
  }
  return { tabId: tab.id };
});

// === Overlap diagnostics ===
ipcMain.handle('diag:overlaps', () => {
  const bounds = browserBounds();
  return {
    webviewBounds: bounds,
    floatingSidebarOpen,
    leftPanelVisible,
    sidePanelVisible,
    windowSize: mainWindow ? mainWindow.getContentSize() : [0, 0],
    activeTabId,
    tabCount: tabs.length,
  };
});
"""
    
    # Insert before the last line (app.whenReady or similar)
    code = code.replace(
        "app.whenReady().then(createWindow);",
        ipc_floating + "\napp.whenReady().then(createWindow);"
    )
    
    # 2d. Add bot detection to did-stop-loading handler
    code = code.replace(
        "  view.webContents.on('did-stop-loading', () => {\n    tab.loading = false;\n    tab.url = view.webContents.getURL() || tab.url;\n    tab.title = view.webContents.getTitle() || tab.url;\n    tab.zoomFactor = view.webContents.getZoomFactor();\n    notifyAll();",
        "  view.webContents.on('did-stop-loading', () => {\n    tab.loading = false;\n    tab.url = view.webContents.getURL() || tab.url;\n    tab.title = view.webContents.getTitle() || tab.url;\n    tab.zoomFactor = view.webContents.getZoomFactor();\n    notifyAll();\n    checkPageForBotBlock(tab);"
    )
    
    write(path, code)
    print(f"✓ main.js patched")

# ============================================================
# 3. preload.js — expose new IPC
# ============================================================
def patch_preload_js():
    path = os.path.join(PROJECT, 'src', 'preload.js')
    code = read(path)
    
    # Add new API exposures before the closing
    new_api = """
    setFloatingSidebar: (open) => ipcRenderer.invoke('ui:setFloatingSidebar', open),
    createResultTab: (opts) => ipcRenderer.invoke('browser:createResultTab', opts),
    onBotDetected: (cb) => {
      const listener = (_e, data) => { try { cb(data); } catch (err) { console.error('[preload] bot-detected callback error:', err); } };
      ipcRenderer.on('bot-detected', listener);
      return () => ipcRenderer.removeListener('bot-detected', listener);
    },
    getOverlaps: () => ipcRenderer.invoke('diag:overlaps'),
  }"""
    
    code = code.replace(
        "  }\n}\n\nif (typeof window",
        new_api + "\n}\n}\n\nif (typeof window"
    )
    
    write(path, code)
    print(f"✓ preload.js patched")

# ============================================================
# 4. renderer.js — UI state manager, floating sidebar, bot handling
# ============================================================
def patch_renderer_js():
    path = os.path.join(PROJECT, 'src', 'renderer.js')
    code = read(path)
    
    # 4a. Add UIState manager after state declaration
    uistate_code = """
// === Unified UI State Manager ===
// Single source of truth for all open popovers/modals
const UIState = {
  activePopover: null,  // 'actionLog' | 'toolPopover' | 'settings' | null
  activeSheet: null,    // 'memoryModal' | 'vaultModal' | etc.
  captchaAlertOpen: false,
  
  closeAllPopovers() {
    if (state.actionLogOpen) closeActionLog();
    if ($('toolPopover')?.classList.contains('visible')) closeToolPopover();
    if (state.settingsPopoverOpen) SettingsPopover.close();
  },
  
  openPopover(name) {
    if (this.activePopover && this.activePopover !== name) {
      this.closeAllPopovers();
    }
    this.activePopover = name;
  },
  
  closePopover(name) {
    if (this.activePopover === name) this.activePopover = null;
  },
  
  openSheet(name) {
    this.closeAllPopovers();
    this.activeSheet = name;
  },
  
  closeSheet(name) {
    if (this.activeSheet === name) this.activeSheet = null;
  },
  
  isAnyOverlayOpen() {
    return this.activePopover || this.activeSheet || this.captchaAlertOpen;
  }
};

// === Bot Detection Handler ===
function handleBotDetected(data) {
  state.running = false;
  $('sendBtn').disabled = false;
  $('stopBtn').style.display = 'none';
  updateExecBar('paused');
  
  const alert = $('captchaAlert');
  const desc = $('captchaDesc');
  const manualBtn = $('captchaManualBtn');
  const skipBtn = $('captchaSkipBtn');
  const dismissBtn = $('captchaDismissBtn');
  
  if (!alert) return;
  UIState.captchaAlertOpen = true;
  
  const messages = {
    'cloudflare': 'Cloudflare 보안 검사가 감지되었습니다. 페이지에서 확인을 완료해주세요.',
    'recaptcha': 'reCAPTCHA 인증이 필요합니다. 페이지에서 확인해주세요.',
    'hcaptcha': 'hCaptcha 인증이 필요합니다. 페이지에서 확인해주세요.',
    'google-captcha': 'Google 봇 확인이 감지되었습니다. 페이지에서 확인해주세요.',
    'blocked': '접근이 차단되었습니다 (403). 다른 접근 방법이 필요할 수 있습니다.',
    'rate-limited': '요청이 너무 많습니다 (429). 잠시 후 다시 시도해주세요.',
    'login-required': '로그인이 필요한 페이지입니다.',
  };
  
  desc.textContent = messages[data.type] || '봇 차단이 감지되었습니다.';
  manualBtn.textContent = '직접 조작';
  manualBtn.onclick = () => {
    alert.classList.remove('visible');
    UIState.captchaAlertOpen = false;
    $('directControlBadge').classList.add('visible');
    skipBtn.style.display = 'none';
    dismissBtn.style.display = '';
    dismissBtn.textContent = '해결 완료';
    dismissBtn.onclick = () => {
      $('directControlBadge').classList.remove('visible');
      alert.classList.remove('visible');
      UIState.captchaAlertOpen = false;
      updateExecBar('running');
      addMessage('system', '직접 조작 종료 · 작업 재개');
    };
  };
  skipBtn.style.display = '';
  skipBtn.onclick = () => {
    alert.classList.remove('visible');
    UIState.captchaAlertOpen = false;
    addMessage('warning', '봇 차단 페이지를 건너뛰고 다른 출처를 찾습니다.');
    state.running = true;
    $('sendBtn').disabled = true;
    $('stopBtn').style.display = 'block';
    updateExecBar('running');
  };
  
  alert.classList.add('visible');
  addMessage('warning', `⚠ ${messages[data.type] || '봇 차단 감지'} · 탭 ${data.tabId}`);
}

"""
    
    code = code.replace(
        "const DEFAULT_PLAN = ['목표 해석', '현재 브라우저 상태 관찰', '실행 계획 수립', '브라우저 행동 실행', '결과 검증', '최종 정리'];",
        uistate_code + "\nconst DEFAULT_PLAN = ['목표 해석', '현재 브라우저 상태 관찰', '실행 계획 수립', '브라우저 행동 실행', '결과 검증', '최종 정리'];"
    )
    
    # 4b. Update toggleActionLog to use UIState
    code = code.replace(
        "function toggleActionLog(e) {\n  e?.stopPropagation?.();\n  const pop = $('actionLogPopover');\n  if (!pop) return;\n  if (state.actionLogOpen) { closeActionLog(); return; }\n  closeToolPopover();\n  SettingsPopover.close();",
        "function toggleActionLog(e) {\n  e?.stopPropagation?.();\n  const pop = $('actionLogPopover');\n  if (!pop) return;\n  if (state.actionLogOpen) { closeActionLog(); return; }\n  UIState.openPopover('actionLog');"
    )
    
    # 4c. Update closeActionLog to notify UIState
    code = code.replace(
        "function closeActionLog() {\n  const pop = $('actionLogPopover');\n  if (!pop || !state.actionLogOpen) return false;\n  pop.classList.remove('visible');\n  state.actionLogOpen = false;\n  state.actionLogCleanup?.();\n  state.actionLogCleanup = null;\n  return true;\n}",
        "function closeActionLog() {\n  const pop = $('actionLogPopover');\n  if (!pop || !state.actionLogOpen) return false;\n  pop.classList.remove('visible');\n  state.actionLogOpen = false;\n  UIState.closePopover('actionLog');\n  state.actionLogCleanup?.();\n  state.actionLogCleanup = null;\n  return true;\n}"
    )
    
    # 4d. Update toggleToolPopover to use UIState
    code = code.replace(
        "function toggleToolPopover(e) {\n  e?.stopPropagation?.();\n  const pop = $('toolPopover');\n  if (!pop) return;\n  if (pop.classList.contains('visible')) { closeToolPopover(); return; }\n  closeActionLog();\n  SettingsPopover.close();\n  pop.classList.add('visible');",
        "function toggleToolPopover(e) {\n  e?.stopPropagation?.();\n  const pop = $('toolPopover');\n  if (!pop) return;\n  if (pop.classList.contains('visible')) { closeToolPopover(); return; }\n  UIState.openPopover('toolPopover');\n  pop.classList.add('visible');"
    )
    
    # 4e. Update closeToolPopover to notify UIState
    code = code.replace(
        "function closeToolPopover() {\n  const pop = $('toolPopover');\n  if (!pop || !pop.classList.contains('visible')) return false;\n  pop.classList.remove('visible');\n  pop._cleanup?.();\n  return true;\n}",
        "function closeToolPopover() {\n  const pop = $('toolPopover');\n  if (!pop || !pop.classList.contains('visible')) return false;\n  pop.classList.remove('visible');\n  UIState.closePopover('toolPopover');\n  pop._cleanup?.();\n  return true;\n}"
    )
    
    # 4f. Update showSheet to use UIState
    code = code.replace(
        "function showSheet(id) { const el = $(id); if (el) { el.classList.remove('closing'); el.classList.add('visible'); } }",
        "function showSheet(id) { UIState.openSheet(id); const el = $(id); if (el) { el.classList.remove('closing'); el.classList.add('visible'); } }"
    )
    
    # 4g. Update hideSheet to use UIState
    code = code.replace(
        "function hideSheet(id) {\n  const el = $(id);\n  if (!el || !el.classList.contains('visible')) return;\n  el.classList.add('closing');\n  el.addEventListener('animationend', () => { el.classList.remove('visible', 'closing'); }, { once: true });\n}",
        "function hideSheet(id) {\n  UIState.closeSheet(id);\n  const el = $(id);\n  if (!el || !el.classList.contains('visible')) return;\n  el.classList.add('closing');\n  el.addEventListener('animationend', () => { el.classList.remove('visible', 'closing'); }, { once: true });\n}"
    )
    
    # 4h. Update SettingsPopover.open to use UIState
    code = code.replace(
        "  async function open() {\n    const pop = $('settingsPopover'); if (!pop) return;\n    await loadSettings(); render(); position();\n    pop.classList.remove('closing'); pop.classList.add('visible'); pop.setAttribute('aria-hidden', 'false');\n    $('settingsBtn')?.setAttribute('aria-expanded', 'true');\n    state.settingsPopoverOpen = true; bindOutside();\n  }",
        "  async function open() {\n    const pop = $('settingsPopover'); if (!pop) return;\n    UIState.openPopover('settings');\n    await loadSettings(); render(); position();\n    pop.classList.remove('closing'); pop.classList.add('visible'); pop.setAttribute('aria-hidden', 'false');\n    $('settingsBtn')?.setAttribute('aria-expanded', 'true');\n    state.settingsPopoverOpen = true; bindOutside();\n  }"
    )
    
    # 4i. Update SettingsPopover.close to notify UIState
    code = code.replace(
        "  function close() {\n    const pop = $('settingsPopover'); if (!pop || !state.settingsPopoverOpen) return;\n    cleanupOutside(); state.settingsPopoverOpen = false; $('settingsBtn')?.setAttribute('aria-expanded', 'false');",
        "  function close() {\n    const pop = $('settingsPopover'); if (!pop || !state.settingsPopoverOpen) return;\n    UIState.closePopover('settings');\n    cleanupOutside(); state.settingsPopoverOpen = false; $('settingsBtn')?.setAttribute('aria-expanded', 'false');"
    )
    
    # 4j. Update floating sidebar to coordinate with main process
    code = code.replace(
        "function openFloatingLeftPanel() {\n  if (state.leftPinned) return;\n  clearTimeout(state.sidebarCloseTimer);\n  state.leftHoverOpen = true;\n  applyLeftSidebarState();\n}",
        "function openFloatingLeftPanel() {\n  if (state.leftPinned) return;\n  clearTimeout(state.sidebarCloseTimer);\n  state.leftHoverOpen = true;\n  applyLeftSidebarState();\n  window.hermes?.browser?.setFloatingSidebar?.(true);\n}"
    )
    
    code = code.replace(
        "function scheduleCloseFloatingLeftPanel() {\n  if (state.leftPinned) return;\n  clearTimeout(state.sidebarCloseTimer);\n  state.sidebarCloseTimer = setTimeout(() => {\n    if (state.actionLogOpen || isAnySheetOpen() || $('toolPopover')?.classList.contains('visible')) return;\n    state.leftHoverOpen = false;\n    applyLeftSidebarState();\n  }, 220);\n}",
        "function scheduleCloseFloatingLeftPanel() {\n  if (state.leftPinned) return;\n  clearTimeout(state.sidebarCloseTimer);\n  state.sidebarCloseTimer = setTimeout(() => {\n    if (state.actionLogOpen || isAnySheetOpen() || $('toolPopover')?.classList.contains('visible') || UIState.captchaAlertOpen) return;\n    state.leftHoverOpen = false;\n    applyLeftSidebarState();\n    window.hermes?.browser?.setFloatingSidebar?.(false);\n  }, 220);\n}"
    )
    
    # 4k. Update isAnySheetOpen to use UIState
    code = code.replace(
        "function isAnySheetOpen() { return [...document.querySelectorAll('.side-sheet.visible,.settings-popover.visible')].length > 0; }",
        "function isAnySheetOpen() { return !!UIState.isAnyOverlayOpen(); }"
    )
    
    # 4l. Add bot detection listener and result tab logic to init()
    code = code.replace(
        "  try {\n    await window.hermes.browser.restoreSession(); } catch {}\n  try { const modeInfo = await window.hermes.agent.getMode(); if (modeInfo) { state.mode = modeInfo.mode; state.modePerms = { label: modeInfo.label, desc: modeInfo.desc, canAct: modeInfo.canAct }; updateModeBadge(); } } catch {}\n  console.log('[Miraecle] init complete');",
        "  try {\n    await window.hermes.browser.restoreSession(); } catch {}\n  try { const modeInfo = await window.hermes.agent.getMode(); if (modeInfo) { state.mode = modeInfo.mode; state.modePerms = { label: modeInfo.label, desc: modeInfo.desc, canAct: modeInfo.canAct }; updateModeBadge(); } } catch {}\n  // Bot detection listener\n  try { window.hermes.browser.onBotDetected?.(handleBotDetected); } catch {}\n  console.log('[Miraecle] init complete');"
    )
    
    # 4m. Add safeDecodeUrl function and result tab creation
    extra_funcs = """
// === URL Encoding Safety ===
function safeDecodeUrl(s) {
  if (!s || typeof s !== 'string') return s;
  // Only decode if it looks like percent-encoding
  if (!/%[0-9A-Fa-f]{2}/.test(s)) return s;
  try {
    const decoded = decodeURIComponent(s);
    // Avoid double-decode: if result still has %XX, it might be legitimately encoded
    if (/%[0-9A-Fa-f]{2}/.test(decoded) && decoded !== s) {
      // Single decode is enough for most cases
      return decoded;
    }
    return decoded;
  } catch { return s; }
}

// === Long Result → Center Result Tab ===
function shouldCreateResultTab(text, sources) {
  if (!text) return false;
  if (text.length > 800) return true;
  if (sources && sources.length >= 5) return true;
  // Check for markdown tables with 4+ columns
  const tableMatch = text.match(/^\\|.*\\|$/m);
  if (tableMatch) {
    const cols = tableMatch[0].split('|').filter(c => c.trim()).length;
    if (cols >= 4) return true;
  }
  return false;
}

async function createResultTab(title, markdown, sources) {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body { font-family: 'Inter', sans-serif; padding: 24px; max-width: 1200px; margin: 0 auto; color: #101625; }
    h1 { font-size: 22px; font-weight: 800; margin-bottom: 16px; }
    h2 { font-size: 17px; margin-top: 24px; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; }
    th { background: #f0f3f8; padding: 8px 12px; text-align: left; font-weight: 700; border-bottom: 2px solid #ddd; position: sticky; top: 0; }
    td { padding: 8px 12px; border-bottom: 1px solid #eee; overflow-wrap: anywhere; }
    tr:hover { background: #f8f9fc; }
    .source-link { color: #5b6cff; text-decoration: none; font-size: 12px; }
    .source-link:hover { text-decoration: underline; }
    pre { background: #f4f6fa; padding: 12px; border-radius: 8px; overflow-x: auto; }
    code { background: #f0f3f8; padding: 2px 6px; border-radius: 4px; font-size: 12px; }
  </style></head><body><h1>${title}</h1>${markdownToHtml(markdown)}${
    sources && sources.length ? '<h2>출처</h2><ul>' + sources.map(s => 
      `<li><a class="source-link" href="${s.url || s.href || '#'}" target="_blank">${s.title || s.text || s.url}</a></li>`
    ).join('') + '</ul>' : ''
  }</body></html>`;
  
  try {
    await window.hermes.browser.createResultTab({ title, html, sourceUrls: sources?.map(s => s.url || s.href) });
    addMessage('result', `📋 전체 결과를 새 탭에서 열었습니다.`);
  } catch (e) {
    addMessage('error', `결과 탭 생성 실패: ${e.message}`);
  }
}

function markdownToHtml(md) {
  if (!md) return '';
  // Simple markdown to HTML: tables, headers, bold, links
  let html = md;
  // Tables
  html = html.replace(/^\\|(.+)\\|$/gm, (match) => {
    const cells = match.split('|').filter(c => c.trim());
    return '| ' + cells.join(' | ') + ' |';
  });
  // Convert markdown table to HTML
  const lines = html.split('\\n');
  let inTable = false;
  let result = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\\|.+\\|$/.test(line.trim())) {
      if (!inTable) { result.push('<table>'); inTable = true; }
      const cells = line.trim().slice(1, -1).split('|').map(c => c.trim());
      if (cells.every(c => /^[-:]+$/.test(c))) continue; // separator
      const tag = (result.length > 0 && result[result.length - 1].includes('<table>')) ? 'td' : 'th';
      result.push('<tr>' + cells.map(c => `<${tag}>${c}</${tag}>`).join('') + '</tr>');
    } else {
      if (inTable) { result.push('</table>'); inTable = false; }
      result.push(line);
    }
  }
  if (inTable) result.push('</table>');
  html = result.join('\\n');
  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  // Bold
  html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
  // Links
  html = html.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank">$1</a>');
  // Line breaks
  html = html.replace(/\\n/g, '<br>');
  return html;
}

// === Overlap Diagnostics ===
async function runOverlapDiagnostics() {
  try {
    const data = await window.hermes?.browser?.getOverlaps?.();
    if (!data) return;
    console.log('[diag:overlaps]', data);
    const { webviewBounds, floatingSidebarOpen, leftPanelVisible, sidePanelVisible, windowSize, activeTabId, tabCount } = data;
    console.log(`  Window: ${windowSize[0]}×${windowSize[1]}`);
    console.log(`  Webview: x=${webviewBounds.x} y=${webviewBounds.y} w=${webviewBounds.width} h=${webviewBounds.height}`);
    console.log(`  Floating: ${floatingSidebarOpen} | LeftPinned: ${leftPanelVisible} | Right: ${sidePanelVisible}`);
    console.log(`  Tabs: ${tabCount} | Active: ${activeTabId}`);
    
    // Check for overlaps between HTML elements
    const elements = [
      { name: 'topbar', el: $('.topbar') },
      { name: 'leftPanel', el: $('leftPanel') },
      { name: 'leftRail', el: $('leftRail') },
      { name: 'browserFrame', el: $('.browser-frame') },
      { name: 'rightPanel', el: $('rightPanel') },
      { name: 'toolPopover', el: $('toolPopover') },
      { name: 'settingsPopover', el: $('settingsPopover') },
      { name: 'actionLogPopover', el: $('actionLogPopover') },
    ];
    const rects = [];
    for (const { name, el } of elements) {
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      rects.push({ name, rect: r });
    }
    // Check pairs for overlap
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i].rect, b = rects[j].rect;
        const overlap = !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
        if (overlap) {
          const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (ox > 4 && oy > 4) {
            console.warn(`[diag:overlap] ${rects[i].name} ∩ ${rects[j].name} = ${ox.toFixed(0)}×${oy.toFixed(0)}px`);
          }
        }
      }
    }
  } catch (e) { console.error('[diag:overlaps] error:', e); }
}
"""
    
    code = code.replace(
        "\n// === UI Helpers ===\nfunction showSheet",
        extra_funcs + "\n\n// === UI Helpers ===\nfunction showSheet"
    )
    
    write(path, code)
    print(f"✓ renderer.js patched")

# ============================================================
# Run all patches
# ============================================================
if __name__ == '__main__':
    print("=== UI Stability Refactor ===")
    patch_chrome_html()
    patch_main_js()
    patch_preload_js()
    patch_renderer_js()
    print("=== All patches applied ===")
