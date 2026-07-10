// src/mcp-bridge-spawner.js — Hardened bridge startup with retry + observability
//
// Extracted from main.js so the spawn logic is unit-testable without Electron.
// Responsibilities:
//   1. Try to start the bridge on the preferred port (default 8780)
//   2. On EADDRINUSE, retry up to N times on a nearby port (8780..8780+maxAttempts-1)
//   3. Always emit events for observability (started / retried / failed / stopped)
//   4. On any other error, log and give up cleanly — the rest of the app keeps working
//
// Usage from main.js:
//   const spawner = new BridgeSpawner({ agent, log: console.log });
//   const result = await spawner.start();
//   // result === null if bridge failed to start (app continues without it)
//   // result === { port, token, close: () => Promise<void> }
//
// Usage from tests:
//   const spawner = new BridgeSpawner({ agent: fakeAgent, createBridge: fakeCreateBridge, log: () => {} });
//   await spawner.start();

const DEFAULT_PORT = 8780;
const DEFAULT_MAX_ATTEMPTS = 3;
const PORT_RANGE = 10;  // 8780..8789

class BridgeSpawner {
  /**
   * @param {object} opts
   * @param {object} opts.agent           - AgentService instance (passed through to createBridge)
   * @param {Function} [opts.createBridge] - injectable for tests; defaults to real createBridge
   * @param {Function} [opts.log]          - logger, defaults to console.log
   * @param {number} [opts.preferredPort]  - default 8780
   * @param {number} [opts.maxAttempts]    - default 3
   * @param {string} [opts.host]           - default '127.0.0.1'
   */
  constructor({ agent, createBridge, log, preferredPort = DEFAULT_PORT, maxAttempts = DEFAULT_MAX_ATTEMPTS, host = '127.0.0.1' }) {
    if (!agent) throw new Error('BridgeSpawner: agent required');
    this.agent = agent;
    // Late-require the real createBridge so test fakes can be injected cleanly.
    this._createBridgeImpl = createBridge;
    this._log = log || ((level, msg, ...rest) => console.log(`[mcp-bridge] ${level} ${msg}`, ...rest));
    this.preferredPort = preferredPort;
    this.maxAttempts = maxAttempts;
    this.host = host;
    this._bridge = null;
  }

  _createBridge(port) {
    if (this._createBridgeImpl) return this._createBridgeImpl({
      agent: this.agent,
      port,
      host: this.host,
      log: this._log,
    });
    // Default: late-require the real module. Wrapped so a real failure doesn't
    // throw a stack trace from inside our retry loop.
    try {
      const { createBridge } = require('./mcp-bridge');
      return createBridge({ agent: this.agent, port, host: this.host, log: this._log });
    } catch (e) {
      return Promise.reject(e);
    }
  }

  /**
   * Try to start the bridge. Returns the bridge object on success, or null on failure.
   * NEVER throws — bridge is optional infrastructure; the calling app must keep working.
   */
  async start() {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const port = this._portForAttempt(attempt);
      try {
        const bridge = await this._createBridge(port);
        this._bridge = bridge;
        if (port !== this.preferredPort) {
          this._log('warn', `preferred port ${this.preferredPort} unavailable, using ${port}`);
        }
        this._log('start', `bridge ready on http://${this.host}:${port}`);
        return bridge;
      } catch (err) {
        if (err?.code === 'EADDRINUSE' && attempt < this.maxAttempts) {
          this._log('warn', `port ${port} in use, retrying (${attempt}/${this.maxAttempts})`);
          continue;
        }
        // Either a non-EADDRINUSE error, or we've exhausted attempts.
        this._log('error', `bridge failed to start: ${err?.message || err}`);
        this._log('error', 'continuing without MCP bridge — app still works');
        return null;
      }
    }
    // Should be unreachable since the loop either returns or nulls on the last iter,
    // but kept for safety:
    return null;
  }

  /**
   * Pick the port for the Nth attempt. Attempt 1 = preferred. Attempts 2..N = random
   * within PORT_RANGE above preferred. Random prevents thundering-herd when multiple
   * bridges are retrying simultaneously.
   */
  _portForAttempt(attempt) {
    if (attempt === 1) return this.preferredPort;
    // Offset is 1..PORT_RANGE so we NEVER retry the same preferred port that just failed.
    // (Math.floor(Math.random() * PORT_RANGE) can return 0, which would re-pick the bad port.)
    const offset = 1 + Math.floor(Math.random() * (PORT_RANGE - 1));
    return this.preferredPort + offset;
  }

  /** Stop the bridge. Safe to call multiple times. */
  async stop() {
    if (!this._bridge) return;
    const b = this._bridge;
    this._bridge = null;
    try { await b.close(); } catch { /* swallow */ }
  }

  /** Currently-running bridge, or null. */
  get current() { return this._bridge; }
}

module.exports = { BridgeSpawner, DEFAULT_PORT, DEFAULT_MAX_ATTEMPTS, PORT_RANGE };