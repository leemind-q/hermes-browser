// tests/credentials.test.js — CredentialVault unit tests (no Electron required)
// Uses the PLAIN: fallback mode (base64) when safeStorage is not available.

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { CredentialVault } = require('../src/agent/credentials');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✅ PASS  ${name}`); passed++; }
  catch (e) { console.log(`  ❌ FAIL  ${name}: ${e.message}`); failed++; }
}

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cred-'));

console.log('\n[CredentialVault — basic CRUD]');
test('save + get roundtrip', () => {
  const v = new CredentialVault({ userDataPath: tmpdir() });
  v.save('naver.com', 'user@naver.com', 'secret123');
  const cred = v.get('naver.com');
  assert.strictEqual(cred.username, 'user@naver.com');
  assert.strictEqual(cred.password, 'secret123');
  assert.ok(cred.savedAt);
});

test('get returns null for unknown domain', () => {
  const v = new CredentialVault({ userDataPath: tmpdir() });
  assert.strictEqual(v.get('nonexistent.com'), null);
});

test('save replaces existing credential', () => {
  const v = new CredentialVault({ userDataPath: tmpdir() });
  v.save('naver.com', 'old', 'oldpass');
  v.save('naver.com', 'new', 'newpass');
  const cred = v.get('naver.com');
  assert.strictEqual(cred.username, 'new');
  assert.strictEqual(cred.password, 'newpass');
});

test('list never exposes password', () => {
  const v = new CredentialVault({ userDataPath: tmpdir() });
  v.save('naver.com', 'u1', 'p1');
  v.save('google.com', 'u2', 'p2');
  const list = v.list();
  assert.strictEqual(list.length, 2);
  for (const item of list) {
    assert.ok(!('password' in item), `list entry must not contain password: ${JSON.stringify(item)}`);
    assert.ok(['username', 'domain', 'savedAt'].every(k => k in item));
  }
});

test('remove deletes credential', () => {
  const v = new CredentialVault({ userDataPath: tmpdir() });
  v.save('naver.com', 'u', 'p');
  const r = v.remove('naver.com');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(v.get('naver.com'), null);
});

test('remove unknown domain returns error', () => {
  const v = new CredentialVault({ userDataPath: tmpdir() });
  const r = v.remove('never-existed.com');
  assert.strictEqual(r.ok, false);
});

test('save rejects empty fields', () => {
  const v = new CredentialVault({ userDataPath: tmpdir() });
  assert.strictEqual(v.save('', 'u', 'p').ok, false);
  assert.strictEqual(v.save('d.com', '', 'p').ok, false);
  assert.strictEqual(v.save('d.com', 'u', null).ok, false);
});

console.log('\n[CredentialVault — persistence]');
test('credentials persist across instances', () => {
  const dir = tmpdir();
  const v1 = new CredentialVault({ userDataPath: dir });
  v1.save('naver.com', 'persistuser', 'persistpass');
  const v2 = new CredentialVault({ userDataPath: dir });
  const cred = v2.get('naver.com');
  assert.strictEqual(cred.username, 'persistuser');
  assert.strictEqual(cred.password, 'persistpass');
});

test('encrypted file exists on disk', () => {
  const dir = tmpdir();
  const v = new CredentialVault({ userDataPath: dir });
  v.save('naver.com', 'u', 'p');
  assert.ok(fs.existsSync(path.join(dir, 'credentials.enc')));
});

console.log('\n[CredentialVault — autofill security]');
test('shouldAutofill returns null in ask mode', () => {
  const v = new CredentialVault({ userDataPath: tmpdir() });
  v.save('naver.com', 'u', 'p');
  const r = v.shouldAutofill({
    mode: 'ask',
    action: 'fill',
    currentUrl: 'https://naver.com/login',
    params: { ref: 'password' },
  });
  assert.strictEqual(r, null);
});

test('shouldAutofill returns null for non-fill action', () => {
  const v = new CredentialVault({ userDataPath: tmpdir() });
  v.save('naver.com', 'u', 'p');
  const r = v.shouldAutofill({
    mode: 'agent',
    action: 'click',
    currentUrl: 'https://naver.com/login',
    params: { ref: 'password' },
  });
  assert.strictEqual(r, null);
});

test('shouldAutofill returns null for wrong domain', () => {
  const v = new CredentialVault({ userDataPath: tmpdir() });
  v.save('naver.com', 'u', 'p');
  const r = v.shouldAutofill({
    mode: 'agent',
    action: 'fill',
    currentUrl: 'https://google.com/login',
    params: { ref: 'password' },
  });
  assert.strictEqual(r, null);
});

test('shouldAutofill returns null for non-credential field', () => {
  const v = new CredentialVault({ userDataPath: tmpdir() });
  v.save('naver.com', 'u', 'p');
  const r = v.shouldAutofill({
    mode: 'agent',
    action: 'fill',
    currentUrl: 'https://naver.com/search',
    params: { ref: 'search-input' },
  });
  assert.strictEqual(r, null);
});

test('shouldAutofill succeeds when all conditions met', () => {
  const v = new CredentialVault({ userDataPath: tmpdir() });
  v.save('naver.com', 'autouser', 'autopass');
  const r = v.shouldAutofill({
    mode: 'agent',
    action: 'fill',
    currentUrl: 'https://naver.com/login',
    params: { ref: 'password', selector: 'input[type=password]' },
  });
  assert.ok(r);
  assert.strictEqual(r.username, 'autouser');
  assert.strictEqual(r.password, 'autopass');
});

test('shouldAutofill handles www subdomain', () => {
  const v = new CredentialVault({ userDataPath: tmpdir() });
  v.save('naver.com', 'u', 'p');
  const r = v.shouldAutofill({
    mode: 'auto',
    action: 'type',
    currentUrl: 'https://www.naver.com/login',
    params: { ref: 'email' },
  });
  assert.ok(r);
  assert.strictEqual(r.username, 'u');
});

console.log(`\n========================================`);
console.log(`PASSED: ${passed}    FAILED: ${failed}`);
console.log(`========================================`);
process.exit(failed === 0 ? 0 : 1);