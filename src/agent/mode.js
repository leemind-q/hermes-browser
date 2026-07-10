// src/agent/mode.js — Agent mode permissions + risk classification
// Extracted from main.js (originally lines 60-76) with zero behavior change.

const MODE_PERMISSIONS = {
  ask:    { canAct: false, canRead: true,  autoApproveRisk: [],              label: '읽기 전용',    desc: '페이지 분석 · 답변 · 번역 · 비교. 실행 없음.' },
  assist: { canAct: false, canRead: true,  autoApproveRisk: [],              label: '준비 · 제안',  desc: '폼 초안 · 입력 후보 · 다음 행동 추천. 실제 실행은 사용자 확인 후.' },
  agent:  { canAct: true,  canRead: true,  autoApproveRisk: ['low'],         label: '브라우저 실행', desc: '낮은 위험 자동 실행 · 중간 이상 승인 요청 · 실시간 표시.' },
  auto:   { canAct: true,  canRead: true,  autoApproveRisk: ['low','medium'], label: '자동 작업',    desc: '사전 승인된 범위에서 자동 실행 · 결제/삭제/전송은 항상 승인.' },
};

const ACTION_RISK = {
  navigate: 'low', searchWeb: 'low', search: 'low', openTab: 'low', switchTab: 'low',
  closeTab: 'low', goBack: 'low', goForward: 'low', reload: 'low', inspectPage: 'low',
  getVisibleText: 'low', scroll: 'low', takeScreenshot: 'low', openExternal: 'low',
  click: 'medium', type: 'medium', fill: 'medium', pressKey: 'medium',
  submit: 'high', uploadFile: 'high', downloadFile: 'medium',
};

function getActionRisk(action) {
  return ACTION_RISK[action] || 'medium';
}

/**
 * Create a self-contained ModeManager. State (currentMode) lives in the instance,
 * not as a module-level variable — this is what makes the agent package testable
 * without Electron and reusable across processes (e.g. MCP server).
 */
class ModeManager {
  constructor(initial = 'agent') {
    this.currentMode = MODE_PERMISSIONS[initial] ? initial : 'agent';
  }

  getPermissions(mode = this.currentMode) {
    return MODE_PERMISSIONS[mode] || MODE_PERMISSIONS.agent;
  }

  setMode(mode) {
    if (!MODE_PERMISSIONS[mode]) return null;
    this.currentMode = mode;
    return MODE_PERMISSIONS[mode];
  }

  requiresApproval(action, perms = this.getPermissions()) {
    const risk = getActionRisk(action);
    return !perms.autoApproveRisk.includes(risk);
  }
}

module.exports = {
  MODE_PERMISSIONS,
  ACTION_RISK,
  getActionRisk,
  ModeManager,
};