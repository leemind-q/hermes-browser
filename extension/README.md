# Hermes Cowork Bridge — Browser Extension

**Chrome / Edge / Brave / Arc / 모든 Chromium 브라우저에서 Hermes Browser cowork 도구 사용**

## 설치

### Chrome / Edge / Brave / Arc

1. 주소창 `chrome://extensions` 입력
2. 우상단 **개발자 모드** 활성화
3. **Load unpacked** 클릭 → `extension/` 폴더 선택
4. 확장 설치 완료!

### Firefox (v2 manifest 필요 — 현재 MV3 Chrome 전용)

Firefox는 약간 다른 manifest 형식. 추후 v2 manifest 추가 가능.

## 사용법

### Popup UI

확장 아이콘 클릭 → 다음 4개 quick action:

- **워크스페이스 목록** — `cowork_list`
- **Git 상태** — `cowork_git_status`
- **활성 워처 목록** — `cowork_watch_list`
- **활성 락 목록** — `cowork_list_locks`

### Content Script (어떤 페이지에서든)

```javascript
// Get BOM.csv contents from cowork workspace
const bom = await window.HermesCowork.call('cowork_read', {
  path: 'C:\\\\Users\\\\qqwer\\\\Hermes-Workspace\\\\demo-circuits\\\\BD69730FV-FanDriver-v1.0\\\\bom\\\\BOM.csv'
});
console.log(bom.content);

// Search across all files
const matches = await window.HermesCowork.call('cowork_grep', {
  path: 'C:\\\\Users\\\\qqwer\\\\Hermes-Workspace',
  pattern: 'BD69730FV',
  maxResults: 10,
});
console.log(matches.matches);

// Git status
const status = await window.HermesCowork.call('cowork_git_status', { path: '.' });
console.log(status.items);
```

### Popup 예시 (popup.html + popup.js)

`popup.html` 자동 포함. 360px 폭 + 4 quick actions + result 표시.

## 요구 사항

- Hermes Browser 실행 중이어야 함 (`http://127.0.0.1:8780`)
- Bridge token 자동 발급
- 26 Cowork 도구 전부 사용 가능 (lock/lease/git/watch/search/diff 등)

## 보안

- **localhost only**: 외부 네트워크 호출 안 함
- **토큰 인증**: Bearer token 매 요청 검증
- **host_permissions**: 127.0.0.1:8780 + localhost:8780만

## 개발

```bash
# 파일 수정 후 chrome://extensions → 새로고침 클릭
# popup 콘솔 디버그: 확장 우클릭 → 검사

# manifest.json 수정 → chrome://extensions → 새로고침
```

## 라이선스

AGPL-3 (Hermes Browser와 동일)