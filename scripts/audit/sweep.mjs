// Loads every page at a spread of widths in Chrome and in WebKit and reports any page that scrolls sideways or has a box poking out of the screen.
import puppeteer from 'puppeteer-core';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
const here = new URL('.', import.meta.url).pathname;
const BASE = process.env.BASE ?? 'http://127.0.0.1:4500';
const pages = ['/', '/start', '/blueprint', '/idea-graveyard', '/roadmap', '/contributions', '/contact', '/about', '/submit', '/submit/finish', '/nope'];
const widths = (process.env.WIDTHS ?? '320,375,430,600,768,1024,1280,1920,2560').split(',').map(Number);
const probe = () => {
  const W = innerWidth, over = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.display === 'none') continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > W + 2) {
      let clipped = false;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { if (getComputedStyle(a).overflowX !== 'visible') { clipped = true; break; } }
      if (!clipped) over.push(el.tagName.toLowerCase() + '.' + String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).split(' ')[0] + ' right=' + Math.round(r.right));
    }
  }
  return { sideways: document.documentElement.scrollWidth > W + 1, scrollWidth: document.documentElement.scrollWidth, over: over.slice(0, 4) };
};
fs.mkdirSync(`${here}out`, { recursive: true });
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const problems = [];
let checked = 0;
for (const w of widths) {
  // Chrome
  for (const p of pages) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: 900 });
    await page.goto(BASE + p, { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));
    const r = await page.evaluate(probe);
    checked++;
    if (r.sideways || r.over.length) problems.push(`Chrome ${w}px ${p}: ${r.sideways ? 'scrolls sideways (' + r.scrollWidth + 'px) ' : ''}${r.over.join('; ')}`);
    await page.close();
  }
  // WebKit
  const run = spawnSync(`${here}bin/webkitshot`, ['--base', BASE, '--pages', pages.join(','), '--width', String(w), '--tag', `sweep${w}`, '--out', `${here}out`, '--nopic', '--open'], { encoding: 'utf8', timeout: 200000 });
  if (run.status !== 0) { problems.push(`WebKit ${w}px: tool failed ${run.stderr.slice(0, 100)}`); continue; }
  const rep = JSON.parse(fs.readFileSync(`${here}out/webkit-sweep${w}-report.json`, 'utf8'));
  for (const x of rep) {
    checked++;
    if (x.sidewaysOverflow || (x.overflowing && x.overflowing.length)) problems.push(`WebKit ${w}px ${x.page}: ${x.sidewaysOverflow ? 'scrolls sideways (' + x.scrollWidth + 'px) ' : ''}${(x.overflowing ?? []).join('; ')}`);
    if (x.messages?.length) problems.push(`WebKit ${w}px ${x.page}: script messages ${x.messages.join(' | ').slice(0, 120)}`);
  }
  console.log(`width ${w}: done`);
}
await browser.close();
console.log(`\nChecked ${checked} page views. Problems: ${problems.length}`);
problems.forEach((p) => console.log('  ' + p));
