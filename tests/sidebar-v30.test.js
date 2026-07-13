// tests/sidebar-v30.test.js — Sidebar restructure + font/contrast verification
// Run: node tests/sidebar-v30.test.js

const fs = require('fs');
const path = require('path');

const HTML_PATH = path.join(__dirname, '..', 'src', 'chrome.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');
let pass = 0, fail = 0;

function check(ok, label) {
  console.log((ok ? '✅ PASS' : '❌ FAIL') + '  ' + label);
  if (ok) pass++; else fail++;
}

// 1. Verify sidebar section order in HTML
function sectionsInOrder() {
  // Extract section comments in order
  const sectionRegex = /^\s*<!-- (Tabs|Recent tabs|Favorites|Memory|Tasks|Session).*?section/gm;
  const matches = [...html.matchAll(sectionRegex)].map(m => m[1]);
  
  // Normalise "Recent tabs" to "Recent" for comparison
  const orderLabels = matches.map(m => m.replace(' tabs', ''));
  
  // Check all 6 sections exist
  const expected = ['Tabs', 'Recent', 'Favorites', 'Memory', 'Tasks', 'Session'];
  const allPresent = expected.every(s => orderLabels.includes(s));
  check(allPresent, 'All 6 sidebar sections present in HTML');
  
  // Check order: Tabs > Recent > Favorites > Memory > Tasks > Session
  const ordered = expected.every((s, i) => orderLabels[i] === s);
  const orderStr = orderLabels.slice(0,6).join(' > ');
  check(ordered, `Sidebar section order: ${orderStr}`);
  
  // Check footer has NO memory-mini
  const footerMatch = html.match(/<!-- Sidebar footer.*?<\/div>\s*<\/div>/s);
  if (footerMatch) {
    const footerHTML = footerMatch[0];
    check(!footerHTML.includes('memory-mini'), 'Sidebar footer does not contain memory-mini');
    check(footerHTML.includes('workspace-switcher'), 'Sidebar footer contains workspace-switcher');
  }
}

// 2. Verify CSS variables
function checkCSSVars() {
  // Light theme
  const lightMuted = html.match(/--muted: rgba\(26,\s*26,\s*46,\s*0\.82\)/);
  check(!!lightMuted, 'Light theme --muted is rgba(26,26,46,0.82) (vivid)');
  
  const lightFaint = html.match(/--faint: rgba\(26,\s*26,\s*46,\s*0\.58\)/);
  check(!!lightFaint, 'Light theme --faint is rgba(26,26,46,0.58)');
  
  // Dark theme (media query)
  const darkMuted = html.match(/--muted: rgba\(245,\s*245,\s*247,\s*0\.78\)/g);
  check(darkMuted && darkMuted.length >= 2, 'Dark/mixed themes --muted is 0.78 (brighter)');
  
  // Font sizes
  const sbTitle = html.match(/--sb-title: 11px/);
  check(!!sbTitle, 'Section title font is 11px (10.5-11px range)');
  
  const sbBody = html.match(/--sb-body: 13px/);
  check(!!sbBody, 'Body font is 13px');
  
  const sbMuted = html.match(/--sb-muted: 12px/);
  check(!!sbMuted, 'Muted/secondary font is 12px (≥11.5px)');
}

// 3. Verify recent-list CSS exists
function checkNewCSS() {
  const hasRecentList = html.includes('.recent-list');
  check(hasRecentList, '.recent-list CSS class defined');
  
  const hasRecentItem = html.includes('.recent-item');
  check(hasRecentItem, '.recent-item CSS class defined');
  
  const hasStatusRow = html.includes('.status-row');
  check(hasStatusRow, '.status-row CSS class defined');
  
  const hasStatusDot = html.includes('.status-dot');
  check(hasStatusDot, 'Standalone .status-dot CSS class defined');
}

// 4. Verify new HTML elements exist
function checkNewElements() {
  check(html.includes('id="recentSectionHead"'), 'Recent section head exists');
  check(html.includes('id="recentList"'), 'Recent list container exists');
  check(html.includes('id="recentToggle"'), 'Recent toggle button exists');
  check(html.includes('data-type="tasks"'), 'Tasks data-type attribute exists');
  check(html.includes('data-type="session"'), 'Session data-type attribute exists');
  check(html.includes('status-row active'), 'Session is active status row');
  check(html.includes('status-row idle'), 'Tasks is idle status row');
  check(html.includes('data-type="profile"'), 'Memory Profile row exists');
  check(html.includes('data-type="preferences"'), 'Memory Preferences row exists');
  
  // Verify old memory rows for tasks/session are REMOVED from memory-mini
  const memoryMiniMatch = html.match(/class="memory-mini">.*?<\/div>/s);
  if (memoryMiniMatch) {
    const mm = memoryMiniMatch[0];
    check(!mm.includes('data-type="tasks"'), 'Tasks row removed from memory-mini');
    check(!mm.includes('data-type="session"'), 'Session row removed from memory-mini');
  }
  
  // Verify footer only has workspace switcher now
  const footerMatch = html.match(/<!-- Sidebar footer.*?<\/div>\s*<\/div>/s);
  if (footerMatch) {
    const f = footerMatch[0];
    check(!f.includes('memory-mini'), 'Footer no longer contains memory section');
  }
}

// Run all checks
console.log('=== Hermes Browser V30 Sidebar Verification ===\n');

sectionsInOrder();
checkCSSVars();
checkNewCSS();
checkNewElements();

console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
