// tests/workspace.test.js — Unit tests for Tab Workspace save/list/open/delete

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { AgentService } = require('../src/agent');
const { PersistenceStore } = require('../src/agent/persistence');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-ws-'));

function makeAgent() {
  const createdTabs = [];
  let nextId = 1;
  const tabs = [
    { id: nextId++, url: 'https://naver.com', title: 'Naver' },
    { id: nextId++, url: 'https://github.com', title: 'GitHub' },
    { id: nextId++, url: 'https://jira.com', title: 'Jira' },
  ];
  let activeTabId = 1;
  const persistence = new PersistenceStore({ userDataPath: TMP_DIR });
  return {
    persistence,
    agent: new AgentService({
      send: () => true,
      getTabs: () => tabs,
      getActiveTab: () => tabs.find(t => t.id === activeTabId),
      getActiveView: () => null,
      getAutoApprove: () => true,
      createTab: (url, makeActive) => {
        const t = { id: nextId++, url, title: url };
        tabs.push(t);
        createdTabs.push(t);
        if (makeActive) activeTabId = t.id;
        return t;
      },
      switchTab: (id) => { activeTabId = id; return true; },
      closeTab: () => true,
      waitForLoad: async () => {}, goBack: () => {}, goForward: () => {},
      normalizeUrl: (s) => s, notifyAll: () => {},
      userDataPath: TMP_DIR,
    }),
    tabs,
    getCreated: () => createdTabs,
    setActive: (id) => { activeTabId = id; },
  };
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ PASS  ${name}`); passed++; }
  catch (e) { console.log(`  ❌ FAIL  ${name}: ${e.message}`); failed++; }
}

(async () => {
  console.log('========== [Workspace — KV persistence] ==========');

  await test('Persistence.set/get/list/remove round-trip', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-kv-'));
    const p = new PersistenceStore({ userDataPath: dir });
    p.set('hello', { foo: 1 });
    const got = p.get('hello');
    assert.strictEqual(got.foo, 1);
    const list = p.list();
    assert.ok(list.includes('hello'));
    const removed = p.remove('hello');
    assert.strictEqual(removed, true);
    assert.strictEqual(p.get('hello'), null);
  });

  await test('Persistence.list with prefix filter', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-kv-prefix-'));
    const p = new PersistenceStore({ userDataPath: dir });
    p.set('workspace:a', 1);
    p.set('workspace:b', 2);
    p.set('other:c', 3);
    const ws = p.list('workspace:');
    assert.strictEqual(ws.length, 2);
  });

  await test('Persistence.remove returns false for missing key', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-kv-rm-'));
    const p = new PersistenceStore({ userDataPath: dir });
    assert.strictEqual(p.remove('nonexistent'), false);
  });

  console.log('\n========== [Workspace — agent methods] ==========');

  await test('workspaceSave: requires name', async () => {
    const { agent } = makeAgent();
    const r = await agent.workspaceSave({});
    assert.strictEqual(r.ok, false);
    assert.ok(r.error.includes('name required'));
  });

  await test('workspaceSave: stores current tabs', async () => {
    const { agent, persistence } = makeAgent();
    const r = await agent.workspaceSave({ name: 'work' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.tabCount, 3);
    const stored = persistence.get('workspace:work');
    assert.ok(stored);
    assert.strictEqual(stored.tabs.length, 3);
    assert.strictEqual(stored.tabs[0].url, 'https://naver.com');
  });

  await test('workspaceList: returns saved workspaces', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-ws-list-'));
    const persistence = new PersistenceStore({ userDataPath: dir });
    const tabs = [{ id: 1, url: 'https://a.com' }];
    let activeTabId = 1;
    const agent = new AgentService({
      send: () => true,
      getTabs: () => tabs,
      getActiveTab: () => tabs.find(t => t.id === activeTabId),
      getActiveView: () => null,
      getAutoApprove: () => true,
      createTab: (u) => ({ id: 2, url: u }),
      switchTab: () => true, closeTab: () => true,
      waitForLoad: async () => {}, goBack: () => {}, goForward: () => {},
      normalizeUrl: (s) => s, notifyAll: () => {}, userDataPath: dir,
    });
    agent.persistence = persistence;
    await agent.workspaceSave({ name: 'a' });
    await agent.workspaceSave({ name: 'b' });
    const r = await agent.workspaceList();
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.count, 2);
    const names = r.workspaces.map(w => w.name).sort();
    assert.deepStrictEqual(names, ['a', 'b']);
  });

  await test('workspaceOpen: re-opens saved tabs', async () => {
    const { agent, getCreated } = makeAgent();
    await agent.workspaceSave({ name: 'research' });
    // clear createTab tracker
    getCreated().length = 0;
    const r = await agent.workspaceOpen({ name: 'research' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.openedCount, 3);
    assert.strictEqual(getCreated().length, 3);
    assert.strictEqual(getCreated()[0].url, 'https://naver.com');
  });

  await test('workspaceOpen: returns error for missing name', async () => {
    const { agent } = makeAgent();
    const r = await agent.workspaceOpen({ name: 'nonexistent' });
    assert.strictEqual(r.ok, false);
    assert.ok(r.error.includes('workspace not found'));
  });

  await test('workspaceDelete: removes saved workspace', async () => {
    const { agent, persistence } = makeAgent();
    await agent.workspaceSave({ name: 'temporary' });
    assert.ok(persistence.get('workspace:temporary'));
    const r = await agent.workspaceDelete({ name: 'temporary' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(persistence.get('workspace:temporary'), null);
  });

  await test('workspaceDelete: returns false for missing name', async () => {
    const { agent } = makeAgent();
    const r = await agent.workspaceDelete({ name: 'missing' });
    assert.strictEqual(r.ok, false);
  });

  await test('workspaceSave then open preserves URL order', async () => {
    const { agent, getCreated, tabs } = makeAgent();
    // Reorder tabs to verify order is preserved
    tabs.reverse();  // [jira, github, naver]
    await agent.workspaceSave({ name: 'reordered' });
    getCreated().length = 0;
    const r = await agent.workspaceOpen({ name: 'reordered' });
    assert.strictEqual(r.openedCount, 3);
    const urls = getCreated().map(t => t.url);
    assert.deepStrictEqual(urls, ['https://jira.com', 'https://github.com', 'https://naver.com']);
  });

  console.log(`\nPASSED: ${passed}    FAILED: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
})();