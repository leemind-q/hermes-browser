// tests/scheduler.test.js — Unit tests for TaskScheduler + cron parser
//
// Tests cover:
//   - cron parser: *, */N, list, range, exact, invalid
//   - TaskScheduler: add/remove/list, runDueTasks, maxConcurrent, persistence
//
// Uses a fake agent that records dispatched actions.

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { AgentService } = require('../src/agent');
const { TaskScheduler, cronMatches } = require('../src/agent/scheduler');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-scheduler-'));

function makeFakeAgent(opts = {}) {
  const dispatched = [];
  const deps = {
    send: () => true,
    getTabs: () => [{ id: 1, url: 'about:blank', view: { webContents: { getURL: () => 'about:blank' } } }],
    getActiveTab: () => ({ id: 1, url: 'about:blank', view: { webContents: { getURL: () => 'about:blank' } } }),
    getActiveView: () => null,
    getAutoApprove: () => true,
    createTab: () => null,
    switchTab: () => true,
    closeTab: () => true,
    waitForLoad: async () => {},
    goBack: () => {}, goForward: () => {},
    normalizeUrl: (s) => /^https?:/.test(s) ? s : 'https://' + s,
    notifyAll: () => {},
    userDataPath: TMP_DIR,
    ...opts,
  };
  const agent = new AgentService(deps);
  // Override runBrowserAction to record calls
  agent.runBrowserAction = async (action, args) => {
    dispatched.push({ action, args });
    return opts.resultFn ? opts.resultFn(action, args) : { ok: true, action };
  };
  agent.dispatched = dispatched;
  return agent;
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ PASS  ${name}`); passed++; }
  catch (e) { console.log(`  ❌ FAIL  ${name}: ${e.message}`); failed++; }
}

(async () => {
  console.log('========== [Scheduler — cron parser] ==========');

  await test('cron: * matches any minute', () => {
    assert.strictEqual(cronMatches('* * * * *', new Date(2026, 6, 10, 14, 30)), true);
    assert.strictEqual(cronMatches('* * * * *', new Date(2026, 6, 10, 0, 0)), true);
  });

  await test('cron: */N matches every Nth minute', () => {
    assert.strictEqual(cronMatches('*/15 * * * *', new Date(2026, 6, 10, 14, 0)), true);
    assert.strictEqual(cronMatches('*/15 * * * *', new Date(2026, 6, 10, 14, 15)), true);
    assert.strictEqual(cronMatches('*/15 * * * *', new Date(2026, 6, 10, 14, 30)), true);
    assert.strictEqual(cronMatches('*/15 * * * *', new Date(2026, 6, 10, 14, 5)), false);
  });

  await test('cron: exact hour and minute', () => {
    assert.strictEqual(cronMatches('30 9 * * *', new Date(2026, 6, 10, 9, 30)), true);
    assert.strictEqual(cronMatches('30 9 * * *', new Date(2026, 6, 10, 9, 31)), false);
    assert.strictEqual(cronMatches('30 9 * * *', new Date(2026, 6, 10, 8, 30)), false);
  });

  await test('cron: day-of-week (Sunday=0)', () => {
    // 2026-07-12 is a Sunday
    const sun = new Date(2026, 6, 12, 14, 30);
    assert.strictEqual(cronMatches('30 14 * * 0', sun), true);
    // 2026-07-13 is Monday
    const mon = new Date(2026, 6, 13, 14, 30);
    assert.strictEqual(cronMatches('30 14 * * 0', mon), false);
  });

  await test('cron: list (a,b,c)', () => {
    assert.strictEqual(cronMatches('0 9,12,18 * * *', new Date(2026, 6, 10, 9, 0)), true);
    assert.strictEqual(cronMatches('0 9,12,18 * * *', new Date(2026, 6, 10, 12, 0)), true);
    assert.strictEqual(cronMatches('0 9,12,18 * * *', new Date(2026, 6, 10, 15, 0)), false);
  });

  await test('cron: range (a-b)', () => {
    assert.strictEqual(cronMatches('0 9-17 * * *', new Date(2026, 6, 10, 9, 0)), true);
    assert.strictEqual(cronMatches('0 9-17 * * *', new Date(2026, 6, 10, 17, 0)), true);
    assert.strictEqual(cronMatches('0 9-17 * * *', new Date(2026, 6, 10, 18, 0)), false);
  });

  await test('cron: invalid expression throws', () => {
    assert.throws(() => cronMatches('* * *', new Date()));
    assert.throws(() => cronMatches('*/abc * * * *', new Date()));
    assert.throws(() => cronMatches('', new Date()));
    assert.throws(() => cronMatches(null, new Date()));
  });

  console.log('\n========== [Scheduler — TaskScheduler] ==========');

  await test('add: requires id, cron, action', () => {
    const s = new TaskScheduler(makeFakeAgent());
    assert.throws(() => s.add({ id: 'x', cron: '* * * * *' }));
    assert.throws(() => s.add({ id: 'x', action: 'browser_navigate' }));
    assert.throws(() => s.add({ cron: '* * * * *', action: 'browser_navigate' }));
  });

  await test('add: enforces unique id', () => {
    const s = new TaskScheduler(makeFakeAgent());
    s.add({ id: 'task-1', cron: '* * * * *', action: 'browser_navigate' });
    assert.throws(() => s.add({ id: 'task-1', cron: '* * * * *', action: 'browser_navigate' }));
  });

  await test('add: validates cron syntax', () => {
    const s = new TaskScheduler(makeFakeAgent());
    assert.throws(() => s.add({ id: 't', cron: 'bad', action: 'browser_navigate' }));
  });

  await test('remove: returns true on found, false on missing', () => {
    const s = new TaskScheduler(makeFakeAgent());
    s.add({ id: 't1', cron: '* * * * *', action: 'browser_navigate' });
    assert.strictEqual(s.remove('t1'), true);
    assert.strictEqual(s.remove('t1'), false);
  });

  await test('list: returns copy of tasks', () => {
    const s = new TaskScheduler(makeFakeAgent());
    s.add({ id: 't1', cron: '* * * * *', action: 'browser_navigate' });
    s.add({ id: 't2', cron: '*/5 * * * *', action: 'browser_search' });
    const list = s.list();
    assert.strictEqual(list.length, 2);
    assert.notStrictEqual(list, s.tasks);  // copy
  });

  await test('runDueTasks: only matches tasks whose cron matches now', async () => {
    const agent = makeFakeAgent();
    const s = new TaskScheduler(agent);
    s.add({ id: 'every-minute', cron: '* * * * *', action: 'browser_navigate', args: { url: 'a.com' } });
    s.add({ id: 'at-9am', cron: '0 9 * * *', action: 'browser_navigate', args: { url: 'b.com' } });
    // Pick a 9:00 moment so at-9am matches
    const now = new Date(2026, 6, 10, 9, 0);
    const results = await s.runDueTasks(now);
    // both should match (every-minute matches every minute including 9:00)
    assert.strictEqual(results.length, 2);
    assert.strictEqual(agent.dispatched.length, 2);
    assert.deepStrictEqual(agent.dispatched.map(d => d.action), ['browser_navigate', 'browser_navigate']);
    // Verify URLs in dispatch
    const urls = agent.dispatched.map(d => d.args.url).sort();
    assert.deepStrictEqual(urls, ['a.com', 'b.com']);
  });

  await test('runDueTasks: skips disabled tasks', async () => {
    const agent = makeFakeAgent();
    const s = new TaskScheduler(agent);
    s.add({ id: 't1', cron: '* * * * *', action: 'browser_navigate', enabled: false });
    const results = await s.runDueTasks(new Date());
    assert.strictEqual(results.length, 0);
    assert.strictEqual(agent.dispatched.length, 0);
  });

  await test('runDueTasks: maxConcurrent limits per-tick dispatch', async () => {
    // 5 tasks all matching cron. First tick: dispatch up to maxConcurrent=2.
    let dispatchedCount = 0;
    const agent = makeFakeAgent({
      resultFn: () => {
        dispatchedCount++;
        return Promise.resolve({ ok: true });
      },
    });
    const s = new TaskScheduler(agent, { maxConcurrent: 2 });
    for (let i = 0; i < 5; i++) {
      s.add({ id: `t${i}`, cron: '* * * * *', action: 'browser_navigate' });
    }
    // First tick — dispatches up to maxConcurrent (2). Same task IDs each tick
    // until they're marked dispatched-this-cycle; cycle resets after each tick.
    const r1 = await s.runDueTasks(new Date());
    assert.strictEqual(r1.length, 2, 'first tick should dispatch exactly 2 (capped by maxConcurrent)');
    assert.strictEqual(dispatchedCount, 2);
    // The cycle-guard prevents the same 2 from being re-dispatched within one cycle.
    // After tick completes, _dispatchedThisCycle is cleared. So next tick dispatches again.
    // Behavior: cycle-guard works WITHIN a single cycle but resets after.
    // What we verify: r1 dispatched 2 (not 5).
  });

  await test('runDueTasks: persists lastRun + lastResult', async () => {
    const agent = makeFakeAgent();
    const s = new TaskScheduler(agent);
    s.add({ id: 't1', cron: '* * * * *', action: 'browser_navigate' });
    await s.runDueTasks(new Date());
    const t = s.list()[0];
    assert.ok(t.lastRun, 'lastRun should be set');
    assert.ok(t.lastResult.ok === true);
  });

  await test('save+load: round-trip via fs', async () => {
    const agent = makeFakeAgent();
    const s = new TaskScheduler(agent);
    s.add({ id: 'persist-1', cron: '*/30 * * * *', action: 'browser_search', args: { query: 'BLDC' } });
    await s.save();
    // New scheduler instance, same userDataPath
    const s2 = new TaskScheduler(agent);
    await s2.load();
    assert.strictEqual(s2.list().length, 1);
    assert.strictEqual(s2.list()[0].id, 'persist-1');
    assert.deepStrictEqual(s2.list()[0].args, { query: 'BLDC' });
  });

  await test('start/stop: timer lifecycle', () => {
    const s = new TaskScheduler(makeFakeAgent(), { tickIntervalMs: 100 });
    assert.strictEqual(s.start(), true);
    assert.strictEqual(s.start(), false);  // idempotent
    s.stop();
    s.stop();  // idempotent
  });

  await test('onTaskComplete callback fires', async () => {
    const completed = [];
    const agent = makeFakeAgent();
    const s = new TaskScheduler(agent, { onTaskComplete: (r) => completed.push(r) });
    s.add({ id: 'cb-test', cron: '* * * * *', action: 'browser_navigate' });
    await s.runDueTasks(new Date());
    assert.strictEqual(completed.length, 1);
    assert.strictEqual(completed[0].id, 'cb-test');
  });

  await test('error capture: action throw does not crash scheduler', async () => {
    const agent = makeFakeAgent({
      resultFn: () => { throw new Error('action failed'); },
    });
    const s = new TaskScheduler(agent);
    s.add({ id: 'fail', cron: '* * * * *', action: 'browser_navigate' });
    const results = await s.runDueTasks(new Date());
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].status, 'fulfilled');  // scheduler caught it
    assert.strictEqual(results[0].value.ok, false);
    assert.strictEqual(results[0].value.error, 'action failed');
    // Task's lastResult also reflects failure
    assert.strictEqual(s.list()[0].lastResult.ok, false);
  });

  console.log(`\nPASSED: ${passed}    FAILED: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
})();