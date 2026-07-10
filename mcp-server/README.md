# Hermes Browser MCP Server

Hermes Browser의 agent 기능을 **Model Context Protocol (MCP)** 로 외부 AI 에이전트에 노출하는 서버.

## 왜 이게 필요한가

기존 AI 브라우저(Aside/Atlas/Dia)는 자기들 LLM에만 종속. **Hermes Browser는 외부 AI 에이전트의 두뇌로 작동**할 수 있어:

```
┌─────────────────┐
│  Claude Code    │──┐
│  Cursor         │──┤
│  Cline          │──┼── MCP (stdio/JSON-RPC) ──▶ Hermes Browser Agent
│  Custom Agent   │──┘                          (WebContentsView + 17 tools)
└─────────────────┘
```

Aside/Atlas는 못 하는 각도 → 우리 차별점.

## 설치

이미 `npm install @modelcontextprotocol/sdk` 완료 (2026-07-10).

## 사용법

### 1) Claude Code에 등록

`~/.claude/mcp.json` (또는 Claude Code 설정)에 추가:

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

### 2) Cursor에 등록

Cursor 설정 → MCP → "+ Add new MCP server" → Command: `node`, Args: `["C:/Users/qqwer/Desktop/Hermes/hermes-browser/mcp-server/server.js"]`

### 3) 수동 테스트 (PoC)

```bash
cd /mnt/c/Users/qqwer/Desktop/Hermes/hermes-browser
node tests/mcp-server.test.js
# Expected: PASSED: 15  FAILED: 0
```

## 노출되는 17개 tool

| Tool | 설명 |
|------|------|
| `browser_navigate` | URL 또는 검색어로 이동 (URL 아니면 Google 검색) |
| `browser_search` | google/naver/bing 검색 |
| `browser_click` | 요소 클릭 (selector / ref / text) |
| `browser_fill` | 입력 필드 채우기 |
| `browser_get_visible_text` | 페이지 본문 텍스트 추출 |
| `browser_inspect_page` | 구조화된 페이지 컨텍스트 (links/controls/loginRequired/...) |
| `browser_extract_search_results` | 검색 결과 링크 추출 |
| `browser_read_page` | 페이지 메인 텍스트/표/날짜/작성자 추출 |
| `browser_open_tab` | 새 탭 열기 |
| `browser_switch_tab` | 활성 탭 전환 |
| `browser_close_tab` | 탭 닫기 |
| `browser_get_tabs` | 모든 탭 목록 |
| `browser_take_screenshot` | 활성 탭 스크린샷 (base64 PNG) |
| `browser_scroll` | 스크롤 |
| `browser_check_injection` | 프롬프트 인젝션 패턴 검사 |
| `browser_get_mode` | 현재 agent 모드 조회 |
| `browser_set_mode` | agent 모드 전환 (ask/assist/agent/auto) |

## 아키텍처

```
src/agent/                 ← 순수 agent 로직 (Electron-free)
  ├─ mode.js               ← MODE_PERMISSIONS, ACTION_RISK, ModeManager
  ├─ safety.js             ← INJECTION_PATTERNS, detectInjection, redactText, maskSecrets
  ├─ plan.js               ← createStructuredAction, PlanState
  ├─ approval.js           ← ApprovalManager (60s timeout, autoApprove)
  ├─ persistence.js        ← PersistenceStore (skills, workspaces, session memory, action log)
  ├─ extraction.js         ← extractPageContext, extractSearchResults, readPageContent
  ├─ actions.js            ← clickElement, fillElement, findElementByRef/Text
  └─ index.js              ← AgentService (의존성 주입 받아 통합)

mcp-server/server.js       ← MCP 프로토콜 → AgentService bridge
  ├─ 17개 tool 정의 (ListToolsRequestSchema 응답)
  ├─ dispatchTool: tool name → AgentService method
  └─ StdioServerTransport (Claude Code, Cursor 표준)

main.js (Electron)         ← AgentService 인스턴스화 + IPC 30+개 delegate
```

## PoC vs Production

**현재 (PoC)**: in-process — Electron 없이 AgentService를 직접 호출. 테스트 가능.

**Production**: TCP socket 또는 WebSocket으로 실제 Electron 앱에 연결. mcp-server/server.js의 `makeInProcessDeps()`만 bridge로 교체하면 됨.

## 테스트

```bash
# 1) 단위 테스트 (Electron 없이 agent 로직 검증)
node tests/agent.test.js
# Expected: PASSED: 18  FAILED: 0

# 2) MCP 통합 테스트 (stdio JSON-RPC)
node tests/mcp-server.test.js
# Expected: PASSED: 15  FAILED: 0

# 3) Smoke test (file-level)
node tests/smoke.test.js
# Expected: smoke ok
```

## 의존성

- `@modelcontextprotocol/sdk@^1.29.0` (npm install로 설치됨)
- 표준 Node.js stdio/JSON-RPC (외부 의존 없음)

## 참고

- BrowserOS (browseros-ai/BrowserOS) — 영감을 받은 레퍼런스. 우리는 AGPL 코드를 빌려오지 않고 아키텍처만 차용.
- MCP 스펙: https://modelcontextprotocol.io