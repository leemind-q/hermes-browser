# Hermes Cowork Bridge — Firefox Extension

**Firefox 109+ Manifest V2 extension for Hermes Browser cowork tools**

## 설치

### Firefox (수동 설치 — 임시)

1. Firefox 주소창 `about:debugging#/runtime/this-firefox` 입력
2. **Load Temporary Add-on** 클릭
3. `extension-firefox/manifest.json` 파일 선택
4. 확장 설치 완료! (Firefox 재시작 시 제거됨)

### Firefox (영구 설치 — signed)

1. ZIP으로 패키징:
   ```bash
   zip -r hermes-cowork-bridge-firefox.zip extension-firefox/
   ```
2. [Firefox Add-ons](https://addons.mozilla.org/) 제출 → AMO 서명 후 설치

## 사용법

Chrome extension과 동일:
- Popup UI: 4 quick actions (워크스페이스 목록 / Git 상태 / 활성 워처 / 활성 락)
- Content script: `window.HermesCowork.call(name, args)` API

## Chrome vs Firefox 차이

| 항목 | Chrome MV3 | Firefox MV2 |
|---|---|---|
| manifest_version | 3 | 2 |
| background | service_worker | scripts[] |
| Host permissions | host_permissions | permissions (with `<all_urls>`) |
| browser_specific_settings | 없음 | gecko { id, strict_min_version } |
| API namespace | chrome.* | browser.* (chrome.*도 호환) |

## 보안

- localhost only: 외부 네트워크 호출 없음
- 토큰 인증: Bearer token 매 요청 검증
- 호환 권한: `<all_urls>` (Firefox MV2는 host_permissions 분리 불가)

## 라이선스

AGPL-3 (Hermes Browser와 동일)
