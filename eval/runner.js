// eval/runner.js — Automated evaluation harness for the agent package
//
// Runs a scenario file (sequence of steps) through AgentService and checks
// each step's outcome. Designed to catch regressions before they ship.
//
// Inspired by BrowserOS's eval/ package which uses WebVoyager / Mind2Web.
// We use simpler, custom scenarios that exercise OUR specific action surface
// without external dependencies.
//
// Usage:
//   node eval/runner.js                       # run all scenarios
//   node eval/runner.js --scenario search.json  # run one
//   node eval/runner.js --list                 # list available
//
// Output: per-scenario pass/fail + overall score. Exits 0 if all pass.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { AgentService } = require('../src/agent');

const SCENARIOS_DIR = path.join(__dirname, 'scenarios');

// ============ Test harness — fake Electron-side deps ============
//
// Each scenario can drive the agent through `runBrowserAction` calls and
// inspect the resulting state. The fake view returns scriptable responses.

function makeEvalDeps({ pageContent = '', links = [], headings = [], tables = [], loginRequired = false, hasCaptcha = false } = {}) {
  const sent = [];
  const calls = [];
  let lastUrl = 'about:blank';
  let lastKey = null;
  const fakeView = {
    webContents: {
      loadURL: (u) => { calls.push(['loadURL', u]); lastUrl = u; },
      reload: () => calls.push(['reload']),
      getURL: () => lastUrl,
      executeJavaScript: async (code) => {
        calls.push(['executeJavaScript', code.slice(0, 50)]);
        // Page context extraction
        if (code.includes("document.body ? document.body.cloneNode")) {
          return {
            url: lastUrl, title: 'Test Page', domain: (() => { try { return new URL(lastUrl).hostname } catch { return 'test' } })(),
            links: links.map((l, i) => ({ ref: 'link-' + i, text: l.text, href: l.href })),
            controls: [], headings: headings.map((h, i) => ({ level: h.level, text: h.text })),
            tables: tables.map(t => t), text: pageContent, selection: '',
            images: [], forms: [],
            loginRequired, hasCookieBanner: false, hasCaptcha, meta: {},
            charCount: pageContent.length,
          };
        }
        // getVisibleText action — uses innerText.slice(0, 12000).
        // Note: agent's _dispatch invokes executeJavaScript with 'document.body.innerText.slice',
        // which is what we return.
        if (code.includes('document.body.innerText.slice')) return pageContent;
        // Fallback for older code paths.
        if (code.includes('document.body.innerText')) return pageContent;
        if (code.includes('MjjYud h3')) return [];
        if (code.includes('scrollBy')) return { ok: true, y: 100 };
        if (code.includes('getBoundingClientRect')) return { ok: true, text: 'btn', rect: { x: 100, y: 100, width: 80, height: 30 } };
        if (code.includes('sendInputEvent')) return null;
        return { ok: true };
      },
      sendInputEvent: (e) => { calls.push(['sendInputEvent', e.type, e.keyCode]); lastKey = e.keyCode; },
      capturePage: async () => ({ toDataURL: () => 'data:image/png;base64,TEST' }),
      setZoomFactor: () => {},
      getZoomFactor: () => 1.0,
    },
  };
  const tab1 = { id: 1, url: 'about:blank', title: 'Tab', view: fakeView };
  return {
    sent, calls,
    send: (ch, p) => { sent.push({ ch, p }); return true; },
    getTabs: () => [tab1],
    getActiveTab: () => tab1,
    getActiveView: () => fakeView,
    getAutoApprove: () => true,  // eval: trust the test driver
    createTab: (url) => { calls.push(['createTab', url]); lastUrl = url; tab1.url = url; return { ...tab1, url, view: { ...fakeView, webContents: { ...fakeView.webContents, getURL: () => url } } }; },
    switchTab: () => true,
    closeTab: () => true,
    waitForLoad: async () => {},
    goBack: () => {},
    goForward: () => {},
    normalizeUrl: (s) => /^https?:/.test(s || '') ? s : `https://${s || 'example.com'}`,
    notifyAll: () => {},
    userDataPath: path.join(os.tmpdir(), `hermes-eval-${Date.now()}-${Math.random().toString(36).slice(2,8)}`),
  };
}

