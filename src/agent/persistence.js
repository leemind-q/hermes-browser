// src/agent/persistence.js — Skills + workspaces + session memory + action log
// Extracted from main.js (originally lines 1102-1245 for skill/workspace, 1189-1202 for memory,
// 536-549 for action log). All disk I/O is isolated here so other agent modules stay pure.

const fs = require('fs');
const path = require('path');

class PersistenceStore {
  /**
   * @param {object} deps
   * @param {string} deps.userDataPath  - absolute path to user data dir
   * @param {object} deps.maskSecrets   - maskSecrets(value) function
   */
  constructor({ userDataPath, maskSecrets }) {
    if (!userDataPath) throw new Error('PersistenceStore: userDataPath required');
    this.userDataPath = userDataPath;
    this.maskSecrets = maskSecrets || (v => v);
    this.actionLog = [];
    this.sessionMemory = [];
    this._ensureDir('skills');
    this._loadActionLog();
  }

  _ensureDir(...parts) {
    const dir = path.join(this.userDataPath, ...parts);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  _readJSON(file, fallback = null) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
  }

  _writeJSON(file, data) {
    try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); return true; } catch { return false; }
  }

  // === Action log ===

  _loadActionLog() {
    this.actionLog = this._readJSON(path.join(this.userDataPath, 'action-log.json'), []) || [];
  }

  appendAction(entry) {
    this.actionLog.unshift(entry);
    this.actionLog = this.actionLog.slice(0, 500);
    this._writeJSON(path.join(this.userDataPath, 'action-log.json'), this.actionLog);
    return entry;
  }

  getActionLog(limit = 50) {
    return this.actionLog.slice(0, limit);
  }

  clearActionLog() {
    this.actionLog = [];
    this._writeJSON(path.join(this.userDataPath, 'action-log.json'), []);
  }

  // === Skills ===

  saveSkill(skill) {
    const dir = this._ensureDir('skills');
    const id = skill.name?.toLowerCase().replace(/[^a-z0-9-]/g, '-') || `skill-${Date.now()}`;
    const full = {
      id,
      name: skill.name || id,
      description: skill.description || '',
      inputs: skill.inputs || [],
      steps: skill.steps || [],
      allowedDomains: skill.allowedDomains || [],
      requiredPermissions: skill.requiredPermissions || [],
      approvalSteps: skill.approvalSteps || [],
      outputFormat: skill.outputFormat || 'text',
      saveLocation: skill.saveLocation || 'chat',
      lastResult: null,
      createdAt: new Date().toISOString(),
    };
    this._writeJSON(path.join(dir, `${id}.json`), full);
    return { ok: true, ...full };
  }

  listSkills() {
    const dir = path.join(this.userDataPath, 'skills');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => this._readJSON(path.join(dir, f))).filter(Boolean);
  }

  getSkill(id) {
    const file = path.join(this.userDataPath, 'skills', `${id}.json`);
    return this._readJSON(file);
  }

  deleteSkill(id) {
    const file = path.join(this.userDataPath, 'skills', `${id}.json`);
    try { fs.unlinkSync(file); return { ok: true }; } catch { return { ok: false }; }
  }

  updateSkillResult(id, result) {
    const skill = this.getSkill(id);
    if (!skill) return { ok: false };
    skill.lastResult = { result, ranAt: new Date().toISOString() };
    return this._writeJSON(path.join(this.userDataPath, 'skills', `${id}.json`), skill) ? { ok: true } : { ok: false };
  }

  // === Session memory ===

  addSessionMemory(key, value, scope = 'session') {
    const entry = { id: Date.now() + Math.floor(Math.random() * 1000), key, value, scope, addedAt: new Date().toISOString() };
    this.sessionMemory.push(entry);
    return entry;
  }

  removeSessionMemory(id) {
    const before = this.sessionMemory.length;
    this.sessionMemory = this.sessionMemory.filter(m => m.id !== Number(id));
    return { ok: this.sessionMemory.length < before };
  }

  clearSessionMemory() {
    this.sessionMemory = [];
    return { ok: true };
  }

  getSessionMemory() {
    return this.sessionMemory;
  }

  // === Workspaces ===

  saveWorkspace(name, goal, planResult) {
    const dir = this._ensureDir('workspaces');
    const id = `ws-${Date.now()}`;
    const entry = { id, name, goal, planResult, createdAt: new Date().toISOString() };
    this._writeJSON(path.join(dir, `${id}.json`), entry);
    return { ok: true, ...entry };
  }

  listWorkspaces() {
    const dir = path.join(this.userDataPath, 'workspaces');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => this._readJSON(path.join(dir, f))).filter(Boolean);
  }

  restoreWorkspace(id) {
    return this.getWorkspace(id);
  }

  deleteWorkspace(id) {
    const file = path.join(this.userDataPath, 'workspaces', `${id}.json`);
    try { fs.unlinkSync(file); return { ok: true }; } catch { return { ok: false }; }
  }

  getWorkspace(id) {
    const file = path.join(this.userDataPath, 'workspaces', `${id}.json`);
    return this._readJSON(file);
  }
}

module.exports = { PersistenceStore };