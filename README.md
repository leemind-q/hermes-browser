# Hermes Browser V12

**AI-powered Electron browser with MCP-First architecture for engineers.**

> **Status (2026-07-11)**: V12 complete. **157 unit PASS + 46/46 eval + 49 MCP tools + 10 LLM providers + Cowork for engineers.** Real production-ready.

[![Tests](https://img.shields.io/badge/tests-157%20pass-success)]()
[![Tools](https://img.shields.io/badge/MCP%20tools-49-blue)]()
[![Providers](https://img.shields.io/badge/LLM%20providers-10-orange)]()

---

## 🎯 V12 Three Differentiators

### 1. **MCP-First Architecture**
Everything exposed as MCP tools (49 total). External AI agents (Claude, GPT, Hermes AI, etc.) can fully control the browser via HTTP bridge or stdio server.

```
Browser navigation, click, fill, autofill, search
Content extraction: page text, tables, forms, links, search results
File management: list, read, search, grep, stat (Cowork)
Network: search Naver, search DDG, extract via URL
Vision: prints PDF, downloads, find text in page
Multimedia: browse screenshots, capture form fields
```

### 2. **Local-First + BYOK**
Local LLM support + 10 cloud providers. **No provider lock-in.** BYOK (Bring Your Own Key) for all cloud providers.

| Provider | Type | Use case |
|---|---|---|
| mock | OpenAI-compat | Local mock (opencode-go proxy) |
| LM Studio | OpenAI-compat | Local inference (:1234) |
| Ollama | OpenAI-compat | Local inference (:11434) |
| OpenAI | OpenAI-compat | gpt-4o-mini default |
| Anthropic | Native `/v1/messages` | Claude 3.5 Haiku |
| Google | Native REST | Gemini 2.5 Flash |
| OpenRouter | OpenAI-compat | Aggregator |
| MiniMax | Anthropic-compat `/anthropic` | M3 |
| BrowserOS | OpenAI-compat | Local fork (:8765) |
| OpenAI-compatible | OpenAI-compat | Custom URL |

### 3. **Cowork for Engineers**
Files + browser + AI 통합. **BrowserOS Cowork의 강화 버전** — 회로 도메인 특화.

```
cowork_list    — list files by pattern
cowork_read    — read text (max 5MB, binary → metadata)
cowork_grep    — regex search across files (cross-platform)
cowork_search  — by name OR content pattern
cowork_stat    — metadata (size, mtime, mime)
```

**Default workspace**: `C:\Users\qqwer\Hermes-Workspace\`

---

## 📦 30-Second Quick Start

### Test & Run

```bash
cd /mnt/c/Users/qqwer/Desktop/Hermes/hermes-browser
npm test           # 157 unit + 46 eval PASS (~3 sec)
npm start          # Launch Electron (Miraecle window)
```

### Live Verification

Hermes Browser auto-starts **HTTP bridge on port 8780**. Connect from external AI agents:

```bash
TOKEN=$(curl -s http://127.0.0.1:8780/auth/token | jq -r .token)

# Call any of 49 tools
curl -X POST http://127.0.0.1:8780/mcp/tool \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"cowork_list","args":{"dir":"demo-circuits"}}'
```

### Use with Claude Code / Cursor / Cline

Add to `~/.claude.json` (std로 MCP 사용):

```json
{
  "mcpServers": {
    "hermes-browser": {
      "command": "node",
      "args": ["C:/Users/qqwer/Desktop/Hermes/hermes-browser/mcp-server/server.js"]
    }
  }
}
```

---

## 🏗️ Architecture (V12)

```
┌────────────────────────────────────────────────────────┐
│  Renderer (src/chrome.html)                            │
│  - Tabs, sidebar, chat UI, settings popover           │
│  - Light/dark theme (Space Grotesk + DM Sans)         │
│  - Spring motion (--ease-spring)                      │
└──────┬─────────────────────────────────────┬───────────┘
       │ IPC                                  │
       │                                      │
┌──────▼─────────────┐            ┌───────────▼──────────┐
│  Main Process      │            │  MCP Bridge          │
│  (main.js)         │◄──────────►│  (HTTP :8780)        │
│  - nativeTheme     │            │  49 tools exposed    │
│  - syncNativeTh..  │            │  localhost only      │
│  - Cowork attach   │            │  Token auth          │
└──────┬─────────────┘            └──────────────────────┘
       │
┌──────▼─────────────────────┐
│  Agent Service             │
│  (src/agent/index.js)      │
│  - Plan/Mode/Approval      │
│  - ReadingList/Workspace   │
│  - Session Recorder        │
│  - CredentialVault         │
│  - CoworkService (V12)     │
│  - Provider abstraction    │
│  - Scheduler               │
└────────────────────────────┘
```

### Key Files

| File | Purpose |
|---|---|
| `main.js` | Electron main, theme sync, IPC, MCP bridge attach |
| `src/chrome.html` | UI shell with glass + light/dark + spring motion |
| `src/agent/index.js` | AgentService (single API entry point) |
| `src/agent/cowork.js` | V12 Cowork: files + browser + AI integration |
| `src/mcp-bridge.js` | HTTP server exposing 49 tools on port 8780 |
| `tests/cowork.test.js` | 6 unit tests for cross-platform path handling |
| `tests/{agent,credentials,...}.test.js` | 157 unit tests total |
| `eval/runner.js` | 46 integration scenarios |

---

## 📊 V12 Features (Day 1-5)

### Day 1: OS Theme Sync
- `nativeTheme.themeSource = 'system'`
- OS 변경 시 chrome.html `data-theme="dark"` 자동 전환
- 검증: light 100% `#f5f5f7`, dark 100% `#121212`

### Day 2: BYOK + 10 LLM Providers
- Provider presets 자동 채우기 (URL/model)
- 3 endpoint 타입 dispatch (OpenAI-compat / Anthropic native / Google native)
- 라이브 검증: 모든 10개 provider endpoint 도달

### Day 3: MiniMax Endpoint Fix
- base_url = `https://api.minimax.io/anthropic`
- endpoint = `{base}/v1/messages`
- Header = `X-Api-Key` (capitalized)
- 검증: 401 "login fail: Please carry the API secret key" (endpoint OK)

### Day 4: Cowork + 49 Tools + UI Spring Motion
- `src/agent/cowork.js` 240+ lines (V12 day 1)
- 5 public Cowork methods + 13 V12 tools (browser/web extensions)
- `--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1)` + 7 keyframes
- Spring-in/slide/sidebar/chat/pulse/focus animations

### Day 5: Cross-Platform Path Fix + 회로 Demo
- `_safePath` cross-platform (Windows path → WSL → `/mnt/...`)
- Electron path 모듈 (Windows mode) 작동
- BD69730FV 회로 demo (BOM 18 parts, Gerber, datasheet)
- 5/5 cowork e2e 통과

---

## 🛠️ Build & Verification

```bash
# Run all tests
npm test

# Quick unit-only run
node tests/agent.test.js
node tests/cowork.test.js

# Eval scenarios (46 total)
node eval/runner.js

# Live MCP call examples
curl -s http://127.0.0.1:8780/mcp/tools | jq '.tools | length'

# Open live window
npm start
```

---

## 📜 License

AGPL-3.0 (no BrowserOS code copy, safeStorage-based credential vault)

---

## 🎨 Design Choices

- **Light theme**: `#f5f5f7` background, white cards + box-shadow, gold `#fbbf24` accent
- **Dark theme**: `#0f0f1e` background, glass black 0.72 + blur 24px
- **Fonts**: Space Grotesk + DM Sans
- **Spring motion**: tagu requested "쫀득한" easing — `cubic-bezier(0.34, 1.56, 0.64, 1)`
- **Glass**: `backdrop-filter: blur(24px)` for panels/popovers

---

## 🤝 Acknowledgements

Inspired by [browserOS-ai](https://github.com/browseros-ai/BrowserOS) (AGPL-3) for the MCP-first + cowork architecture. **Safe fork** — no code copied, all implementation original.
