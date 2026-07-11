
// tests/cowork-v6.test.js — V18 search-replace + autoLock + atomic
const { CoworkService } = require('../src/agent/cowork');
const fs = require('fs');

(async () => {
  let pass = 0, fail = 0;
  const tmp = '/tmp/_v18_' + Date.now();
  fs.mkdirSync(tmp + '/sub', { recursive: true });
  fs.writeFileSync(tmp + '/a.txt', 'foo bar\nfoo baz\nqux');
  fs.writeFileSync(tmp + '/sub/b.txt', 'foo foo');

  const cw = new CoworkService({ workspaceRoot: tmp });

  // 1. apply with autoLock — locks acquired + released
  const r1 = await cw.searchReplace({
    path: tmp, pattern: 'foo', replacement: 'FOO',
    glob: '*.txt', pretend: false, backup: true,
    autoLock: true, lockTtl: 5000, agentId: 'agent-test',
  });
  const okAutoLock = r1.ok && r1.locksAcquired === 2 && r1.changeSummary && r1.changeSummary.filesTouched === 2;
  console.log((okAutoLock ? '✅ PASS' : '❌ FAIL') + '  autoLock acquires 2 locks, changeSummary.filesTouched=' + (r1.changeSummary?.filesTouched));
  if (okAutoLock) pass++; else fail++;

  // 2. files changed + backup created
  const aChanged = fs.readFileSync(tmp + '/a.txt', 'utf8').includes('FOO');
  const backupExists = fs.existsSync(tmp + '/a.txt.bak');
  const okChanged = aChanged && backupExists;
  console.log((okChanged ? '✅ PASS' : '❌ FAIL') + '  files modified + backup exists');
  if (okChanged) pass++; else fail++;

  // 3. locks released after completion
  const locks = cw.listLocks();
  const okReleased = locks.ok && locks.count === 0;
  console.log((okReleased ? '✅ PASS' : '❌ FAIL') + '  locks released after completion (count=' + locks.count + ')');
  if (okReleased) pass++; else fail++;

  // 4. atomic mode with conflict — partial apply should rollback
  const conflictLock = await cw.acquireLock({ path: 'sub/b.txt', agentId: 'agent-blocker', ttl: 5000 });
  const r2 = await cw.searchReplace({
    path: tmp, pattern: 'foo', replacement: 'XXX',
    glob: '*.txt', pretend: false, autoLock: true, atomic: true, agentId: 'agent-2',
  });
  const okAtomic = r2.ok === false && r2.failures.length > 0;
  console.log((okAtomic ? '✅ PASS' : '❌ FAIL') + '  atomic mode aborts on conflict (failures=' + r2.failures.length + ')');
  if (okAtomic) pass++; else fail++;

  // 5. Verify NO files were modified in atomic mode (rollback)
  const aStillOriginal = fs.readFileSync(tmp + '/a.txt', 'utf8').includes('FOO') && !fs.readFileSync(tmp + '/a.txt', 'utf8').includes('XXX');
  console.log((aStillOriginal ? '✅ PASS' : '❌ FAIL') + '  atomic rollback — files unchanged');
  if (aStillOriginal) pass++; else fail++;

  // 6. changeSummary with different replacement (lines change)
  fs.writeFileSync(tmp + '/d.txt', 'foo\nfoo\nfoo');
  const r3 = await cw.searchReplace({
    path: tmp, pattern: 'foo', replacement: 'NEW\nNEW',
    glob: 'd.txt', pretend: false, autoLock: false,
  });
  const okSummary = r3.changeSummary && (r3.changeSummary.linesAdded > 0 || r3.changeSummary.linesRemoved > 0);
  console.log((okSummary ? '✅ PASS' : '❌ FAIL') + '  changeSummary lines tracked (added=' + r3.changeSummary?.linesAdded + ', removed=' + r3.changeSummary?.linesRemoved + ')');
  if (okSummary) pass++; else fail++;

  // 7. Non-atomic mode continues despite conflict
  fs.writeFileSync(tmp + '/e.txt', 'foo bar');
  const r4 = await cw.searchReplace({
    path: tmp, pattern: 'foo', replacement: 'YYY',
    glob: '*.txt', pretend: false, autoLock: true, atomic: false, agentId: 'agent-3',
  });
  // Non-atomic: should still process some files
  const okNonAtomic = r4.filesScanned > 0;
  console.log((okNonAtomic ? '✅ PASS' : '❌ FAIL') + '  non-atomic mode processes files (scanned=' + r4.filesScanned + ')');
  if (okNonAtomic) pass++; else fail++;

  // Cleanup
  cw.releaseLock({ path: 'sub/b.txt', token: conflictLock.token });
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log('');
  console.log('PASSED: ' + pass + '    FAILED: ' + fail);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.log('ERROR:', e.message); process.exit(1); });
