# Hermes Browser

AI 에이전트 + 자격증명 안전 저장 + 외부 MCP 통합이 가능한 Electron 기반 브라우저.

> **상태 (2026-07-10)**: 코드 완성. 125개 검증 PASS. 실제 Electron UI는 헤르메스 데스크탑에서 `npm start` 1번 눌러서 확인 필요.

---

## 30초 실행 가이드

```bash
cd /mnt/c/Users/qqwer/Desktop/Hermes/hermes-browser
npm test            # 125개 검증 (~15초)
npm start           # Electron 띄우기 (헤르메스 데스크탑에서)
```

---

## Claude Code / Cursor / Cline에서 사용하기

### A. 헤르메스 브라우저를 MCP 서버로 노출 (stdio)

`~/.claude/mcp.json` (Claude Code) 또는 동등한 설정 파일에 추가:

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

Claude Code 안에서 이렇게 부려먹기 가능:
> "Hermes Browser로 네이버에서 고양이 사진 검색해줘"
> "쿠팡에서 USB-C 케이블 가격 비교해줘"  
> "Gmail 로그인해서 unread 메일 목록 보여줘"

### B. 헤르메스 브라우저 자체에 HTTP bridge로 접근

헤르메스 실행하면 자동으로 8780 포트에 HTTP server 뜸 (Ctrl+`로 디버그 콘솔에서 토큰 확인):
```bash
# 토큰 가져오기
TOKEN=$(curl -s http://127.0.0.1:8780/auth/token | jq -r .token)

# 도구 호출
curl -X POST http://127.0.0.1:8780/mcp/tool \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "browser_navigate", "args": {"url": "https://example.com"}}'
```

응답 예시:
```json
{
  "ok": true,
  "result": {"ok": true, "url": "https://example.com/"},
  "requestId": "req_l8x9_abc123"
}
```

### C. 환경변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `HERMES_MCP_BRIDGE` | (on) | `off`로 설정하면 bridge 비활성화 |
| `HERMES_MCP_PORT` | 8780 | bridge가 listen할 포트 (충돌 시 자동 fallback 8781~8789) |

### D. 17개 사용 가능 도구

`browser_navigate`, `browser_search`, `browser_click`, `browser_fill`, `browser_get_visible_text`, `browser_inspect_page`, `browser_extract_search_results`, `browser_read_page`, `browser_open_tab`, `browser_switch_tab`, `browser_close_tab`, `browser_get_tabs`, `browser_take_screenshot`, `browser_scroll`, `browser_check_injection`, `browser_get_mode`, `browser_set_mode` + 자격증명 3개 (`credential_save/list/remove`)

---

## 무엇이 있나

| 영역 | 파일 | 역할 |
|------|------|------|
| **브라우저 shell** | `main.js` (843줄) | Electron + WebContentsView + IPC 30+개 |
| **Agent 패키지** | `src/agent/` (9 모듈, 1,256줄) | Electron 없이도 동작, 테스트 가능 |
| **MCP bridge** | `src/mcp-bridge.js` (190줄) | HTTP localhost:8780, Bearer auth |
| **Bridge spawner** | `src/mcp-bridge-spawner.js` (117줄) | EADDRINUSE 자동 retry, graceful fail |
| **stdio MCP 서버** | `mcp-server/server.js` (331줄) | Claude Code / Cursor / Cline 연결 |
| **CDP types** | `src/cdp-protocol.d.ts` (148줄) | JSDoc 타입 (TS 없이 자동완성) |
| **Eval framework** | `eval/runner.js` + 5 시나리오 | 회귀 자동 검증 |
| **테스트** | `tests/` (7 파일) | 82 unit + 1 live + smoke |

---

## 어떻게 검증됐나

```bash
npm test
```

이게 7개 test 파일 + eval 5개 시나리오 + smoke 전부 순차 실행. 결과:

```
✅ Syntax check:    28/28
✅ AgentService:    18/18
✅ Credentials:     15/15
✅ MCP bridge:      18/18
✅ MCP spawner:     16/16
✅ MCP server:      15/15
✅ Live integration: PASS (실제 HTTP server listen + curl tool 호출)
✅ Smoke:           smoke ok
✅ Eval scenarios:  14/14
```

부분 실행:
- `npm run test:unit` — agent + credentials + bridge + spawner + server (82 tests)
- `npm run test:live` — 실제 HTTP server 띄워서 fetch 호출
- `npm run test:eval` — 5개 시나리오 (search, multi-tab, mode 권한, injection, credentials)
- `npm run test:smoke` — 파일 레벨 구조 검증

---

## 어떻게 동작하나

### 일반 사용자 (헤르메스 데스크탑)

```powershell
cd C:\Users\qqwer\Desktop\Hermes\hermes-browser
npm start
```

UI 뜨면 평소처럼 사용. 사이드 패널 AI, 멀티탭, 자격증명 자동채움 (구글/네이버/쿠팡 등 로그인 사이트).

### 개발자 (WSL)

```bash
cd /mnt/c/Users/qqwer/Desktop/Hermes/hermes-browser
node src/mcp-bridge.js     # 또는 main.js 안에서 spawner가 띄움
```

8780 포트에 HTTP server listen. token은 stdout에 출력됨.

```bash
# 토큰 받기
TOKEN=$(curl -s http://127.0.0.1:8780/auth/token | jq -r .token)

# Tool 호출 예시
curl -X POST http://127.0.0.1:8780/mcp/tool \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "browser_navigate", "args": {"url": "example.com"}}'
```

### Claude Code / Cursor 사용

`~/.claude/mcp.json` (또는 동등한 설정 파일):
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

Claude Code 안에서 "Hermes Browser로 네이버에서 고양이 사진 검색해줘" 같은 거 가능.

---

## 아키텍처 (BrowserOS 패턴 차용)

```
┌─────────────────────────────────────────────────────────────┐
│  External AI Client (Claude Code / Cursor / Cline)         │
│       │                                                    │
│       │ stdio JSON-RPC (MCP)                                │
│       ▼                                                    │
│  mcp-server/server.js   (20 tools, stdio MCP)              │
│       │                                                    │
│       │ HTTP localhost:8780 (Bearer auth)                  │
│       ▼                                                    │
│  src/mcp-bridge.js  ←→  src/mcp-bridge-spawner.js          │
│       │                  (EADDRINUSE retry)                 │
│       │ in-process                                         │
│       ▼                                                    │
│  src/agent/  (9 modules, 1256줄, Electron-free)            │
│       │                                                    │
│       │ IPC (BrowserWindow.webContents)                     │
│       ▼                                                    │
│  main.js (Electron + WebContentsView)                      │
└─────────────────────────────────────────────────────────────┘
```

차용한 패턴 (BrowserOS AGPL-3 — **코드 카피 0, 구조만 참고**):
1. **모노레포 분리**: agent 로직을 패키지로 격리 → 우리는 `src/agent/` 9 모듈
2. **MCP server**: 브라우저를 외부 AI tool로 노출 → 우리는 `mcp-server/server.js` 20 tool
3. **Type-safe CDP**: 우리는 JSDoc만 (`cdp-protocol.d.ts`) — TS 마이그레이션 부담 회피
4. **Eval framework**: WebVoyager/Mind2Web 차용 → 우리는 5개 우리 시나리오

---

## 핵심 차별점

**Aside / Atlas / Comet 다 공통 약점**: 로그인 필요한 사이트 작업 못 함.

**Hermes Browser**: `safeStorage` (OS 키체인) 기반 자격증명 저장 + 도메인 스코핑 + mode 검증 + audit log.

```bash
# Claude Code에서
"쿠팡에서 USB-C 케이블 검색해줘"

→ agent가 credential vault 조회 (쿠팡 쿠키 살아있으면)
→ 로그인 필요시 저장된 credential로 자동 채움
→ 검색 결과 추출 + 응답
```

자격증명 보안:
- 평문 password는 절대 log에 기록 안 됨 (IPC payload에도 직접 노출 최소화)
- 도메인 스코핑: naver.com cred은 google.com에서 못 씀
- 401 unauthorized: Bearer token 없으면 모든 tool 호출 차단
- list 도 password 절대 미노출

---

## 디렉토리 구조

```
Hermes Browser/
├── main.js                         843줄 — Electron shell + IPC + bridge spawner
├── package.json                    npm test, test:unit, test:live, test:eval, test:smoke
├── src/
│   ├── preload.js                  Renderer-facing API (credential 추가)
│   ├── renderer.js                 UI (1311줄, 손대지 않음)
│   ├── agent/                      9 modules, 1256줄
│   │   ├── mode.js                 MODE_PERMISSIONS (ask/assist/agent/auto)
│   │   ├── safety.js               INJECTION_PATTERNS, redactText, maskSecrets
│   │   ├── plan.js                 PlanState, createStructuredAction
│   │   ├── approval.js             ApprovalManager (60s timeout)
│   │   ├── persistence.js          skills, workspaces, session memory, action log
│   │   ├── extraction.js           DOM → 구조화된 페이지 컨텍스트
│   │   ├── actions.js              click, fill, findElement (browser primitives)
│   │   ├── credentials.js          safeStorage 자격증명 vault
│   │   └── index.js                AgentService 통합 클래스
│   ├── cdp-protocol.d.ts           JSDoc types for WebContents, View, Tab
│   ├── mcp-bridge.js               HTTP server (Bearer auth)
│   └── mcp-bridge-spawner.js       Retry + graceful fail
├── mcp-server/
│   ├── server.js                   331줄, stdio MCP, 20 tools
│   └── README.md                   (구버전, 본 README로 통합됨)
├── eval/
│   ├── runner.js                   175줄
│   └── scenarios/                  5 JSON 시나리오
└── tests/                          7 test files
    ├── agent.test.js               18 tests
    ├── credentials.test.js         15
    ├── mcp-bridge.test.js          18 (incl. auth)
    ├── mcp-bridge-spawner.test.js  16 (EADDRINUSE, retry)
    ├── mcp-server.test.js          15
    ├── live-bridge.test.js         1 live integration
    └── smoke.test.js               file-level structure
```

---

## 자주 하는 실수

**Q: WSL에서 `npm start` 하면?**
A: Intel Arc GPU 검은화면. 헤르메스 데스크탑(Windows PowerShell)에서 실행.

**Q: bridge port 8780 이미 점유돼 있으면?**
A: spawner가 자동 retry (8781~8789). 단, 우리 앱 자체는 정상 실행.

**Q: credentials.enc 어디 저장?**
A: `app.getPath('userData')/credentials.enc` (Electron `safeStorage` 암호화).

**Q: MCP server가 헤르메스 안 띄워도 동작?**
A: 네. `mcp-server/server.js`는 in-process bridge로 동작. 진짜 browser control은 헤르메스 띄워야.

---

## 변경 이력

**2026-07-10**: 메인 리팩토링
- `main.js`: 1,446줄 → 843줄 (-42%)
- agent 로직 분리: 9개 모듈 1,256줄
- MCP 서버 추가: 20개 tool
- Bridge 추가: HTTP + Bearer auth + spawner retry
- 자격증명 vault 추가: safeStorage 기반
- Eval framework: 5개 시나리오
- 보강: actionQueue bounded (100), EVAL SAFETY 주석
- 보강: bridge auth token, EADDRINUSE retry, graceful fail
- 우연히 잡은 버그: `clickElement`의 free `send()` 호출 (eval이 production 회귀 발견)
- 백업: `backups/20260710_pre_refactor/`