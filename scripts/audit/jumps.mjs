// After jumping to a section, is its heading clear of the sticky bar at the top? Checks every in-page link on a page.
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4400';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const widths = (process.env.WIDTHS ?? '390,820,1280').split(',').map(Number);
// Each page with a bar that stays at the top, and that bar.
const checks = [['/blueprint', '.subnav'], ['/start', '.rail'], ['/start?route=mcp', '.rail']];
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
for (const [path, stickySel] of checks) for (const w of widths) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: w < 700 ? 844 : 900, deviceScaleFactor: 1, isMobile: w < 700, hasTouch: w < 700 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.goto(BASE + path, { waitUntil: 'networkidle0' });
  const hashes = await page.evaluate(() => [...new Set([...document.querySelectorAll('main a[href^="#"]')].map((a) => a.getAttribute('href')).filter((h) => h.length > 1))]);
  const bad = [];
  for (const h of hashes) {
    const r = await page.evaluate(async (h, stickySel) => {
      location.hash = h;
      await new Promise((r) => setTimeout(r, 350));
      const t = document.getElementById(h.slice(1));
      if (!t || !t.offsetParent) return null;
      // the first visible line of text in the target
      const first = t.matches('h1,h2,h3,h4,summary') ? t : t.querySelector('h1,h2,h3,h4,p,summary,li') || t;
      const top = first.getBoundingClientRect().top;
      const bars = [...document.querySelectorAll(stickySel)].filter((b) => getComputedStyle(b).position === 'sticky' && b.getBoundingClientRect().top <= 1 && b.offsetParent);
      const cover = Math.max(0, ...bars.map((b) => b.getBoundingClientRect().bottom));
      return { top: Math.round(top), cover: Math.round(cover) };
    }, h, stickySel);
    if (r && r.top < r.cover) bad.push(`${h} (text at ${r.top}px, bar ends at ${r.cover}px)`);
  }
  console.log(`${path} at ${w}px: ${hashes.length} in-page links, ${bad.length} land under the bar${bad.length ? ':\n   ' + bad.slice(0, 12).join('\n   ') : ''}`);
  await page.close();
}
await browser.close();
