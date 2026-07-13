# V39 Markup Recovery — Final Report

## Commit hash
- main: 72b7fec6120ed2587769b3480b3b4a8b3f29cdc6 (docs sync)
- main: 5f34bd539c7e498e4e398270c27a1370ec555e5d (V39 main fix)

## Files changed
- main.js: 17 lines (moved maximize handler from top-level into createWindow)
- src/chrome.html: 159 lines (workspaceCardTrigger + popover + CSS + 5번역)
- src/preload.js: 1 line (restored from diagnostic)
- src/renderer.js: 145 lines (removed force-hide block, added try/catch IPC fallback)

## Root causes (not guesses)
1. **main.js:1284 module-load crash**: `mainWindow.on('maximize')` ran BEFORE mainWindow was assigned at L185. Uncaught TypeError blocked ALL 91 ipcMain.handle() registrations.
2. **Force-hide workspaceCardTrigger**: V39 polish had `trigger.style.setProperty('display','none','important')` — removed.
3. **V18 workspaceSwitcher duplicate**: Old sidebar-footer block had wsCurrentName="Default" — hidden via inline hidden + display:none.

## Verification (DOM measurements)
- appChildCount: 12 (all panels parent=app)
- workspaceCardTrigger: display=flex, w=134, h=48, visible=true
- workspaceSwitcherPopover: styleDisplay=none, aria-hidden=true
- workspaceSwitcher (V18 legacy): display=none, w=0
- visibleDefaultCount: 1 (exactly one "Default" visible)
- IPC toggleLeftPanel: success (returns false=collapsed)
- Console errors: 0

## Screenshots
10 captured with v39r-2026071309495-* prefix at 1440/1280/1100/1024.

## Pages deployment
- Workflow: Update Pages with V14/V15/V20 content
- Status: success
- URL: https://leemind-q.github.io/hermes-browser/
- Note: Pages deploys docs/ only. V39 chrome.html (src/) is used by WSL Electron, not Pages.
