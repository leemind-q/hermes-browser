// tests/mcp-bridge-spawner.test.js — Unit tests for BridgeSpawner
//
// Injects fake createBridge to simulate EADDRINUSE, success, and unrecoverable failure
// without touching real network sockets. Validates the retry + fallback behavior
// that protects our Electron app from port conflicts at startup.

const assert = require('assert');
const { BridgeSpawner } = require('../src/mcp-bridge-spawner');

let passed = 0, failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ PASS  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ FAIL  ${name}: ${e.message}`);
    failed++;
  }
}

// ============ Test helpers ============

const fakeAgent = { kind: 'fake' };

function recorder() {
  const events = [];
  return {
    log: (level, msg, ...rest) => events.push({ level, msg, rest }),
    events,
  };
}

function makeSpawner({ createBridge, log, preferredPort = 8780, maxAttempts = 3 } = {}) {
  return new BridgeSpawner({
    agent: fakeAgent,
    createBridge,
    log: log || (() => {}),
    preferredPort,
    maxAttempts,
    host: '127.0.0.1',
  });
}

// ============ Tests as registered tasks ============

let currentSection = 'tests';
const section = (name, fn) => { console.log(`\n[${name}]`); currentSection = name; fn(); };
const it = async (name, fn) => { await test(name, fn); };

section('BridgeSpawner — construction', async () => {
  it('rejects construction without agent', () => {
    assert.throws(() => new BridgeSpawner({ agent: null }), /agent required/);
  });
  it('applies default port/attempts/host', () => {
    const s = new BridgeSpawner({ agent: fakeAgent });
    assert.strictEqual(s.preferredPort, 8780);
    assert.strictEqual(s.maxAttempts, 3);
    assert.strictEqual(s.host, '127.0.0.1');
  });
  it('exposes current=null before start', () => {
    const s = makeSpawner();
    assert.strictEqual(s.current, null);
  });
});

section('BridgeSpawner — happy path', async () => {
  it('succeeds on first attempt when createBridge resolves', async () => {
    let receivedPort = null;
    const fakeBridge = { port: 8780, token: 'abc', close: async () => {} };
    const spawner = makeSpawner({
      createBridge: async ({ port }) => { receivedPort = port; return fakeBridge; },
    });
    const result = await spawner.start();
    assert.strictEqual(result, fakeBridge);
    assert.strictEqual(receivedPort, 8780, 'should try preferred port first');
    assert.strictEqual(spawner.current, fakeBridge);
  });
  it('emits start log event on success', async () => {
    const { log, events } = recorder();
    const spawner = makeSpawner({
      createBridge: async () => ({ port: 8780, close: async () => {} }),
      log,
    });
    await spawner.start();
    const starts = events.filter(e => e.level === 'start');
    assert.strictEqual(starts.length, 1, 'should emit exactly one start event');
    assert.ok(starts[0].msg.includes('8780'));
  });
});

section('BridgeSpawner — EADDRINUSE retry', async () => {
  it('retries with different port on EADDRINUSE, succeeds on 2nd attempt', async () => {
    const attemptedPorts = [];
    const { log, events } = recorder();
    const spawner = makeSpawner({
      createBridge: async ({ port }) => {
        attemptedPorts.push(port);
        if (port === 8780) {
          const e = new Error(`port ${port} in use`);
          e.code = 'EADDRINUSE';
          throw e;
        }
        return { port, close: async () => {} };
      },
      log,
    });
    const result = await spawner.start();
    assert.ok(result, 'should eventually return a bridge');
    assert.strictEqual(attemptedPorts[0], 8780, 'first attempt uses preferred port');
    assert.notStrictEqual(attemptedPorts[1], 8780, 'second attempt uses different port');
    assert.strictEqual(attemptedPorts.length, 2, 'should make exactly 2 attempts');
    const warns = events.filter(e => e.level === 'warn');
    assert.ok(warns.some(w => w.msg.includes('in use')), 'should log retry warning');
  });
  it('retries until exhausted, returns null when all attempts EADDRINUSE', async () => {
    let attempts = 0;
    const spawner = makeSpawner({
      maxAttempts: 3,
      createBridge: async () => {
        attempts++;
        const e = new Error(`port in use`);
        e.code = 'EADDRINUSE';
        throw e;
      },
    });
    const result = await spawner.start();
    assert.strictEqual(result, null, 'should give up and return null');
    assert.strictEqual(attempts, 3, 'should make exactly maxAttempts attempts');
  });
  it('does not retry on non-EADDRINUSE error, returns null immediately', async () => {
    let attempts = 0;
    const spawner = makeSpawner({
      maxAttempts: 3,
      createBridge: async () => {
        attempts++;
        throw new Error('permission denied');
      },
    });
    const result = await spawner.start();
    assert.strictEqual(result, null);
    assert.strictEqual(attempts, 1, 'should NOT retry on non-EADDRINUSE error');
  });
  it('emits error log on unrecoverable failure', async () => {
    const { log, events } = recorder();
    const spawner = makeSpawner({
      maxAttempts: 2,
      createBridge: async () => {
        const e = new Error('bind: permission denied');
        e.code = 'EACCES';
        throw e;
      },
      log,
    });
    await spawner.start();
    const errors = events.filter(e => e.level === 'error');
    assert.ok(errors.some(e => e.msg.includes('failed to start')), 'should log failure');
    assert.ok(errors.some(e => e.msg.includes('continuing without')), 'should log graceful fallback');
  });
});

section('BridgeSpawner — port selection', async () => {
  it('attempt 1 uses preferred port', () => {
    const s = makeSpawner({ preferredPort: 9000 });
    assert.strictEqual(s._portForAttempt(1), 9000);
  });
  it('attempts 2..N pick port in [preferred+1..preferred+PORT_RANGE)', () => {
    const s = makeSpawner({ preferredPort: 9000 });
    for (let i = 0; i < 50; i++) {
      const p = s._portForAttempt(2);
      assert.ok(p >= 9001 && p < 9010, `port ${p} should be > preferred and < preferred+PORT_RANGE`);
    }
  });
});

section('BridgeSpawner — stop / cleanup', async () => {
  it('stop() is safe when bridge never started', async () => {
    const s = makeSpawner();
    await s.stop();
    assert.strictEqual(s.current, null);
  });
  it('stop() closes the bridge and clears current', async () => {
    let closeCount = 0;
    const fakeBridge = { port: 8780, close: async () => { closeCount++; } };
    const spawner = makeSpawner({ createBridge: async () => fakeBridge });
    await spawner.start();
    await spawner.stop();
    assert.strictEqual(closeCount, 1);
    assert.strictEqual(spawner.current, null);
  });
  it('stop() is idempotent', async () => {
    let closeCount = 0;
    const fakeBridge = { port: 8780, close: async () => { closeCount++; } };
    const spawner = makeSpawner({ createBridge: async () => fakeBridge });
    await spawner.start();
    await spawner.stop();
    await spawner.stop();
    assert.strictEqual(closeCount, 1, 'should only close once');
  });
  it('stop() swallows errors from close()', async () => {
    const fakeBridge = { port: 8780, close: async () => { throw new Error('already closed'); } };
    const spawner = makeSpawner({ createBridge: async () => fakeBridge });
    await spawner.start();
    await spawner.stop();
  });
});

section('BridgeSpawner — preferred port fallback warning', async () => {
  it('emits warn event when preferred port is unavailable', async () => {
    const { log, events } = recorder();
    const spawner = makeSpawner({
      preferredPort: 8780,
      createBridge: async ({ port }) => {
        if (port === 8780) { const e = new Error('busy'); e.code = 'EADDRINUSE'; throw e; }
        return { port, close: async () => {} };
      },
      log,
    });
    await spawner.start();
    const warns = events.filter(e => e.level === 'warn');
    assert.ok(warns.some(w => w.msg.includes('preferred port 8780 unavailable')), 'should warn about port fallback');
  });
});

// ============ Runner ============

(async () => {
  // Wait for all pending test() calls to finish (sections are sync, but it() is async)
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  console.log(`\n========================================`);
  console.log(`PASSED: ${passed}    FAILED: ${failed}`);
  console.log(`========================================`);
  process.exit(failed === 0 ? 0 : 1);
})();
