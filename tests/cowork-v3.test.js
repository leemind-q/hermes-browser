
// tests/cowork-v3.test.js — V15 Cowork v3 streaming
const { CoworkService } = require('../src/agent/cowork');
const fs = require('fs');
const os = require('os');
const path = require('path');

(async () => {
  let pass = 0, fail = 0;
  const tmpDir = '/tmp/_cw_v3_' + Date.now();
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(tmpDir + '/sample.txt', 'initial');
  const cw = new CoworkService({ workspaceRoot: '/tmp' });

  // 1. watchList returns empty initially
  const list1 = await cw.watchList();
  const okEmpty = list1.ok && Array.isArray(list1.watchers);
  console.log((okEmpty ? '✅ PASS' : '❌ FAIL') + '  watchList returns ok=true with array');
  if (okEmpty) pass++; else fail++;

  // 2. Create watcher
  const w = await cw.watch({ path: tmpDir, pattern: '*.txt' });
  const okWatch = w.ok && w.watcherId && w.dir;
  console.log((okWatch ? '✅ PASS' : '❌ FAIL') + '  watch creates watcher with ID');
  if (okWatch) pass++; else fail++;

  // 3. Modify file → wait for event
  fs.writeFileSync(tmpDir + '/sample.txt', 'modified content');
  await new Promise(r => setTimeout(r, 600)); // wait for debounce (200ms) + processing
  const events = await cw.watchEvents({ watcherId: w.watcherId });
  const okEvents = events.ok && events.total > 0;
  console.log((okEvents ? '✅ PASS' : '❌ FAIL') + '  watch captures file modification (' + events.total + ' events)');
  if (okEvents) pass++; else fail++;

  // 4. Create another file
  fs.writeFileSync(tmpDir + '/new.txt', 'new file');
  await new Promise(r => setTimeout(r, 600));
  const events2 = await cw.watchEvents({ watcherId: w.watcherId, since: events.total });
  const okMoreEvents = events2.ok && events2.events.length > 0;
  console.log((okMoreEvents ? '✅ PASS' : '❌ FAIL') + '  new file detected, "since" cursor works (' + events2.events.length + ' new)');
  if (okMoreEvents) pass++; else fail++;

  // 5. watchList now shows 1 watcher
  const list2 = await cw.watchList();
  const okListed = list2.ok && list2.watchers.length >= 1 && list2.watchers[0].eventCount >= 2;
  console.log((okListed ? '✅ PASS' : '❌ FAIL') + '  watchList shows active watcher with events');
  if (okListed) pass++; else fail++;

  // 6. Unsubscribe
  const unsub = await cw.watchUnsubscribe({ watcherId: w.watcherId });
  const okUnsub = unsub.ok && unsub.eventsDelivered >= 2;
  console.log((okUnsub ? '✅ PASS' : '❌ FAIL') + '  watchUnsubscribe returns event count');
  if (okUnsub) pass++; else fail++;

  // 7. Watcher is gone from list
  const list3 = await cw.watchList();
  const okGone = list3.ok && !list3.watchers.find(x => x.watcherId === w.watcherId);
  console.log((okGone ? '✅ PASS' : '❌ FAIL') + '  unsubscribed watcher removed from list');
  if (okGone) pass++; else fail++;

  // 8. Unsubscribe non-existent watcher returns 404
  const unsub404 = await cw.watchUnsubscribe({ watcherId: 'non-existent' });
  const ok404 = !unsub404.ok && unsub404.error.includes('not found');
  console.log((ok404 ? '✅ PASS' : '❌ FAIL') + '  unsubscribe non-existent watcher returns not found');
  if (ok404) pass++; else fail++;

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log('');
  console.log('PASSED: ' + pass + '    FAILED: ' + fail);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.log('ERROR:', e.message); process.exit(1); });
