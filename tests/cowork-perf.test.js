
// Cowork V13 performance test
const { CoworkService } = require('../src/agent/cowork');

(async () => {
  let pass = 0, fail = 0;

  const cw = new CoworkService({ workspaceRoot: '/tmp' });
  await cw.listDir({ dir: '/tmp', pattern: '*.log' });
  const r2 = await cw.listDir({ dir: '/tmp', pattern: '*.log' });
  const okCached = r2.cached === true;
  console.log((okCached ? '✅ PASS' : '❌ FAIL') + '  cached=true on second call');
  if (okCached) pass++; else fail++;

  cw.invalidateCache();
  const r3 = await cw.listDir({ dir: '/tmp', pattern: '*.log' });
  const okFresh = r3.cached === false;
  console.log((okFresh ? '✅ PASS' : '❌ FAIL') + '  cached=false after invalidate (was undefined pre-fix)');
  if (okFresh) pass++; else fail++;

  // fileStat
  const fs = require('fs');
  fs.writeFileSync('/tmp/_cowork_test.txt', 'test content');
  const r4 = await cw.fileStat({ path: '/tmp/_cowork_test.txt' });
  const okStat = r4.ok && r4.size > 0;
  console.log((okStat ? '✅ PASS' : '❌ FAIL') + '  fileStat valid');
  if (okStat) pass++; else fail++;
  fs.unlinkSync('/tmp/_cowork_test.txt');

  // Stat cache
  await cw.fileStat({ path: '/tmp/_cowork_test.txt' });
  const cacheField = cw._statCache instanceof Map;
  console.log((cacheField ? '✅ PASS' : '❌ FAIL') + '  statCache Map exists');
  if (cacheField) pass++; else fail++;

  console.log('');
  console.log('PASSED: ' + pass + '    FAILED: ' + fail);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.log('ERROR:', e.message); process.exit(1); });