// ============ Scenario runner ============

async function runScenario(scenario) {
  const { name, description = '', setup = {}, steps } = scenario;
  const result = { name, description, totalSteps: steps.length, passed: 0, failed: 0, failures: [] };
  const deps = makeEvalDeps(setup);
  const agent = new AgentService(deps);

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepLabel = `step ${i + 1}: ${step.action}`;
    try {
      const response = step.action === 'inspect' ? await agent.runBrowserAction('inspectPage')
        : await agent.runBrowserAction(step.action, step.params || {});
      // SAFETY: eval() is intentional here. We read scenario JSON files from
      // our own eval/scenarios/ directory only — never user input. The eval()
      // lets us write test assertions as readable JS expressions in JSON without
      // a separate parser. If scenarios ever come from untrusted sources, swap
      // this for a proper expression evaluator.
      const expectFn = typeof step.expect === 'string' ? eval('(' + step.expect + ')') : step.expect;
      const checks = await expectFn(response, { deps, agent, stepNumber: i });
      const failures = checks.filter(c => !c.ok);
      if (failures.length === 0) {
        result.passed++;
        console.log(`  ✅ ${stepLabel}`);
        if (step.note) console.log(`     ↳ ${step.note}`);
      } else {
        result.failed++;
        result.failures.push({ step: i, stepLabel, failures });
        console.log(`  ❌ ${stepLabel}`);
        for (const f of failures) console.log(`     ↳ ${f.message}`);
      }
    } catch (e) {
      result.failed++;
      result.failures.push({ step: i, stepLabel, error: e.message });
      console.log(`  ❌ ${stepLabel} (threw: ${e.message})`);
    }
  }
  return result;
}

// ============ CLI ============

function listScenarios() {
  if (!fs.existsSync(SCENARIOS_DIR)) return [];
  return fs.readdirSync(SCENARIOS_DIR).filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''));
}

