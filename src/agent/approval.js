// src/agent/approval.js — User approval flow for sensitive actions
// Extracted from main.js (originally lines 511-528).

/**
 * Approval flow manager. Owns the pendingApprovals map.
 *
 * @param {object} deps
 * @param {() => boolean} deps.getAutoApprove  - global toggle (settings)
 * @param {object} deps.maskSecrets            - for safe param display
 * @param {(channel, payload) => boolean} deps.send  - send to renderer
 * @param {() => object} deps.getActiveTab     - active tab accessor
 * @param {(action: string) => 'low'|'medium'|'high'} deps.getActionRisk
 * @param {(action: string, entry: object) => void} deps.logAction
 */
class ApprovalManager {
  constructor({ getAutoApprove, maskSecrets, send, getActiveTab, getActionRisk, logAction }) {
    this.getAutoApprove = getAutoApprove || (() => false);
    this.maskSecrets = maskSecrets || (v => v);
    this.send = send || (() => {});
    this.getActiveTab = getActiveTab || (() => null);
    this.getActionRisk = getActionRisk || (() => 'medium');
    this.logAction = logAction || (() => {});
    this.pendingApprovals = new Map();
  }

  /**
   * Ask the user for approval. Resolves true if approved, false if denied or
   * 60s timeout. If global autoApprove is on, auto-approves and logs it.
   */
  async ask(action, params, reason) {
    if (this.getAutoApprove()) {
      this.logAction('auto-approve', { action, params }, { ok: true });
      return true;
    }
    const id = Date.now() + Math.floor(Math.random() * 1000);
    const active = this.getActiveTab();
    const site = active?.url ? new URL(active.url).hostname : 'unknown';
    const risk = this.getActionRisk(action);
    const reversible = ['navigate', 'scroll', 'click', 'type', 'fill', 'goBack', 'goForward', 'reload', 'switchTab', 'openTab'].includes(action);
    const approvalData = {
      id, action,
      params: this.maskSecrets(params),
      reason,
      riskLevel: risk,
      site,
      reversible,
      targetDescription: params.description || params.text || params.ref || params.url || params.query || '',
      inputSummary: (action === 'type' || action === 'fill') ? String(params.value || params.text || '').slice(0, 80) : '',
    };
    this.send('approval-request', approvalData);
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.pendingApprovals.delete(id);
        resolve(false);
      }, 60000);
      this.pendingApprovals.set(id, value => {
        clearTimeout(timer);
        resolve(!!value);
      });
    });
  }

  /** Called from IPC when the user clicks approve/deny in the UI. */
  respond(id, approved) {
    const cb = this.pendingApprovals.get(id);
    if (cb) {
      this.pendingApprovals.delete(id);
      cb(approved);
      return true;
    }
    return false;
  }

  /** For UI: how many approvals are waiting right now. */
  pendingCount() {
    return this.pendingApprovals.size;
  }
}

module.exports = { ApprovalManager };