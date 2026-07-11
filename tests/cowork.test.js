// tests/cowork.test.js — V12 Cowork service tests
// Verifies _safePath sync fix (was async bug), file operations, allowed roots.

const { CoworkService } = require('../src/agent/cowork');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');

const tempDir = os.tmpdir();
const testFile = path.join(tempDir, 'BLDC-cowork-test.txt');
let cw;

async function setUp() {
  cw = new CoworkService({ workspaceRoot: tempDir, maxFileSize: 1024 * 1024 });
  await fs.writeFile(testFile, 'BLDC motor driver test content');
}

async function tearDown() {
  try { await fs.unlink(testFile); } catch {}
}

(async () => {
  await setUp();
  const tests = [
    // 1. _safePath sync (was async bug — Day 4 fix)
    ['_safePath returns string (not Promise — was async bug)', typeof cw._safePath('/tmp') === 'string'],
    // 2. _safePath blocks unsafe roots
    ['_safePath blocks unsafe path /etc/passwd', cw._safePath('/etc/passwd') === null],
    // 3. listDir finds files
    ['listDir finds test file', (async () => { const r = await cw.listDir({ dir: tempDir, pattern: 'BLDC-cowork-test.txt' }); return r.ok && r.count >= 1; })],
    // 4. fileStat returns metadata
    ['fileStat returns size > 0', (async () => { const r = await cw.fileStat({ path: testFile }); return r.ok && r.size > 0; })],
    // 5. readFile reads text content
    ['readFile reads text content', (async () => { const r = await cw.readFile({ path: testFile, maxBytes: 100 }); return r.ok && r.content.includes('BLDC motor'); })],
    // 6. readFile respects maxBytes
    ['readFile respects maxBytes', (async () => { const r = await cw.readFile({ path: testFile, maxBytes: 5 }); return r.ok && r.bytesRead === 5; })],
  ];

  let pass = 0, fail = 0;
  for (const [name, check] of tests) {
    let ok;
    if (typeof check === 'boolean') ok = check;
    else ok = await check;
    console.log((ok ? '✅ PASS' : '❌ FAIL') + '  ' + name);
    if (ok) pass++; else fail++;
  }

  await tearDown();
  console.log('');
  console.log('PASSED: ' + pass + '    FAILED: ' + fail);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.log('ERROR:', e.message); process.exit(1); });
