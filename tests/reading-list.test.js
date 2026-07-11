// tests/reading-list.test.js — Unit tests for ReadingList storage + agent integration

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { ReadingList } = require('../src/agent/reading-list');
const { AgentService } = require('../src/agent');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-reading-'));

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ PASS  ${name}`); passed++; }
  catch (e) { console.log(`  ❌ FAIL  ${name}: ${e.message}`); failed++; }
}

(async () => {
  console.log('========== [ReadingList — storage] ==========');

  await test('add: stores url + title', async () => {
    const rl = new ReadingList({ userDataPath: TMP_DIR });
    await rl.load();
    const item = await rl.add({ url: 'https://example.com/a', title: 'A' });
    assert.ok(item.id);
    assert.strictEqual(item.url, 'https://example.com/a');
    assert.strictEqual(item.title, 'A');
    assert.strictEqual(item.read, false);
  });

  await test('add: persists to disk', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-reading-persist-'));
    const rl1 = new ReadingList({ userDataPath: dir });
    await rl1.load();
    await rl1.add({ url: 'https://example.com/b', title: 'B' });
    const rl2 = new ReadingList({ userDataPath: dir });
    await rl2.load();
    assert.strictEqual(rl2.items.length, 1);
    assert.strictEqual(rl2.items[0].url, 'https://example.com/b');
  });

  await test('add: snapshot written to file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-reading-snap-'));
    const rl = new ReadingList({ userDataPath: dir });
    await rl.load();
    const item = await rl.add({ url: 'https://x.com', html: '<html><body>X</body></html>' });
    assert.ok(item.htmlRef);
    const snapPath = path.join(dir, 'reading-list', item.htmlRef);
    assert.ok(fs.existsSync(snapPath));
    assert.strictEqual(fs.readFileSync(snapPath, 'utf8'), '<html><body>X</body></html>');
  });

  await test('add: dedupes by URL (no duplicate)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-reading-dedupe2-'));
    const rl = new ReadingList({ userDataPath: dir });
    await rl.load();
    const a = await rl.add({ url: 'https://example.com/dup', title: 'First' });
    const b = await rl.add({ url: 'https://example.com/dup', title: 'Second' });
    assert.strictEqual(a.id, b.id);
    assert.strictEqual(rl.items.length, 1);
  });

  await test('add: dedupe updates snapshot if newer html', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-reading-dedupe-'));
    const rl = new ReadingList({ userDataPath: dir });
    await rl.load();
    await rl.add({ url: 'https://x.com', html: '<html>v1</html>' });
    const item = await rl.add({ url: 'https://x.com', html: '<html>v2</html>' });
    const snapPath = path.join(dir, 'reading-list', item.htmlRef);
    assert.strictEqual(fs.readFileSync(snapPath, 'utf8'), '<html>v2</html>');
  });

  await test('remove: removes item + snapshot file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-reading-rm-'));
    const rl = new ReadingList({ userDataPath: dir });
    await rl.load();
    const item = await rl.add({ url: 'https://y.com', html: '<html>Y</html>' });
    const snapPath = path.join(dir, 'reading-list', item.htmlRef);
    assert.ok(fs.existsSync(snapPath));
    const ok = await rl.remove(item.id);
    assert.strictEqual(ok, true);
    assert.strictEqual(rl.items.length, 0);
    assert.strictEqual(fs.existsSync(snapPath), false);
  });

  await test('remove: returns false for missing id', async () => {
    const rl = new ReadingList({ userDataPath: TMP_DIR });
    await rl.load();
    assert.strictEqual(await rl.remove('r-missing'), false);
  });

  await test('markRead: toggles read state', async () => {
    const rl = new ReadingList({ userDataPath: TMP_DIR });
    await rl.load();
    const item = await rl.add({ url: 'https://z.com', title: 'Z' });
    assert.strictEqual(item.read, false);
    const m1 = rl.markRead(item.id, true);
    assert.strictEqual(m1.read, true);
    assert.ok(m1.readAt);
    const m2 = rl.markRead(item.id, false);
    assert.strictEqual(m2.read, false);
    assert.strictEqual(m2.readAt, null);
  });

  await test('list: filters by unreadOnly + tag', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-reading-listfilter-'));
    const rl = new ReadingList({ userDataPath: dir });
    await rl.load();
    await rl.add({ url: 'https://a.com', tags: ['work'] });
    await rl.add({ url: 'https://b.com', tags: ['fun'] });
    await rl.add({ url: 'https://c.com', tags: ['work'] });
    const work = rl.list({ tag: 'work' });
    assert.strictEqual(work.length, 2);
    const unread = rl.list({ unreadOnly: true });
    assert.strictEqual(unread.length, 3);
  });

  await test('getOfflineUrl: returns file:// URL when snapshot exists', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-reading-offline-'));
    const rl = new ReadingList({ userDataPath: dir });
    await rl.load();
    const item = await rl.add({ url: 'https://w.com', html: '<html>W</html>' });
    const url = rl.getOfflineUrl(item.id);
    assert.ok(url.startsWith('file://'));
    assert.ok(url.endsWith('.html'));
  });

  await test('getOfflineUrl: returns null when no snapshot', async () => {
    const rl = new ReadingList({ userDataPath: TMP_DIR });
    await rl.load();
    const item = await rl.add({ url: 'https://nosnap.com' });
    assert.strictEqual(rl.getOfflineUrl(item.id), null);
  });

  await test('cleanup: removes old read items', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-reading-cleanup-'));
    const rl = new ReadingList({ userDataPath: dir });
    await rl.load();
    const old = await rl.add({ url: 'https://old.com', title: 'Old' });
    rl.markRead(old.id, true);
    // Force old timestamp
    old.addedAt = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    await rl.save();
    const recent = await rl.add({ url: 'https://recent.com', title: 'Recent' });
    const removed = await rl.cleanup({ maxAgeDays: 30 });
    assert.strictEqual(removed, 1);
    assert.strictEqual(rl.items.length, 1);
    assert.strictEqual(rl.items[0].id, recent.id);
  });

  await test('cleanup: keeps unread by default', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-reading-keep-'));
    const rl = new ReadingList({ userDataPath: dir });
    await rl.load();
    const item = await rl.add({ url: 'https://keep.com' });
    item.addedAt = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    await rl.save();
    const removed = await rl.cleanup({ maxAgeDays: 30 });
    assert.strictEqual(removed, 0);
    assert.strictEqual(rl.items.length, 1);
  });

  console.log('\n========== [AgentService — reading list integration] ==========');

  function makeAgent() {
    const tab = {
      id: 1, url: 'https://example.com', view: {
        webContents: {
          getURL: () => 'https://example.com',
          executeJavaScript: async (code) => '<html>SNAPSHOT</html>',
        },
      },
    };
    const agent = new AgentService({
      send: () => true,
      getTabs: () => [tab],
      getActiveTab: () => tab,
      getActiveView: () => tab.view,
      getAutoApprove: () => true,
      createTab: (url, active) => ({ url, active }),
      switchTab: () => true, closeTab: () => true,
      waitForLoad: async () => {}, goBack: () => {}, goForward: () => {},
      normalizeUrl: (s) => s, notifyAll: () => {},
      userDataPath: TMP_DIR,
    });
    return { agent, tab };
  }

  await test('agent.readingListAdd: snapshots active page', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-agent-add-'));
    process.env.X = dir;  // not used
    const { agent } = makeAgent();
    agent.deps.userDataPath = dir;
    const item = await agent.readingListAdd({ url: 'https://example.com', title: 'Example' });
    assert.strictEqual(item.url, 'https://example.com');
    assert.ok(item.htmlRef);
    const snapPath = path.join(dir, 'reading-list', item.htmlRef);
    assert.ok(fs.existsSync(snapPath));
  });

  await test('agent.readingListList: returns items + count', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-agent-list-'));
    const { agent } = makeAgent();
    agent.deps.userDataPath = dir;
    await agent.readingListAdd({ url: 'https://a.com', title: 'A' });
    await agent.readingListAdd({ url: 'https://b.com', title: 'B' });
    const r = await agent.readingListList({});
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.count, 2);
    assert.strictEqual(r.items.length, 2);
  });

  await test('agent.readingListMarkRead: updates read flag', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-agent-mark-'));
    const { agent } = makeAgent();
    agent.deps.userDataPath = dir;
    const item = await agent.readingListAdd({ url: 'https://c.com' });
    const r = await agent.readingListMarkRead({ id: item.id });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.item.read, true);
  });

  await test('agent.readingListOpen: returns offline URL', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-agent-open-'));
    const { agent } = makeAgent();
    agent.deps.userDataPath = dir;
    const item = await agent.readingListAdd({ url: 'https://d.com', html: '<html>D</html>' });
    const r = await agent.readingListOpen({ id: item.id });
    assert.strictEqual(r.ok, true);
    assert.ok(r.offlineUrl.startsWith('file://'));
  });

  await test('agent.readingListOpen: no snapshot → error', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-agent-openfail-'));
    const { agent } = makeAgent();
    agent.deps.userDataPath = dir;
    const item = await agent.readingListAdd({ url: 'https://nosnap.com', snapshot: false });
    const r = await agent.readingListOpen({ id: item.id });
    assert.strictEqual(r.ok, false);
    assert.ok(r.error.includes('no offline snapshot'));
  });

  console.log(`\nPASSED: ${passed}    FAILED: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
})();