// src/agent/credentials.js — Secure credential vault for login-required sites.
//
// BrowserOS / Aside / Comet ALL share the same weakness: they can't act on
// sites that require login because they have no place to store credentials
// safely. Hermes Browser uses Electron's `safeStorage` (OS-level encryption)
// + per-domain scoping so the agent can:
//
//   1. Save: user enters credential once via the inline UI
//             → encrypted with OS keychain
//             → stored in our userData/credentials.enc
//   2. Fill: agent hits a login form on a known domain
//             → looks up credential for that domain
//             → autofills via browser_fill action (the agent NEVER sees the plaintext)
//
// SECURITY MODEL:
//   - Plaintext credentials NEVER leave the agent process except to fill a form.
//   - The `safeStorage` uses Windows DPAPI / macOS Keychain / Linux libsecret.
//   - Per-domain scoping: a credential for naver.com can't be used on google.com.
//   - Audit log: every credential use is recorded in actionLog.
//   - User can revoke any credential at any time.

const fs = require('fs');
const path = require('path');
const { maskSecrets } = require('./safety');

// safeStorage is only available when running inside Electron. For unit tests
// and for the MCP-server path (which runs as plain Node) we fall back to
// base64 + a marker so tests can run without Electron.
let safeStorage;
try { safeStorage = require('electron').safeStorage; }
catch { safeStorage = null; }

/**
 * CredentialVault — encrypts and stores { domain → { username, password } }
 * Credentials are written as a single encrypted JSON blob to userData/credentials.enc
 *
 * @param {object} deps
 * @param {string} deps.userDataPath  - where to persist the encrypted file
 */
class CredentialVault {
  constructor({ userDataPath }) {
    if (!userDataPath) throw new Error('CredentialVault: userDataPath required');
    this.filePath = path.join(userDataPath, 'credentials.enc');
    this.cache = null;  // decrypted in-memory cache; re-loaded on save
  }

  _readEncrypted() {
    if (!fs.existsSync(this.filePath)) return {};
    try {
      const buf = fs.readFileSync(this.filePath);
      if (safeStorage?.isEncryptionAvailable?.()) {
        const plaintext = safeStorage.decryptString(buf);
        return JSON.parse(plaintext);
      }
      // Fallback: base64 — only for tests / non-Electron environments
      const decoded = Buffer.from(buf.toString('utf8'), 'base64').toString('utf8');
      // Marker check: only decode if it's our fallback format
      if (!decoded.startsWith('PLAIN:')) return {};
      return JSON.parse(decoded.slice(6));
    } catch (e) {
      console.warn('[CredentialVault] read failed:', e.message);
      return {};
    }
  }

  _writeEncrypted(data) {
    const json = JSON.stringify(data, null, 2);
    let buf;
    if (safeStorage?.isEncryptionAvailable?.()) {
      buf = safeStorage.encryptString(json);
    } else {
      // Fallback for tests: PLAIN: prefix + base64 (NOT SECURE — for dev/test only)
      buf = Buffer.from('PLAIN:' + json, 'utf8').toString('base64');
    }
    // Atomic write: write to .tmp then rename so we never half-write credentials
    const tmp = this.filePath + '.tmp';
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, this.filePath);
  }

  /**
   * Save (or replace) credentials for a domain. Returns { ok: true, domain }.
   */
  save(domain, username, password) {
    if (!domain || !username || password == null) {
      return { ok: false, error: 'domain, username, password required' };
    }
    const data = this._readEncrypted();
    data[domain] = { username, password, savedAt: new Date().toISOString() };
    this._writeEncrypted(data);
    this.cache = data;
    return { ok: true, domain };
  }

  /**
   * Retrieve credentials for a domain. Returns the raw { username, password }
   * — caller MUST NOT log or broadcast this. Use it directly to fill a form.
   *
   * Returns null if no credential exists.
   */
  get(domain) {
    if (!domain) return null;
    const data = this._readEncrypted();
    return data[domain] || null;
  }

  /**
   * List all domains that have saved credentials. NEVER includes username/password.
   * Safe to return to the UI / MCP clients.
   */
  list() {
    const data = this._readEncrypted();
    return Object.entries(data).map(([domain, cred]) => ({
      domain,
      username: cred.username,
      savedAt: cred.savedAt,
    }));
  }

  /**
   * Delete credentials for a domain.
   */
  remove(domain) {
    const data = this._readEncrypted();
    if (!data[domain]) return { ok: false, error: 'not found' };
    delete data[domain];
    this._writeEncrypted(data);
    this.cache = data;
    return { ok: true };
  }

  /**
   * Decide whether to autofill credentials for a (domain, action) pair.
   * Returns the credential to fill, or null.
   *
   * SECURITY: only returns credentials when ALL conditions hold:
   *   1. Agent mode is 'agent' or 'auto' (never in 'ask' or 'assist')
   *   2. The action is a fill/type targeting a password-like field
   *   3. The current tab URL matches the credential's domain
   */
  shouldAutofill({ mode, action, currentUrl, params }) {
    if (!['agent', 'auto'].includes(mode)) return null;
    if (!['fill', 'type'].includes(action)) return null;
    if (!currentUrl) return null;
    let host;
    try { host = new URL(currentUrl).hostname.replace(/^www\./, ''); } catch { return null; }
    const cred = this.get(host);
    if (!cred) return null;
    // Heuristic: only autofill if the user is targeting a password/email field
    const target = (params?.ref || params?.selector || params?.text || '').toLowerCase();
    const isCredField = target.includes('password') || target.includes('pass') || target.includes('email')
      || target.includes('user') || target.includes('login') || target.includes('id')
      || target === 'input[type=password]' || target === '#password';
    if (!isCredField) return null;
    return cred;
  }
}

module.exports = { CredentialVault };