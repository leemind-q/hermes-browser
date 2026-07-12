
// tests/cowork-v8.test.js — V20 git workflow patterns
const { CoworkService } = require('../src/agent/cowork');
const fs = require('fs');

(async () => {
  let pass = 0, fail = 0;
  const cw = new CoworkService({ workspaceRoot: '/home/taewoo/projects/hermes-browser' });
  const REPO = '/home/taewoo/projects/hermes-browser';

  // 1. gitDiffStat
  const stat = await cw.gitDiffStat({ dir: REPO });
  const okStat = stat.ok && stat.count > 0 && Array.isArray(stat.files);
  console.log((okStat ? '✅ PASS' : '❌ FAIL') + '  gitDiffStat returns per-file stats (count=' + stat.count + ')');
  if (okStat) pass++; else fail++;

  // 2. gitReleaseNotes MD
  const mdNotes = await cw.gitReleaseNotes({ dir: REPO, limit: 2, format: 'md' });
  const okMd = mdNotes.ok && mdNotes.notes && mdNotes.notes.includes('# Release Notes');
  console.log((okMd ? '✅ PASS' : '❌ FAIL') + '  gitReleaseNotes MD format');
  if (okMd) pass++; else fail++;

  // 3. gitReleaseNotes JSON
  const jsonNotes = await cw.gitReleaseNotes({ dir: REPO, limit: 2, format: 'json' });
  const okJson = jsonNotes.ok && Array.isArray(jsonNotes.commits) && jsonNotes.commits.length === 2;
  console.log((okJson ? '✅ PASS' : '❌ FAIL') + '  gitReleaseNotes JSON format');
  if (okJson) pass++; else fail++;

  // 4. gitChangelog auto-detect
  const cl = await cw.gitChangelog({ dir: REPO });
  const okCl = cl.ok && cl.range && cl.stats;
  console.log((okCl ? '✅ PASS' : '❌ FAIL') + '  gitChangelog auto-detect range');
  if (okCl) pass++; else fail++;

  // 5. gitAutoCommit with change (creates commit)
  fs.writeFileSync(REPO + '/_v20_test.txt', 'v20 test');
  const ac2 = await cw.gitAutoCommit({ dir: REPO, message: 'V20 test', files: ['_v20_test.txt'] });
  const okCommit = ac2.ok && ac2.committed === true && ac2.shortHash;
  console.log((okCommit ? '✅ PASS' : '❌ FAIL') + '  gitAutoCommit creates commit (shortHash=' + ac2.shortHash + ')');
  if (okCommit) pass++; else fail++;

  // 6. Cleanup
  try {
    const { execSync } = require('child_process');
    execSync('git reset --hard HEAD~1', { cwd: REPO });
    if (fs.existsSync(REPO + '/_v20_test.txt')) fs.unlinkSync(REPO + '/_v20_test.txt');
    console.log('✅ PASS  cleanup');
    pass++;
  } catch (e) {
    console.log('❌ FAIL  cleanup:', e.message);
    fail++;
  }

  // 7. _gitBin returns valid path
  const gitPath = cw._gitBin();
  const okBin = typeof gitPath === 'string' && gitPath.length > 0;
  console.log((okBin ? '✅ PASS' : '❌ FAIL') + '  _gitBin returns path (' + gitPath + ')');
  if (okBin) pass++; else fail++;

  // 8. _gitExec wrapper
  const execResult = await cw._gitExec(['--version'], REPO);
  const okExec = execResult.stdout.includes('git version');
  console.log((okExec ? '✅ PASS' : '❌ FAIL') + '  _gitExec wrapper (output: ' + execResult.stdout.slice(0, 30) + ')');
  if (okExec) pass++; else fail++;

  console.log('');
  console.log('PASSED: ' + pass + '    FAILED: ' + fail);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.log('ERROR:', e.message); process.exit(1); });
