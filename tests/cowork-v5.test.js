
// tests/cowork-v5.test.js — V17 multi-agent concurrency (WSL paths)
const { CoworkService } = require('../src/agent/cowork');

(async () => {
  let pass = 0, fail = 0;
  const cw = new CoworkService({ workspaceRoot: '/mnt/c/Users/qqwer/Hermes-Workspace' });

  const l1 = await cw.acquireLock({ path: 'demo-circuits/BD69730FV-FanDriver-v1.0/bom/BOM.csv', agentId: 'agent-A', ttl: 5000 });
  const okLock = l1.ok && l1.token;
  console.log((okLock ? '✅ PASS' : '❌ FAIL') + '  acquireLock returns valid token: ' + JSON.stringify(l1));
  if (okLock) pass++; else fail++;

  if (!okLock) {
    console.log('');
    console.log('PASSED: ' + pass + '    FAILED: ' + fail);
    process.exit(1);
  }

  const lst = cw.listLocks();
  const okList = lst.ok && lst.count >= 1;
  console.log((okList ? '✅ PASS' : '❌ FAIL') + '  listLocks shows active lock (count=' + lst.count + ')');
  if (okList) pass++; else fail++;

  const l2 = await cw.acquireLock({ path: 'demo-circuits/BD69730FV-FanDriver-v1.0/bom/BOM.csv', agentId: 'agent-B' });
  const okConflict = !l2.ok && l2.error === 'locked';
  console.log((okConflict ? '✅ PASS' : '❌ FAIL') + '  second acquireLock returns locked error');
  if (okConflict) pass++; else fail++;

  const r1 = cw.releaseLock({ path: 'demo-circuits/BD69730FV-FanDriver-v1.0/bom/BOM.csv', token: 'wrong' });
  const okWrong = !r1.ok && r1.error === 'token mismatch';
  console.log((okWrong ? '✅ PASS' : '❌ FAIL') + '  releaseLock with wrong token returns token mismatch');
  if (okWrong) pass++; else fail++;

  const r2 = cw.releaseLock({ path: 'demo-circuits/BD69730FV-FanDriver-v1.0/bom/BOM.csv', token: l1.token });
  const okRel = r2.ok;
  console.log((okRel ? '✅ PASS' : '❌ FAIL') + '  releaseLock with correct token succeeds');
  if (okRel) pass++; else fail++;

  const l3 = await cw.acquireLock({ path: 'demo-circuits/BD69730FV-FanDriver-v1.0/bom/BOM.csv', agentId: 'agent-B' });
  const okRelock = l3.ok;
  console.log((okRelock ? '✅ PASS' : '❌ FAIL') + '  after release, new acquireLock succeeds');
  if (okRelock) pass++; else fail++;
  cw.releaseLock({ path: 'demo-circuits/BD69730FV-FanDriver-v1.0/bom/BOM.csv', token: l3.token });

  const lease1 = await cw.acquireLease({ leaseName: 'cowork-edit', agentId: 'agent-A', ttl: 5000 });
  const lease2 = await cw.acquireLease({ leaseName: 'cowork-edit', agentId: 'agent-B' });
  const okLease = lease1.ok && !lease2.ok && lease2.holder === 'agent-A';
  console.log((okLease ? '✅ PASS' : '❌ FAIL') + '  acquireLease prevents concurrent holder');
  if (okLease) pass++; else fail++;

  const rel = cw.releaseLease({ leaseName: 'cowork-edit', agentId: 'agent-A' });
  const okLeaseRel = rel.ok;
  console.log((okLeaseRel ? '✅ PASS' : '❌ FAIL') + '  releaseLease with owner agentId succeeds');
  if (okLeaseRel) pass++; else fail++;

  cw.enqueueTask({ agentId: 'agent-X', task: { action: 'low' }, priority: 1 });
  cw.enqueueTask({ agentId: 'agent-X', task: { action: 'high' }, priority: 10 });
  cw.enqueueTask({ agentId: 'agent-X', task: { action: 'mid' }, priority: 5 });
  const deq = cw.dequeueTask({ agentId: 'agent-X', max: 3 });
  const okQueue = deq.ok && deq.tasks.length === 3 && deq.tasks[0].task.action === 'high' && deq.tasks[1].task.action === 'mid';
  console.log((okQueue ? '✅ PASS' : '❌ FAIL') + '  task queue priority-sorted');
  if (okQueue) pass++; else fail++;

  cw.setSharedState({ key: 'last-edit', value: { file: 'BOM.csv', by: 'agent-A' }, agentId: 'agent-A' });
  cw.setSharedState({ key: 'progress', value: 42, agentId: 'agent-A' });
  const state2 = cw.getSharedState({});
  const okState = state2.ok && state2.count >= 2;
  console.log((okState ? '✅ PASS' : '❌ FAIL') + '  shared state set/get works');
  if (okState) pass++; else fail++;

  console.log('');
  console.log('PASSED: ' + pass + '    FAILED: ' + fail);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.log('ERROR:', e.message); process.exit(1); });
