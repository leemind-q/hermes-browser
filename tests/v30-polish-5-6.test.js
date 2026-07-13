// tests/v30-polish-5-6.test.js — Verify V30 polish items 5+6
// Checks: .v22-usp-badge hidden, #v23SpaceSwitcher hidden, new workspace dropdown
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

const CHROME_PATH = 'file://' + path.resolve(__dirname, '..', 'src', 'chrome.html');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Inject a minimal style environment so CSS variables don't break
  await page.goto(CHROME_PATH, { waitUntil: 'domcontentloaded' });

  // Inject CSS variable definitions since the HTML relies on custom properties
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.id = 'test-vars';
    style.textContent = `
      :root {
        --bg-overlay: rgba(255,255,255,0.8);
        --border-medium: rgba(0,0,0,0.1);
        --border-soft: rgba(0,0,0,0.06);
        --border-strong: rgba(0,0,0,0.2);
        --gold: #f59e0b;
        --gold-bright: #fbbf24;
        --gold-glow: rgba(245,158,11,0.3);
        --gold-line: rgba(245,158,11,0.4);
        --gold-soft: rgba(245,158,11,0.08);
        --text-primary: #1a1a2e;
        --text-secondary: #64748b;
        --text-tertiary: #94a3b8;
        --ink-strong: #1a1a2e;
        --faint: #94a3b8;
        --r-sm: 6px;
        --r-md: 8px;
        --r-xl: 16px;
        --dur: 0.2s;
        --dur-fast: 0.15s;
        --dur-slow: 0.3s;
        --ease-spring: cubic-bezier(0.34,1.56,0.64,1);
        --ease-smooth: cubic-bezier(0.4,0,0.2,1);
        --font-body: 'Inter', sans-serif;
        --font-mono: 'JetBrains Mono', monospace;
        --font-display: 'Space Grotesk', sans-serif;
        --shadow-glass: 0 4px 16px rgba(0,0,0,0.06);
        --shadow-glass-hover: 0 8px 24px rgba(0,0,0,0.10);
        --shadow-deep: 0 12px 40px rgba(0,0,0,0.12);
        --shadow-gold-glow: 0 0 0 0 rgba(251,191,36,0.4);
        --sb-body: 13px;
        --sb-muted: 10px;
        --space-accent: #f59e0b;
      }
    `;
    document.head.appendChild(style);
  });

  // --- Test 1: .v22-usp-badge is hidden ---
  const badgeEl = await page.$('.v22-usp-badge');
  assert.ok(badgeEl, '.v22-usp-badge element should exist in DOM');
  const badgeDisplay = await badgeEl.evaluate(el => getComputedStyle(el).display);
  assert.strictEqual(badgeDisplay, 'none',
    `.v22-usp-badge should have display:none (got: ${badgeDisplay})`);
  console.log('✓ PASS: .v22-usp-badge is display:none');

  // --- Test 2: #v23SpaceSwitcher is hidden ---
  const switcherEl = await page.$('#v23SpaceSwitcher');
  assert.ok(switcherEl, '#v23SpaceSwitcher element should exist in DOM');
  const switcherDisplay = await switcherEl.evaluate(el => getComputedStyle(el).display);
  assert.strictEqual(switcherDisplay, 'none',
    `#v23SpaceSwitcher should have display:none (got: ${switcherDisplay})`);
  console.log('✓ PASS: #v23SpaceSwitcher is display:none');

  // --- Test 3: New workspace dropdown exists in sidebar header ---
  const selectorEl = await page.$('#workspaceSelector');
  assert.ok(selectorEl, '#workspaceSelector should exist in sidebar header');
  const toggleEl = await page.$('#wsDropdownToggle');
  assert.ok(toggleEl, '#wsDropdownToggle should exist');
  const dropdownEl = await page.$('#wsDropdown');
  assert.ok(dropdownEl, '#wsDropdown should exist');
  const dropdownStyle = await dropdownEl.evaluate(el => getComputedStyle(el).display);
  assert.strictEqual(dropdownStyle, 'none',
    '#wsDropdown should start hidden');
  console.log('✓ PASS: #workspaceSelector with dropdown exists in sidebar');

  // --- Test 4: Dropdown has 3 workspace options ---
  const options = await page.$$('#wsDropdown .ws-option');
  assert.strictEqual(options.length, 3, 'Should have exactly 3 workspace options');
  const labels = await Promise.all(options.map(o => o.textContent()));
  console.log('  Options:', labels.map(l => l.trim()).join(', '));
  assert.ok(labels.some(l => l.includes('업무')), 'Should include 업무');
  assert.ok(labels.some(l => l.includes('개인')), 'Should include 개인');
  assert.ok(labels.some(l => l.includes('개발')), 'Should include 개발');
  console.log('✓ PASS: Dropdown has 3 workspace options (업무, 개인, 개발)');

  // --- Test 5: Old static workspace-name text removed ---
  const oldStatic = await page.$$('.workspace-name:not(#wsDropdownToggle)');
  const hasOnlyNew = await page.$('#wsDropdownToggle');
  assert.ok(hasOnlyNew, 'New toggle should be present');
  console.log('✓ PASS: workspace-name is now interactive dropdown toggle');

  console.log('\n🎉 All 5 tests passed!');
  await browser.close();
})().catch(err => {
  console.error('❌ TEST FAILED:', err.message);
  process.exit(1);
});
