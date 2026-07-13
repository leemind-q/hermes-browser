# V41 Architecture Cleanup — Component Documentation

## File Structure (V41)

```
src/
├── chrome.html     259.9 KB  (CSS + HTML)
├── renderer.js     212.5 KB  (JS)
├── preload.js       7.7 KB  (IPC bridge)
└── (renderer/)      [modular split deferred to V42+]

main.js             81.0 KB  (Electron main process)
```

## CSS Components

### Layout Containers (3-row Grid)
- `.app-frame` (34px row 1) — window controls + brand
- `.topbar` (44px row 2) — nav + address
- `#leftPanel` (168px col 1) — sidebar navigation
- `.browser-frame` (1fr col 2) — webview area
- `#rightPanel` (248px col 3) — AI panel
- `#statusBar` (26px row 4) — dev status info

### Interactive Components
- `.workspace-tag` — category filter chips (24px, 6px radius, 11px)
- `.ai-seg-btn` — AI mode buttons (28px, 6px radius, 11px 600)
- `.ai-input-wrap` — textarea container (8px radius, 12px)
- `#sendBtn` — send button (36px square, 8px radius, 16px)
- `#planShowMore` — plan toggle (27px, 6px radius, 11px)

### States
- `:focus-visible` — 2px gold outline, offset 2px
- `:hover` — `rgba(0,0,0,0.04)` background
- `:active` — gold accent

## JS Components

### Managers (V22-V25, all initialized in DOMContentLoaded)
- V22.1: Welcome + USP + QuickBar + Menu (DEAD-CODE candidates)
- V22.2: ContextMenu (right-click)
- V23.1: Settings panel + History + Downloads + Chrome pages
- V23.3: Toast notifications
- V23.5: Memories + Skills + TabGroups + Spaces + AISearch
- V24: ATC, Boosts, Easel, LiveFolders, MorningBrief, Pause, InstantLinks, Synthesis, Decks
- V25: AIOmnibox, TabSearch, WebClipper, BetterHistory, Notes, VoiceMode

### Core Systems
- WorkspaceCardTrigger + Popover toggle (V39)
- Textarea autosize (V38)
- Plan toggle (V38)
- 1024 Overlay viewport fit (V38)
- Settings popover (SettingsPopover.open/close/init/toggle)
- IPC bridge (preload.js exposes window.hermes.*)

## Removed in V41

### Dead Code
- `escapeHtml()` function (renderer.js L2306, 137 bytes) — 0 callers
  - Removed: 2026-07-13 V41
  - Reason: defined but never called
  - Verification: 0 occurrences in renderer.js after removal
  - JS syntax check: PASS

### transition: all Replacements (5 of 24)
- `.tabItem, .tab` → specific (bg, border, color, transform)
- `.cmdk-item` → specific (bg, color)
- `.v23-pill` → specific (bg, border, color)
- `.v23-llm-card` → specific (bg, border, transform)
- `.v23-memory-item` → specific (bg, border)

Remaining 19 transition: all (V42 candidates):
- .toolbarBtn, .searchInput, .ai-mode-btn, .ai-seg-btn, .save-toast
- .v22-tile, .v22-menu, .v22-quickbar, .v22-qb-action, .v22-usp-badge
- .v23-page-close, .v23-page-nav-item, .v23-color-swatch, .v23-space-pill, .v23-skill-item
- .v23-toast, .v24-easel-item/.v24-folder-item, .v18-sidebar-tab, .v18-item, .v23-page-card

## CSS Architecture Audit

### Dead CSS Classes
- Strict check (HTML class + JS querySelector + CSS compound): **0 dead**
- 186 candidates initially flagged → all confirmed used (CSS compound selectors)

### Font Scale (5 distinct)
11px (43), 12px (37), 13px (22), 14px (12), 16px (10)

### Border-radius Scale (6 distinct)
4px (27), 6px (12+9+8=29), 8px (26), 10px/var(--r-sm) (21), 14px/var(--r-md) (15), 50%/pill (31+9)

## Memory Leak Audit

### Event Listeners
- addEventListener: 145 total
- removeEventListener: 3
- window.addEventListener: 4 (resize x3, DOMContentLoaded)
- document.addEventListener: 27

### Observers
- ResizeObserver: 3 (textarea, ai-empty, chat)
- MutationObserver: 3 (plan visibility, ai auto-expand, empty state)
- IntersectionObserver: 0
- .disconnect(): 1, .unobserve(): 0

**Verdict**: SPA architecture = no navigation = leaks bounded to page lifetime. Hot-reload risk low.

## Performance Metrics

| Metric | Value |
|---|---|
| DOM nodes | 908 |
| CSS rules | 251 |
| Stylesheets | 3 |
| Layout thrash (100 iter) | 0.70ms |
| Inline onClick | 57 |
| loadComplete | 1753ms |
| domReady | 1673ms |
| Console errors | 0 |
| Layout shift | 0 |

## Windows DPI QA

| DPR | Layout integrity |
|---|---|
| 100% | ✓ 168/1000/248 grid |
| 125% | ✓ identical |
| 150% | ✓ identical |
| 200% | ✓ identical |

## Keyboard Shortcuts (19 unique keys)

Escape, Enter, ArrowUp/Down, Tab, F12, /, k, l, s, A, +, -, =, ?, ,, 0
- 22 keydown handlers
- 37 preventDefault (no browser default conflicts)
- 11 stopPropagation

## Technical Debt Reduced

| Category | V40 | V41 | Delta |
|---|---|---|---|
| Dead functions | 0 | 1 removed (-137 bytes) | -1 |
| transition: all | 24 | 19 | -5 |
| Dead CSS classes | 0 (strict) | 0 (strict) | 0 |
| Total removed bytes | - | -137 (renderer) | -137 |
