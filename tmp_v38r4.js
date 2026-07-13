
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const pages = browser.contexts()[0]?.pages() || [];
  const page = pages.find(p => p.url().includes('chrome.html'));
  if (!page) return;
  
  const R = {};
  for (const [w, h] of [[1440, 900], [1280, 800], [1100, 768], [1024, 768]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => {
      const bf = document.querySelector('.browser-frame')?.getBoundingClientRect();
      const sb = document.getElementById('statusBar')?.getBoundingClientRect();
      return {
        browser: bf ? { x: Math.round(bf.x), w: Math.round(bf.width), right: Math.round(bf.right) } : null,
        status: sb ? { x: Math.round(sb.x), w: Math.round(sb.width), right: Math.round(sb.right) } : null,
      };
    });
    R[`${w}x${h}`] = r;
  }
  console.log(JSON.stringify(R, null, 2));
  await browser.close();
})();
