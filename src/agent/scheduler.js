// src/agent/scheduler.js — BrowserOS-style scheduled agent tasks
//
// Each task is a JSON object with:
//   - id: string
//   - cron: 5-field cron expression ("*/15 * * * *" = every 15 minutes)
//   - action: browser_* tool name to invoke
//   - args: object passed as tool args
//   - enabled: boolean
//   - lastRun: ISO timestamp
//   - lastResult: { ok, ... }
//
// Tasks persist to userDataPath/scheduler/tasks.json.
// On startup, load tasks + spawn single timer that fires every minute,
// checking each task's cron against current Date. When matched, dispatch
// the action via agent.runBrowserAction and persist result.
//
// This is the same scheduling layer used in BrowserOS's "scheduled actions"
// feature — but standalone (no native deps, runs in pure Node).
//
// IMPORTANT: This module does NOT start the timer. Main process owns
// the scheduler lifecycle via start()/stop(). Tests can drive tasks
// directly via runDueTasks(now).

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  tasksPath: 'scheduler/tasks.json',
  tickIntervalMs: 60_000,
  maxConcurrent: 3,
};

class TaskScheduler {
  constructor(agent, opts = {}) {
    if (!agent) throw new Error('TaskScheduler requires agent');
    this.agent = agent;
    this.opts = { ...DEFAULTS, ...opts };
    this.tasks = [];
    this.timer = null;
    this.running = new Set();
    this._dispatchedThisCycle = new Set();
    this.onTaskComplete = opts.onTaskComplete || (() => {});
  }

  async load() {
    const fullPath = path.join(this.agent.deps.userDataPath, this.opts.tasksPath);
    try {
      const raw = await fs.promises.readFile(fullPath, 'utf8');
      const parsed = JSON.parse(raw);
      this.tasks = Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      this.tasks = [];
    }
    return this.tasks;
  }

  async save() {
    const fullPath = path.join(this.agent.deps.userDataPath, this.opts.tasksPath);
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.promises.writeFile(fullPath, JSON.stringify(this.tasks, null, 2));
  }

  add(task) {
    const required = ['id', 'cron', 'action'];
    for (const k of required) {
      if (!task[k]) throw new Error(`task missing required field: ${k}`);
    }
    // Check uniqueness
    if (this.tasks.some(t => t.id === task.id)) {
      throw new Error(`task id already exists: ${task.id}`);
    }
    // Validate cron
    cronMatches(task.cron, new Date());  // throws on invalid
    this.tasks.push({
      enabled: true,
      lastRun: null,
      lastResult: null,
      ...task,
    });
    return this.tasks[this.tasks.length - 1];
  }

  remove(id) {
    const idx = this.tasks.findIndex(t => t.id === id);
    if (idx < 0) return false;
    this.tasks.splice(idx, 1);
    return true;
  }

  list() {
    return [...this.tasks];
  }

  start() {
    if (this.timer) return false;  // already running
    this.timer = setInterval(() => {
      this.runDueTasks(new Date()).catch(err => {
        console.error('[scheduler] tick error:', err.message);
      });
    }, this.opts.tickIntervalMs);
    return true;
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Run all tasks whose cron matches `now`. Returns array of completed results.
   */
  async runDueTasks(now = new Date()) {
    // Pick due tasks not currently running AND not yet dispatched this cycle.
    const due = this.tasks.filter(t =>
      t.enabled && !this.running.has(t.id) && !this._dispatchedThisCycle.has(t.id) && cronMatches(t.cron, now)
    );
    const slots = Math.max(0, this.opts.maxConcurrent - this.running.size);
    const toRun = due.slice(0, slots);
    // Mark dispatched in this cycle (so re-tick before save doesn't double-fire)
    toRun.forEach(t => this._dispatchedThisCycle.add(t.id));
    const results = await Promise.allSettled(
      toRun.map(t => this._runOne(t, now))
    );
    this._dispatchedThisCycle.clear();  // next cycle: fresh
    return results.map((r, i) => ({
      id: toRun[i].id,
      status: r.status,
      value: r.status === 'fulfilled' ? r.value : { ok: false, error: r.reason?.message },
    }));
  }

  async _runOne(task, now) {
    if (this.running.has(task.id)) return { ok: false, error: 'already running' };
    this.running.add(task.id);
    try {
      const result = await this.agent.runBrowserAction(task.action, task.args || {});
      task.lastRun = now.toISOString();
      task.lastResult = { ok: result?.ok !== false, ...result };
      this.onTaskComplete({ id: task.id, ...task.lastResult });
      await this.save();
      return { ok: true, id: task.id, result: task.lastResult };
    } catch (e) {
      task.lastRun = now.toISOString();
      task.lastResult = { ok: false, error: e.message };
      await this.save();
      return { ok: false, id: task.id, error: e.message };
    } finally {
      this.running.delete(task.id);
    }
  }
}

// ============ Cron expression matcher ============
//
// Supports: "* * * * *" (5-field: min hour dom mon dow)
// Each field can be: number | * | */N | a-b | a,b,c
// Limited but covers the common patterns BrowserOS uses.

function cronMatches(expression, date) {
  if (!expression || typeof expression !== 'string') {
    throw new Error('cron expression required');
  }
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`cron must have 5 fields, got ${fields.length}: "${expression}"`);
  }
  const [minF, hourF, domF, monF, dowF] = fields;
  const min = date.getMinutes();
  const hour = date.getHours();
  const dom = date.getDate();
  const mon = date.getMonth() + 1;
  const dow = date.getDay();
  return (
    matchField(minF, min, 0, 59) &&
    matchField(hourF, hour, 0, 23) &&
    matchField(domF, dom, 1, 31) &&
    matchField(monF, mon, 1, 12) &&
    matchField(dowF, dow, 0, 6)
  );
}

function matchField(spec, value, min, max) {
  if (spec === '*') return true;
  // */N
  if (spec.startsWith('*/')) {
    const n = parseInt(spec.slice(2), 10);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`bad */N: ${spec}`);
    return value % n === 0;
  }
  // List
  if (spec.includes(',')) {
    return spec.split(',').some(part => matchField(part, value, min, max));
  }
  // Range
  if (spec.includes('-')) {
    const [a, b] = spec.split('-').map(s => parseInt(s, 10));
    return value >= a && value <= b;
  }
  // Exact
  const n = parseInt(spec, 10);
  if (!Number.isFinite(n)) throw new Error(`bad field: ${spec}`);
  return value === n;
}

module.exports = { TaskScheduler, cronMatches };