function loadScenario(name) {
  const file = path.join(SCENARIOS_DIR, `${name}.json`);
  if (!fs.existsSync(file)) throw new Error(`scenario not found: ${name}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    console.log('Available scenarios:');
    for (const s of listScenarios()) console.log(`  - ${s}`);
    return;
  }

  let scenarios;
  const scenarioIdx = args.indexOf('--scenario');
  if (scenarioIdx >= 0 && args[scenarioIdx + 1]) {
    scenarios = [loadScenario(args[scenarioIdx + 1])];
  } else {
    scenarios = listScenarios().map(loadScenario);
  }

  console.log(`\n========================================`);
  console.log(`Hermes Browser — Agent Eval Suite`);
  console.log(`========================================`);
  const allResults = [];
  for (const scenario of scenarios) {
    console.log(`\n[${scenario.name}]`);
    if (scenario.description) console.log(`  ${scenario.description}`);
    const result = await runScenario(scenario);
    allResults.push(result);
    console.log(`  → ${result.passed}/${result.totalSteps} steps passed`);
  }

  console.log(`\n========================================`);
  const totalPassed = allResults.reduce((s, r) => s + r.passed, 0);
  const totalFailed = allResults.reduce((s, r) => s + r.failed, 0);
  const total = totalPassed + totalFailed;
  console.log(`OVERALL: ${totalPassed}/${total} (${totalFailed} failures across ${allResults.length} scenarios)`);
  console.log(`========================================`);

  // HTML report — emits ./eval-report.html by default or path from env EVAL_REPORT_PATH.
  if (process.env.EVAL_REPORT_PATH !== 'off') {
    const reportPath = process.env.EVAL_REPORT_PATH || path.join(__dirname, 'eval-report.html');
    const html = renderHtmlReport(allResults);
    try {
      fs.writeFileSync(reportPath, html);
      console.log(`[eval] HTML report: ${reportPath}`);
    } catch (e) {
      console.warn(`[eval] failed to write report: ${e.message}`);
    }
  }

  process.exit(totalFailed === 0 ? 0 : 1);
}

// ============ HTML report renderer ============
function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderHtmlReport(results) {
  const totalPassed = results.reduce((s, r) => s + r.passed, 0);
  const totalFailed = results.reduce((s, r) => s + r.failed, 0);
  const total = totalPassed + totalFailed;
  const allGreen = totalFailed === 0;

  const scenarioRows = results.map(r => {
    const stepRows = r.failures.map(f => `
      <li class="failure">
        <strong>Step ${f.step + 1} (${escapeHtml(f.stepLabel)})</strong>:
        ${escapeHtml((f.failures || []).map(ff => ff.message).join('; ') || f.error || 'unknown')}
      </li>`).join('');
    return `
    <article class="scenario ${r.failed === 0 ? 'pass' : 'fail'}">
      <header>
        <h2>${escapeHtml(r.name)}</h2>
        <p class="description">${escapeHtml(r.description || '')}</p>
        <div class="badge">${r.passed}/${r.totalSteps} passed</div>
        ${r.failed > 0 ? `<div class="badge red">${r.failed} failed</div>` : '<div class="badge green">✓ all pass</div>'}
      </header>
      ${stepRows ? `<ul class="failures">${stepRows}</ul>` : ''}
    </article>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>Hermes Browser — Agent Eval Report</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f5f5f7; color: #1a1a2e; max-width: 900px; margin: 0 auto; padding: 40px 20px; }
h1 { margin: 0 0 8px; }
.subtitle { color: #6b7280; margin: 0 0 24px; }
.summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 32px; }
.metric { background: ${allGreen ? 'linear-gradient(135deg, #10b981 0%, #34d399 100%)' : 'linear-gradient(135deg, #ef4444 0%, #f87171 100%)'}; color: white; padding: 20px; border-radius: 8px; text-align: center; }
.metric-value { font-size: 32px; font-weight: 700; }
.metric-label { font-size: 12px; opacity: 0.9; margin-top: 4px; }
.scenario { background: white; border-radius: 12px; padding: 20px 24px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); border-left: 4px solid #10b981; }
.scenario.fail { border-left-color: #ef4444; }
.scenario h2 { margin: 0 0 4px; font-size: 18px; }
.scenario .description { color: #6b7280; margin: 0 0 12px; font-size: 14px; }
.badge { display: inline-block; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; background: rgba(91, 108, 255, 0.1); color: #5b6cff; margin-right: 6px; }
.badge.green { background: rgba(16, 185, 129, 0.15); color: #047857; }
.badge.red { background: rgba(239, 68, 68, 0.15); color: #b91c1c; }
.failures { margin: 12px 0 0; padding-left: 20px; color: #b91c1c; font-size: 13px; }
.failures li { margin-bottom: 4px; }
.footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 13px; }
</style>
</head>
<body>
<h1>Hermes Browser — Agent Eval Report</h1>
<p class="subtitle">${new Date().toISOString()} · ${results.length} scenarios</p>

<div class="summary">
  <div class="metric"><div class="metric-value">${totalPassed}</div><div class="metric-label">steps passed</div></div>
  <div class="metric"><div class="metric-value">${totalFailed}</div><div class="metric-label">steps failed</div></div>
  <div class="metric"><div class="metric-value">${results.length}</div><div class="metric-label">scenarios</div></div>
  <div class="metric"><div class="metric-value">${Math.round(100 * totalPassed / Math.max(total, 1))}%</div><div class="metric-label">pass rate</div></div>
</div>

${scenarioRows}

<div class="footer">
  <p>Generated by eval/runner.js · See <code>eval/scenarios/</code> for source.</p>
</div>
</body>
</html>`;
}

main().catch(e => { console.error('Eval runner crashed:', e); process.exit(2); });