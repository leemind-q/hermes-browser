// tests/session-recorder.test.js — Unit tests for Session Recorder

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { AgentService } = require('../src/agent');
const { PersistenceStore } = require('../src/agent/persistence');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-rec-'));

function makeAgent() {
  const fakeView = {
    webContents: {
      getURL: () => 'about:blank',
      executeJavaScript: async () => 'page content',
    },
  };
  const tabs = [{ id: 1, url: 'about:blank', view: fakeView }];
  return {
    persistence: new PersistenceStore({ userDataPath: TMP_DIR }),
    agent: new AgentService({
      send: () => true,
      getTabs: () => tabs,
      getActiveTab: () => tabs[0],
      getActiveView: () => fakeView,
      getAutoApprove: () => true,
      createTab: (u) => ({ id: 2, url: u }),
      switchTab: () => true, closeTab: () => true,
      waitForLoad: async () => {}, goBack: () => {}, goForward: () => {},
      normalizeUrl: (s) => s, notifyAll: () => {},
      userDataPath: TMP_DIR,
    }),
  };
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ PASS  ${name}`); passed++; }
  catch (e) { console.log(`  ❌ FAIL  ${name}: ${e.message}`); failed++; }
}

(async () => {
  console.log('========== [Session Recorder] ==========');

  await test('start: returns sessionId', () => {
    const { agent } = makeAgent();
    const r = agent.sessionRecordStart({ label: 'work session' });
    assert.strictEqual(r.ok, true);
    assert.ok(r.sessionId.startsWith('sess-'));
    assert.ok(r.startedAt);
  });

  await test('start: empty label OK', () => {
    const { agent } = makeAgent();
    const r = agent.sessionRecordStart({});
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.sessionId.startsWith('sess-'), true);
  });

  await test('stop without start: error', () => {
    const { agent } = makeAgent();
    const r = agent.sessionRecordStop();
    assert.strictEqual(r.ok, false);
    assert.ok(r.error.includes('no active recording'));
  });

  await test('stop: returns recorded actions', async () => {
    const { agent } = makeAgent();
    agent.sessionRecordStart();
    await agent.runBrowserAction('getVisibleText');
    await agent.runBrowserAction('inspectPage');
    const r = agent.sessionRecordStop();
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.actionCount, 2);
    assert.strictEqual(r.actions.length, 2);
    assert.strictEqual(r.actions[0].action, 'getVisibleText');
    assert.strictEqual(r.actions[1].action, 'inspectPage');
    assert.strictEqual(r.actions[0].result.ok, true);
  });

  await test('record: skips session_* actions (no recursion)', async () => {
    const { agent } = makeAgent();
    agent.sessionRecordStart();
    agent.sessionRecordStop();
    const start = agent.sessionRecordStart();
    await agent.runBrowserAction('getVisibleText');
    const stop = agent.sessionRecordStop();
    // Should record only runBrowserAction('getVisibleText'), not the start/stop calls
    assert.strictEqual(stop.actions.length, 1);
    assert.strictEqual(stop.actions[0].action, 'getVisibleText');
  });

  await test('save: persists session to disk', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-rec-save-'));
    const persistence = new PersistenceStore({ userDataPath: dir });
    const fakeView = { webContents: { getURL: () => 'about:blank', executeJavaScript: async () => 'page' } };
    const tabs = [{ id: 1, url: 'about:blank', view: fakeView }];
    const agent = new AgentService({
      send: () => true,
      getTabs: () => tabs,
      getActiveTab: () => tabs[0],
      getActiveView: () => fakeView,
      getAutoApprove: () => true,
      createTab: () => null, switchTab: () => true, closeTab: () => true,
      waitForLoad: async () => {}, goBack: () => {}, goForward: () => {},
      normalizeUrl: (s) => s, notifyAll: () => {},
      userDataPath: dir,
    });
    agent.persistence = persistence;
    agent.sessionRecordStart({ label: 'test' });
    await agent.runBrowserAction('getVisibleText');
    const r = await agent.sessionRecordSave({});
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.saved, true);
    assert.ok(r.sessionId);
    const stored = persistence.get(`session:${r.sessionId}`);
    assert.ok(stored);
    assert.strictEqual(stored.actions.length, 1);
    assert.strictEqual(stored.label, 'test');
  });

  await test('list: returns saved sessions', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-rec-list-'));
    const persistence = new PersistenceStore({ userDataPath: dir });
    const fakeView = { webContents: { getURL: () => 'about:blank', executeJavaScript: async () => 'page' } };
    const tabs = [{ id: 1, url: 'about:blank', view: fakeView }];
    const agent = new AgentService({
      send: () => true,
      getTabs: () => tabs,
      getActiveTab: () => tabs[0],
      getActiveView: () => fakeView,
      getAutoApprove: () => true,
      createTab: () => null, switchTab: () => true, closeTab: () => true,
      waitForLoad: async () => {}, goBack: () => {}, goForward: () => {},
      normalizeUrl: (s) => s, notifyAll: () => {},
      userDataPath: dir,
    });
    agent.persistence = persistence;
    agent.sessionRecordStart({ label: 'a' });
    await agent.runBrowserAction('getVisibleText');
    const saveA = await agent.sessionRecordSave({});
    agent.sessionRecordStart({ label: 'b' });
    await agent.runBrowserAction('inspectPage');
    const saveB = await agent.sessionRecordSave({});
    const r = await agent.sessionRecordList();
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.count, 2);
  });

  await test('play: re-runs each action', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-rec-play-'));
    const persistence = new PersistenceStore({ userDataPath: dir });
    const fakeView = { webContents: { getURL: () => 'about:blank', executeJavaScript: async () => 'page' } };
    const tabs = [{ id: 1, url: 'about:blank', view: fakeView }];
    let callCount = 0;
    const agent = new AgentService({
      send: () => true,
      getTabs: () => tabs,
      getActiveTab: () => tabs[0],
      getActiveView: () => fakeView,
      getAutoApprove: () => true,
      createTab: () => null, switchTab: () => true, closeTab: () => true,
      waitForLoad: async () => {}, goBack: () => {}, goForward: () => {},
      normalizeUrl: (s) => s, notifyAll: () => {},
      userDataPath: dir,
    });
    agent.persistence = persistence;
    // Override runBrowserAction to count
    const origRun = agent.runBrowserAction.bind(agent);
    agent.runBrowserAction = async (...args) => { callCount++; return origRun(...args); };

    agent.sessionRecordStart();
    await agent.runBrowserAction('getVisibleText');
    await agent.runBrowserAction('inspectPage');
    const save = await agent.sessionRecordSave({});
    callCount = 0;  // reset

    const r = await agent.sessionRecordPlay({ sessionId: save.sessionId });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.totalActions, 2);
    assert.strictEqual(r.successCount, 2);
    assert.ok(callCount >= 2);
  });

  await test('play: missing sessionId → error', async () => {
    const { agent } = makeAgent();
    const r = await agent.sessionRecordPlay({});
    assert.strictEqual(r.ok, false);
    assert.ok(r.error.includes('sessionId required'));
  });

  await test('play: missing session → error', async () => {
    const { agent } = makeAgent();
    const r = await agent.sessionRecordPlay({ sessionId: 'nonexistent' });
    assert.strictEqual(r.ok, false);
    assert.ok(r.error.includes('not found'));
  });

  await test('delete: removes saved session', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-rec-delete-'));
    const persistence = new PersistenceStore({ userDataPath: dir });
    const fakeView = { webContents: { getURL: () => 'about:blank', executeJavaScript: async () => 'page' } };
    const agent = new AgentService({
      send: () => true,
      getTabs: () => [{ id: 1, url: 'about:blank', view: fakeView }],
      getActiveTab: () => null, getActiveView: () => fakeView,
      getAutoApprove: () => true,
      createTab: () => null, switchTab: () => true, closeTab: () => true,
      waitForLoad: async () => {}, goBack: () => {}, goForward: () => {},
      normalizeUrl: (s) => s, notifyAll: () => {},
      userDataPath: dir,
    });
    agent.persistence = persistence;
    agent.sessionRecordStart();
    await agent.runBrowserAction('getVisibleText');
    const save = await agent.sessionRecordSave({});
    const r = await agent.sessionRecordDelete({ sessionId: save.sessionId });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(persistence.get(`session:${save.sessionId}`), null);
  });

  console.log(`\nPASSED: ${passed}    FAILED: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
})();