// tests/v30-polish-1-2.test.js — Verify V30 polish items 1+2
// Checks: floating buttons removed, input toolbar integrated, segment control, send button size
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

const CHROME_PATH = 'file://' + path.resolve(__dirname, '..', 'src', 'chrome.html');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(CHROME_PATH, { waitUntil: 'domcontentloaded' });

  // Inject CSS variable definitions (same as sibling test)
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
        --ink: #1a1a2e;
        --ink-strong: #1a1a2e;
        --muted: #64748b;
        --faint: #94a3b8;
        --accent: #5b6cff;
        --accent-soft: rgba(91,108,255,0.08);
        --danger: #ef4444;
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
        --ai-font-primary: 14px;
        --ai-font-secondary: 12px;
        --ai-font-body: 13px;
        --ai-divider: 1px solid rgba(0,0,0,0.06);
      }
    `;
    document.head.appendChild(style);
  });

  // --- Test 1: .ai-fab floating button REMOVED from DOM ---
  const fabEl = await page.$('.ai-fab');
  assert.strictEqual(fabEl, null,
    '.ai-fab floating button should be removed from DOM');
  console.log('✓ PASS: .ai-fab floating button removed from DOM');

  // --- Test 2: Segment control has 3 buttons (요약/조사/일반) ---
  const segBtns = await page.$$('.ai-seg-btn');
  assert.strictEqual(segBtns.length, 3,
    `Should have exactly 3 segment buttons (got ${segBtns.length})`);
  const segLabels = await Promise.all(segBtns.map(b => b.textContent()));
  console.log('  Segment labels:', segLabels.map(l => l.trim()).join(', '));
  assert.ok(segLabels.some(l => l.trim() === '요약'), 'Should include 요약');
  assert.ok(segLabels.some(l => l.trim() === '조사'), 'Should include 조사');
  assert.ok(segLabels.some(l => l.trim() === '일반'), 'Should include 일반');
  console.log('✓ PASS: Segment control has 요약/조사/일반');

  // --- Test 3: First segment button has .active class ---
  const firstSeg = segBtns[0];
  const isActive = await firstSeg.evaluate(el => el.classList.contains('active'));
  assert.strictEqual(isActive, true, 'First segment (요약) should be active by default');
  console.log('✓ PASS: 요약 segment is active by default');

  // --- Test 4: Input toolbar has 3 tool icons (16px icon, 32px click area) ---
  const toolBtns = await page.$$('.ai-input-tool');
  assert.strictEqual(toolBtns.length, 3,
    `Should have exactly 3 input toolbar buttons (got ${toolBtns.length})`);

  // Verify computed width is 32px (click area)
  const toolWidth = await toolBtns[0].evaluate(el => getComputedStyle(el).width);
  assert.strictEqual(toolWidth, '32px',
    `Input tool button width should be 32px (got: ${toolWidth})`);
  const toolFont = await toolBtns[0].evaluate(el => getComputedStyle(el).fontSize);
  console.log(`  Tool icon font-size: ${toolFont}`);
  console.log('✓ PASS: Input toolbar has 3 icons with 32px click area');

  // --- Test 5: Send button is 36px (36-40px range) ---
  const sendBtn = await page.$('.ai-send-btn');
  assert.ok(sendBtn, '.ai-send-btn should exist');
  const sendWidth = await sendBtn.evaluate(el => getComputedStyle(el).width);
  const sendHeight = await sendBtn.evaluate(el => getComputedStyle(el).height);
  console.log(`  Send button size: ${sendWidth} x ${sendHeight}`);
  // Accept 36px (the CSS spec) or up to 40px
  assert.ok(
    sendWidth === '36px' || sendWidth === '38px' || sendWidth === '40px',
    `Send button width should be 36-40px (got: ${sendWidth})`
  );
  console.log('✓ PASS: Send button is 36-40px');

  // --- Test 6: Old .ai-qsel select is removed ---
  const oldSelect = await page.$('.ai-qsel');
  assert.strictEqual(oldSelect, null,
    'Old .ai-qsel search mode select should be removed');
  console.log('✓ PASS: Old search mode select removed');

  // --- Test 7: Old .ai-input-btn class not used inside input wrap ---
  const oldInputBtns = await page.$$('.ai-input-wrap .ai-input-btn');
  assert.strictEqual(oldInputBtns.length, 0,
    'Old .ai-input-btn class should not exist in input wrap');
  console.log('✓ PASS: Old .ai-input-btn class replaced by .ai-input-tool');

  // --- Test 8: Stop button exists (hidden by default) ---
  const stopBtn = await page.$('.ai-stop-btn');
  assert.ok(stopBtn, '.ai-stop-btn should exist');
  const stopDisplay = await stopBtn.evaluate(el => getComputedStyle(el).display);
  assert.strictEqual(stopDisplay, 'none',
    'Stop button should be hidden by default');
  console.log('✓ PASS: Stop button exists and starts hidden');

  console.log('\n🎉 All 8 tests passed! V30 polish items 1+2 verified.');
  await browser.close();
})().catch(err => {
  console.error('❌ TEST FAILED:', err.message);
  process.exit(1);
});
