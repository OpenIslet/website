// Finds rows of items that end short (three across and one left over, or 2 + 2 + 1) in grids and wrapping rows, at several widths, on every page.
// Rows of cards and columns should be even at every width (3, 4, 2 or 1 across). Inline flows that wrap like text (chips, buttons, links)
// are listed too and are fine: read the list and judge by the names.
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4400';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const pages = (process.env.PAGES ?? '/,/blueprint,/ceg,/roadmap,/start,/start?route=mcp,/contributions,/idea-graveyard,/contact,/about,/submit,/nope').split(',');
const widths = (process.env.WIDTHS ?? '390,600,820,1024,1280,1440').split(',').map(Number);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const found = new Map();
for (const w of widths) {
  for (const path of pages) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: 900, deviceScaleFactor: 1, isMobile: w < 700, hasTouch: w < 700 });
    await page.goto(BASE + path, { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));
    await new Promise((r) => setTimeout(r, 300));
    const rows = await page.evaluate(() => {
      const out = [];
      const label = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
      for (const el of document.querySelectorAll('main *, section *, ul, ol, div')) {
        if (el.closest('nav, header.nav, footer, svg, pre, .subnav, .copybox')) continue;
        const cs = getComputedStyle(el);
        const isGrid = cs.display === 'grid' || cs.display === 'inline-grid';
        const isWrap = cs.display === 'flex' && cs.flexWrap === 'wrap' && cs.flexDirection.startsWith('row');
        if (!isGrid && !isWrap) continue;
        const kids = [...el.children].filter((c) => {
          const k = getComputedStyle(c);
          const r = c.getBoundingClientRect();
          return k.display !== 'none' && k.position !== 'absolute' && k.position !== 'fixed' && r.width > 40 && r.height > 20;
        });
        if (kids.length < 3) continue;
        const rows = [];
        for (const c of kids) {
          const t = Math.round(c.getBoundingClientRect().top + scrollY);
          const row = rows.find((r) => Math.abs(r.top - t) < 6);
          if (row) row.n++;
          else rows.push({ top: t, n: 1 });
        }
        if (rows.length < 2) continue;
        rows.sort((a, b) => a.top - b.top);
        const counts = rows.map((r) => r.n);
        const first = counts[0];
        const last = counts[counts.length - 1];
        if (last < first || counts.some((n) => n !== first && n !== last)) out.push({ at: label(el), parent: el.parentElement ? label(el.parentElement) : '', counts: counts.join('+') });
      }
      return out;
    });
    for (const r of rows) {
      const key = `${path} | ${r.at} (in ${r.parent}) | ${r.counts}`;
      if (!found.has(key)) found.set(key, new Set());
      found.get(key).add(w);
    }
    await page.close();
  }
}
await browser.close();
const lines = [...found.entries()].map(([k, ws]) => `${k}   at ${[...ws].sort((a, b) => a - b).join(', ')}`).sort();
console.log(lines.join('\n') || 'No uneven rows found.');
