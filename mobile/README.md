# Hermes Mobile · Companion

Phone-side control for your Desktop Hermes Browser via MCP Bridge.

## Install
1. Visit desktop URL (host or LAN IP) on phone
2. Or run `python3 -m http.server 8000` in this dir and visit from phone on same WiFi
3. Tap Share → "Add to Home Screen"

## Usage
- Set bridge URL (e.g., `http://10.0.2.2:8780` for emulator, or your desktop LAN IP)
- Paste token (get from Hermes Browser DevTools)
- Tap quick actions or type a prompt

## Limitations
- Browser-only ops (tabs, capture) require phone-companion-plugin in Desktop Hermes
- Storage localStorage only (cleared on uninstall)
- Token stored in plain localStorage (PWA only — not exposed to websites)

## File structure
```
mobile/
  index.html     — single-page PWA app
  manifest.json  — installable + theme color
  sw.js          — offline service worker
```
