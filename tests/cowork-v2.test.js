
// tests/cowork-v2.test.js — V14 Cowork v2 methods
const { CoworkService } = require('../src/agent/cowork');
const fs = require('fs');
const os = require('os');

(async () => {
  let pass = 0, fail = 0;
  const cw = new CoworkService({ workspaceRoot: os.tmpdir() });

  // 1. watch method exists
  console.log((typeof cw.watch === 'function' ? '✅ PASS' : '❌ FAIL') + '  watch() method exists');
  if (typeof cw.watch === 'function') pass++; else fail++;

  // 2. readTail method exists
  console.log((typeof cw.readTail === 'function' ? '✅ PASS' : '❌ FAIL') + '  readTail() method exists');
  if (typeof cw.readTail === 'function') pass++; else fail++;

  // 3. diff method exists
  console.log((typeof cw.diff === 'function' ? '✅ PASS' : '❌ FAIL') + '  diff() method exists');
  if (typeof cw.diff === 'function') pass++; else fail++;

  // 4. searchReplace method exists
  console.log((typeof cw.searchReplace === 'function' ? '✅ PASS' : '❌ FAIL') + '  searchReplace() method exists');
  if (typeof cw.searchReplace === 'function') pass++; else fail++;

  // 5. diff between two tmp files
  const path1 = '/tmp/_diff_a.txt';
  const path2 = '/tmp/_diff_b.txt';
  fs.writeFileSync(path1, 'line1\nline2\nline3\n');
  fs.writeFileSync(path2, 'line1\nline2-changed\nline3\nline4\n');
  const d = await cw.diff({ path: path1, path2: path2 });
  const okDiff = d.ok && d.same >= 1 && (d.added + d.removed) >= 1;
  console.log((okDiff ? '✅ PASS' : '❌ FAIL') + '  diff result has same/added/removed (' + d.same + '/' + d.added + '/' + d.removed + ')');
  if (okDiff) pass++; else fail++;
  fs.unlinkSync(path1);
  fs.unlinkSync(path2);

  // 6. readTail returns content
  const path3 = '/tmp/_tail.txt';
  fs.writeFileSync(path3, 'a\nb\nc\nd\ne\nf\ng\n');
  const t = await cw.readTail({ path: path3, lines: 3 });
  const okTail = t.ok && t.content.includes('g') && !t.content.includes('a');
  console.log((okTail ? '✅ PASS' : '❌ FAIL') + '  readTail returns last N lines');
  if (okTail) pass++; else fail++;
  fs.unlinkSync(path3);

  // 7. searchReplace preview mode
  fs.writeFileSync('/tmp/_sr.txt', 'foo bar baz foo qux');
  const sr = await cw.searchReplace({
    path: '/tmp',
    pattern: 'foo',
    replacement: 'FOO',
    glob: '*.txt',
    pretend: true,
  });
  const okSr = sr.ok && sr.mode === 'preview' && sr.matches.length > 0;
  console.log((okSr ? '✅ PASS' : '❌ FAIL') + '  searchReplace preview mode (no file modification)');
  if (okSr) pass++; else fail++;
  // Verify file unchanged
  const stillSame = fs.readFileSync('/tmp/_sr.txt', 'utf8') === 'foo bar baz foo qux';
  console.log((stillSame ? '✅ PASS' : '❌ FAIL') + '  pretend did not modify file');
  if (stillSame) pass++; else fail++;
  fs.unlinkSync('/tmp/_sr.txt');

  console.log('');
  console.log('PASSED: ' + pass + '    FAILED: ' + fail);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.log('ERROR:', e.message); process.exit(1); });
