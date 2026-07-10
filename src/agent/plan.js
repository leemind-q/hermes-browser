// src/agent/plan.js — Structured action creation + plan state machine
// Extracted from main.js (originally lines 79-136, 107-118).

const { maskSecrets } = require('./safety');
const { getActionRisk } = require('./mode');

/**
 * Create a structured action record. The action is created in 'pending' state
 * and moves through: pending → (approval) → running → completed|failed|denied|blocked.
 *
 * `reason` is the natural-language justification the agent attached to the action
 * — it shows up in the UI and action log so the user always knows WHY the agent
 * wanted to do this thing.
 */
function createStructuredAction(actionType, params = {}, reason = '', modeManager = null) {
  const risk = getActionRisk(actionType);
  const perms = modeManager ? modeManager.getPermissions() : { autoApproveRisk: [] };
  const requiresApproval = modeManager ? modeManager.requiresApproval(actionType) : !perms.autoApproveRisk.includes(risk);
  return {
    actionId: `act_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    actionType,
    target: params.ref || params.selector || params.url || params.query || '',
    targetDescription: params.description || '',
    parameters: maskSecrets(params),
    reason,
    riskLevel: risk,
    requiresApproval,
    status: 'pending',
    result: null,
    error: null,
    retryCount: 0,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
}

/**
 * Owns the active plan state. `steps` is an array of strings (label only) or
 * objects { label, detail }. Step status transitions: waiting → running → done|failed.
 * Only one step is 'running' at a time; activeIndex auto-advances on done.
 */
class PlanState {
  constructor(notify = () => {}) {
    this.state = { goal: '', steps: [], activeIndex: -1, paused: false, createdAt: null };
    this.notify = notify;
  }

  update(goal, steps) {
    this.state = {
      goal,
      steps: steps.map((s, i) => ({
        id: `step_${i}`,
        label: typeof s === 'string' ? s : s.label,
        status: 'waiting',
        detail: typeof s === 'string' ? '' : (s.detail || ''),
        actionIds: [],
      })),
      activeIndex: -1,
      paused: false,
      createdAt: new Date().toISOString(),
    };
    this.notify('plan-state', this.state);
    return this.state;
  }

  setStepStatus(index, status, detail = '') {
    if (!this.state.steps[index]) return;
    this.state.steps[index].status = status;
    if (detail) this.state.steps[index].detail = detail;
    if (status === 'running') this.state.activeIndex = index;
    if (status === 'done' && index === this.state.activeIndex) {
      this.state.activeIndex = index + 1 < this.state.steps.length ? index + 1 : -1;
    }
    this.notify('plan-state', this.state);
  }

  setPaused(paused) {
    this.state.paused = paused;
    this.notify('plan-state', this.state);
  }

  get() {
    return this.state;
  }
}

module.exports = {
  createStructuredAction,
  PlanState,
};