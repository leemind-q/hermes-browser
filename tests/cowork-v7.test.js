
// tests/cowork-v7.test.js — V19 git workflow
const { CoworkService } = require('../src/agent/cowork');
const fs = require('fs');
const { execSync } = require('child_process');

(async () => {
  let pass = 0, fail = 0;
  const cw = new CoworkService({ workspaceRoot: '/home/taewoo/projects/hermes-browser' });
  const REPO = '/home/taewoo/projects/hermes-browser';

  // 1. gitBranch.list
  const list = await cw.gitBranch({ path: REPO, action: 'list' });
  const okList = list.ok && list.count >= 1 && list.branches.find(b => b.name === 'main' && b.current);
  console.log((okList ? '✅ PASS' : '❌ FAIL') + '  gitBranch.list shows main as current');
  if (okList) pass++; else fail++;

  // 2. gitBranch.list remote
  const remote = await cw.gitBranch({ path: REPO, action: 'list', remote: true });
  const okRemote = remote.ok && remote.branches.some(b => b.name.includes('origin/main') || b.name.includes('main'));
  console.log((okRemote ? '✅ PASS' : '❌ FAIL') + '  gitBranch.list remote shows main');
  if (okRemote) pass++; else fail++;

  // 3. gitBranch.create
  const create = await cw.gitBranch({ path: REPO, action: 'create', name: 'v19-test-branch' });
  const okCreate = create.ok && create.name === 'v19-test-branch';
  console.log((okCreate ? '✅ PASS' : '❌ FAIL') + '  gitBranch.create creates branch');
  if (okCreate) pass++; else fail++;

  // 4. gitCheckout to new branch
  const checkout = await cw.gitCheckout({ dir: REPO, branch: 'v19-test-branch' });
  const okCheckout = checkout.ok && checkout.branch === 'v19-test-branch';
  console.log((okCheckout ? '✅ PASS' : '❌ FAIL') + '  gitCheckout switches to branch');
  if (okCheckout) pass++; else fail++;

  // 5. gitCheckout back to main
  const back = await cw.gitCheckout({ dir: REPO, branch: 'main' });
  const okBack = back.ok && back.branch === 'main';
  console.log((okBack ? '✅ PASS' : '❌ FAIL') + '  gitCheckout back to main');
  if (okBack) pass++; else fail++;

  // 6. gitBranch.delete force
  const del = await cw.gitBranch({ path: REPO, action: 'delete', name: 'v19-test-branch', force: true });
  const okDel = del.ok && del.action === 'delete';
  console.log((okDel ? '✅ PASS' : '❌ FAIL') + '  gitBranch.delete force');
  if (okDel) pass++; else fail++;

  // 7. gitCommit with file
  // Make a small change first
  const testFile = REPO + '/_v19_test.txt';
  fs.writeFileSync(testFile, 'v19 test content');
  const commit = await cw.gitCommit({
    message: 'V19 test commit',
    dir: REPO,
    files: ['_v19_test.txt'],
  });
  const okCommit = commit.ok && commit.shortHash && commit.message === 'V19 test commit';
  console.log((okCommit ? '✅ PASS' : '❌ FAIL') + '  gitCommit creates commit (shortHash=' + commit.shortHash + ')');
  if (okCommit) pass++; else fail++;

  // 8. Cleanup: revert the test commit
  try {
    execSync('git reset --hard HEAD~1', { cwd: REPO });
    console.log('✅ PASS  reverted test commit');
    pass++;
  } catch (e) {
    console.log('❌ FAIL  revert failed:', e.message);
    fail++;
  }
  if (fs.existsSync(testFile)) fs.unlinkSync(testFile);

  console.log('');
  console.log('PASSED: ' + pass + '    FAILED: ' + fail);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.log('ERROR:', e.message); process.exit(1); });
