# Hermes Browser V13 — Workflow Integration Guide

**대상**: BLDC 회로 설계 엔지니어 (Dongyang Fan) — 본인 일상 워크플로우 통합

---

## 🎯 일상 시나리오별 워크플로우

### Scenario 1: 새 회로 프로젝트 시작

```
1. Windows Altium에서 회로 그리기 (회사 PC)
2. Altium Gerber Export (회사 PC, 직접)
3. 회사 PC에서 BOM.csv export (직접)
4. WSL: scp ~/Projects/<project>/bom.csv → /mnt/c/Users/qqwer/Hermes-Workspace/demo-circuits/<project>/bom/
5. WSL: scp <gerber>.GTL → 같은 gerber/ 폴더
6. Hermes Browser 시작:
   npm start
7. Ctrl+K → "Cowork" 선택 → 워크스페이스 열기
   → 자동 context: BOM + Gerber + datasheet 모두 한 곳에서
8. Claude Code (또는 다른 AI)에서 cowork MCP 도구 사용:
   - coworker_read BOM.csv
   - coworker_grep "BD69730"
   - coworker_search "*.GT*"
9. AI가 회로 질문에 즉시 답함 (BOM/datasheet 자동 인용)
```

### Scenario 2: 부품 datasheet 빠른 context

```
1. Mouser/DigiKey에서 PDF 다운로드
2. WSL: ~/Downloads/<part>.pdf → /mnt/c/Users/qqwer/Hermes-Workspace/demo-circuits/<project>/datasheet/
3. coworker_stat (file metadata) → file size, mtime, mime
4. coworker_grep "VCC" (회로 키워드 빠른 검색)
5. 필요 시 → coworker_read (text)
6. PDF는 binary → reader로 별도 (Cowork는 binary 메타만)
```

### Scenario 3: AI 에이전트로 회로 의뢰

```
1. Claude Code 실행
2. ~/.claude/mcp.json 설정 (자세한 설치 가이드 = README):
   "hermes-browser": {
     "command": "node",
     "args": ["C:/Users/qqwer/Desktop/Hermes/hermes-browser/mcp-server/server.js"]
   }
3. 프롬프트:
   "BD69730FV 회로에서 U1 주변 cap 값들 다 뭐야?"
   → Claude Code가 자동으로 cowork_grep + coworker_read 사용
   → BOM.csv + datasheet 참고해서 답변
```

### Scenario 4: 워크스페이스 세션 저장/복원

```
1. 회로 진행 중 → Ctrl+K → "워크스페이스 저장"
2. 탭 10개 + 그룹 3개 + Cowork context 모두 저장
3. 다음 날 (다른 회사, 다른 PC):
   - WSL ~/Hermes-Workspace/workspaces/<name>.json 존재
   - Hermes Browser 시작 → 좌측 하단 workspace switcher 클릭
   - 자동으로 탭 10개 + 그룹 복원 + 마지막 Cowork context 다시
```

### Scenario 5: 회로 검증 (Gerber → png → cowork)

```
1. 회사 PC Altium의 PCB-Review로 Gerber → PNG export (직접)
2. WSL: cp <png> → ~/Hermes-Workspace/demo-circuits/<project>/gerber/
3. 헤르메스 브라우저의 chat sidebar에서:
   - AI에게 "회로 이미지 검사해줘" 라고 요청
   - cowork_read로 Gerber 메타, cowork_search로 PNG 파일 확인
   - AI가 Gerber/PNG 파일 참조하며 답변
```

---

## ⌨️ 주요 단축키

| Key | Action |
|---|---|
| **Ctrl+T** | 새 탭 |
| **Ctrl+K** (메인) | Command Palette — 모든 명령 검색 |
| **Ctrl+\`** (메인) | AI 패널 토글 |
| **Ctrl+F** | 페이지 내 검색 |
| **Ctrl+H** | 방문 기록 |
| **Ctrl+J** | 다운로드 |
| **Ctrl+D** | 즐겨찾기 |
| **Ctrl+Shift+P** | Command Palette (legacy) |
| **Cmd+K** (메인) | 같은 command palette |

---

## 🤖 MCP 도구 카테고리

### Cowork (5개)
- `cowork_list`: 디렉토리 목록
- `cowork_read`: 파일 읽기 (text/file metadata)
- `cowork_grep`: 정규식 검색 (대용량 최적화)
- `cowork_search`: 이름/내용 검색
- `cowork_stat`: 파일 메타데이터

### Browser (30+개)
- browse_navigate, browse_click, browse_fill, browse_autofill_form
- browse_get_visible_text, browse_read_page, browse_inspect_page
- browse_extract_search_results, browse_extract_table
- browse_search (Google), browse_print_page, browse_take_screenshot
- browse_open_tab, browse_switch_tab, browse_close_tab, etc.

### Web Search (2개)
- `web_search_naver`: 네이버 검색 (KR 우선)
- `web_search_ddg`: DuckDuckGo 검색 (keyless)

### Reading List / Workspace / Session Recorder (다수)
- reading_list_add/list/remove/mark_read/open/cleanup
- workspace_save/list/open/delete
- session_record_start/stop/save/list/play/delete

### LLM Provider (2개)
- `browser_provider_list`: 10개 프로바이더 프리셋
- `browser_test_provider`: 연결 테스트 (latency, key 검증)

---

## 💡 팁

1. **Cache 활용**: `cowork_list`는 3초 캐시되어 반복 호출 빠름. 강제 새로고침은 `noCache: true`
2. **WSL 경로**: `C:\Users\qqwer\Hermes-Workspace` 또는 `/mnt/c/Users/qqwer/Hermes-Workspace` 둘 다 작동 (자동 변환)
3. **OS sync 다크 모드**: OS 라이트 → 헤르메스도 라이트. OS 다크 → 헤르메스도 다크 (자동)
4. **Theme override**: 우하단 상태바 "라이트/다크" 토글로 OS 무시 가능
5. **Bento empty state**: 탭 0일 때 4장 카드 (newtab/cowork/provider/workspace) — 빠른 진입
6. **Bypass cache**: `cowork_list {dir: "...", noCache: true}` (grep/search는 캐시 없음)

---

## 📞 자주 쓰는 프롬프트 패턴 (Claude Code)

```
"현재 워크스페이스의 BOM.csv에서 U1, U2 라인 보여줘" 
→ cowork_grep

"데모 회로의 Gerber 파일들 보여줘"
→ coworker_list

"BD69730FV datasheet의 전기적 특성 정리해줘"
→ coworker_stat (binary meta) + 외부 PDF reader

"Hermes Workspace의 모든 회로 프로젝트 목록"
→ coworker_list {dir: "demo-circuits"}
```

---

생성: 2026-07-11 (V13 Day 7)
업데이트: 회사 회로 데이터 실측 후 workflow 추가
