// tests/autofill-form.test.js — Unit tests for autofillForm + credential integration

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { AgentService } = require('../src/agent');
const { CredentialVault } = require('../src/agent/credentials');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-autofill-'));

function makeFakeView(dom = {}) {
  // dom = { username: { ref, id }, password: { ref, id } }
  const detectResult = [];
  if (dom.username) detectResult.push({ role: 'username', id: dom.username.id || 'u', name: 'username', type: 'text', ref: dom.username.ref || 'ref-u', value: '' });
  if (dom.password) detectResult.push({ role: 'password', id: dom.password.id || 'p', name: 'password', type: 'password', ref: dom.password.ref || 'ref-p', value: '' });
  if (dom.email)    detectResult.push({ role: 'email',    id: dom.email.id    || 'e', name: 'email',    type: 'email', ref: dom.email.ref    || 'ref-e', value: '' });

  return {
    webContents: {
      loadURL: () => {},
      getURL: () => 'https://example.com/login',
      executeJavaScript: async (code) => {
        if (code.includes('offsetParent') || code.includes('data-hermesRef')) {
          return detectResult;
        }
        if (code.includes('cred =')) {
          // Fill script — return what got filled (mock)
          return detectResult.map(f => ({ ref: f.ref, role: f.role, value: '***' }));
        }
        return null;
      },
    },
  };
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ PASS  ${name}`); passed++; }
  catch (e) { console.log(`  ❌ FAIL  ${name}: ${e.message}`); failed++; }
}

(async () => {
  console.log('========== [Autofill form] ==========');

  await test('No active tab → error', async () => {
    const agent = new AgentService({
      send: () => true,
      getTabs: () => [],
      getActiveTab: () => null,
      getActiveView: () => null,
      getAutoApprove: () => true,
      createTab: () => null, switchTab: () => true, closeTab: () => true,
      waitForLoad: async () => {}, goBack: () => {}, goForward: () => {},
      normalizeUrl: (s) => s, notifyAll: () => {}, userDataPath: TMP_DIR,
    });
    const r = await agent.autofillForm();
    assert.strictEqual(r.ok, false);
    assert.ok(r.error.includes('No active tab'));
  });

  await test('No credential saved → error with hint', async () => {
    const view = makeFakeView({ username: {}, password: {} });
    const tab = { id: 1, url: 'https://example.com/login', view };
    const agent = new AgentService({
      send: () => true,
      getTabs: () => [tab],
      getActiveTab: () => tab,
      getActiveView: () => view,
      getAutoApprove: () => true,
      createTab: () => null, switchTab: () => true, closeTab: () => true,
      waitForLoad: async () => {}, goBack: () => {}, goForward: () => {},
      normalizeUrl: (s) => s, notifyAll: () => {}, userDataPath: TMP_DIR,
    });
    agent.credentials = new CredentialVault({ userDataPath: TMP_DIR });
    const r = await agent.autofillForm();
    assert.strictEqual(r.ok, false);
    assert.ok(r.error.includes('No saved credential'));
    assert.ok(r.error.includes('example.com'));
  });

  await test('Credential exists, fields detected → fill both', async () => {
    const view = makeFakeView({ username: {}, password: {} });
    const tab = { id: 1, url: 'https://example.com/login', view };
    const agent = new AgentService({
      send: () => true,
      getTabs: () => [tab],
      getActiveTab: () => tab,
      getActiveView: () => view,
      getAutoApprove: () => true,
      createTab: () => null, switchTab: () => true, closeTab: () => true,
      waitForLoad: async () => {}, goBack: () => {}, goForward: () => {},
      normalizeUrl: (s) => s, notifyAll: () => {}, userDataPath: TMP_DIR,
    });
    agent.credentials = new CredentialVault({ userDataPath: TMP_DIR });
    agent.credentials.save('example.com', 'myuser', 'mypass');

    const r = await agent.autofillForm();
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.filledCount, 2);
    assert.deepStrictEqual(r.filled.map(f => f.role).sort(), ['password', 'username']);
    assert.strictEqual(r.detectedFields, 2);
  });

  await test('No autofillable fields → ok with message', async () => {
    const view = makeFakeView({});  // no fields
    const tab = { id: 1, url: 'https://example.com', view };
    const agent = new AgentService({
      send: () => true,
      getTabs: () => [tab],
      getActiveTab: () => tab,
      getActiveView: () => view,
      getAutoApprove: () => true,
      createTab: () => null, switchTab: () => true, closeTab: () => true,
      waitForLoad: async () => {}, goBack: () => {}, goForward: () => {},
      normalizeUrl: (s) => s, notifyAll: () => {}, userDataPath: TMP_DIR,
    });
    agent.credentials = new CredentialVault({ userDataPath: TMP_DIR });
    const r = await agent.autofillForm();
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.filledCount, 0);
    assert.ok(r.message.includes('No autofillable fields'));
  });

  await test('Different domain → no credential match', async () => {
    const view = makeFakeView({ username: {}, password: {} });
    view.webContents.getURL = () => 'https://other.com/login';
    const tab = { id: 1, url: 'https://other.com/login', view };
    const agent = new AgentService({
      send: () => true,
      getTabs: () => [tab],
      getActiveTab: () => tab,
      getActiveView: () => view,
      getAutoApprove: () => true,
      createTab: () => null, switchTab: () => true, closeTab: () => true,
      waitForLoad: async () => {}, goBack: () => {}, goForward: () => {},
      normalizeUrl: (s) => s, notifyAll: () => {}, userDataPath: TMP_DIR,
    });
    agent.credentials = new CredentialVault({ userDataPath: TMP_DIR });
    agent.credentials.save('example.com', 'myuser', 'mypass');  // different domain
    const r = await agent.autofillForm();
    assert.strictEqual(r.ok, false);
    assert.ok(r.error.includes('No saved credential for other.com'));
  });

  await test('www. prefix stripped from domain match', async () => {
    const view = makeFakeView({ username: {}, password: {} });
    view.webContents.getURL = () => 'https://www.example.com/login';  // www prefix
    const tab = { id: 1, url: 'https://www.example.com/login', view };
    const agent = new AgentService({
      send: () => true,
      getTabs: () => [tab],
      getActiveTab: () => tab,
      getActiveView: () => view,
      getAutoApprove: () => true,
      createTab: () => null, switchTab: () => true, closeTab: () => true,
      waitForLoad: async () => {}, goBack: () => {}, goForward: () => {},
      normalizeUrl: (s) => s, notifyAll: () => {}, userDataPath: TMP_DIR,
    });
    agent.credentials = new CredentialVault({ userDataPath: TMP_DIR });
    agent.credentials.save('example.com', 'myuser', 'mypass');
    const r = await agent.autofillForm();
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.filledCount, 2);
  });

  await test('Email-only form (no username field) fills email', async () => {
    const view = makeFakeView({ email: {} });
    const tab = { id: 1, url: 'https://example.com/login', view };
    const agent = new AgentService({
      send: () => true,
      getTabs: () => [tab],
      getActiveTab: () => tab,
      getActiveView: () => view,
      getAutoApprove: () => true,
      createTab: () => null, switchTab: () => true, closeTab: () => true,
      waitForLoad: async () => {}, goBack: () => {}, goForward: () => {},
      normalizeUrl: (s) => s, notifyAll: () => {}, userDataPath: TMP_DIR,
    });
    agent.credentials = new CredentialVault({ userDataPath: TMP_DIR });
    agent.credentials.save('example.com', 'myuser', 'mypass');
    const r = await agent.autofillForm();
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.filledCount, 1);
    assert.strictEqual(r.filled[0].role, 'email');
  });

  console.log(`\nPASSED: ${passed}    FAILED: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
})();