// Draws the Blueprint page's engineering drawing for each design to PNG files, at twice the usual sharpness, so the pictures can be
// looked at closely (overlaps, crowded labels, a part drawn in the wrong place). Nothing is checked automatically: you look.
//
//   BASE=http://localhost:4321 node figure-shots.mjs            # writes out/figure-A.png, figure-B.png, figure-X.png
//   WIDTH=390 node figure-shots.mjs                             # the phone layout (the numbered list takes over from the sheet's legend)
//
// Each design also gets two close-ups at full size: out/figure-A-cell.png (the cell, the legend and the DNA strip) and
// out/figure-A-graft.png (the graft cross-section).
import puppeteer from 'puppeteer-core';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE ?? 'http://localhost:4321';
const WIDTH = Number(process.env.WIDTH ?? 1440);
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = fileURLToPath(new URL('./out/', import.meta.url));
await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, defaultViewport: { width: WIDTH, height: 1000, deviceScaleFactor: 2 } });
const page = await browser.newPage();
const problems = [];
page.on('pageerror', (error) => problems.push(error.message));
await page.goto(`${BASE}/blueprint`, { waitUntil: 'networkidle0' });

for (const design of ['A', 'B', 'X']) {
  await page.evaluate((d) => document.querySelector(`.subnav__switch button[data-scen="${d}"]`)?.click(), design);
  await new Promise((resolve) => setTimeout(resolve, 400));
  const figure = await page.$('.drawing__fig svg');
  await figure.scrollIntoView();
  await figure.screenshot({ path: `${OUT}figure-${design}.png` });
  // Close-ups: the left 53% (cell, legend, DNA strip) and the right 47% (the graft and the title block). A clip is measured from the top
  // of the whole page, so the page's scroll position is added to where the drawing sits on screen.
  const box = await page.evaluate(() => {
    const r = document.querySelector('.drawing__fig svg').getBoundingClientRect();
    return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };
  });
  const split = box.width * 0.53;
  await page.screenshot({ path: `${OUT}figure-${design}-cell.png`, clip: { x: box.x, y: box.y, width: split, height: box.height } });
  await page.screenshot({ path: `${OUT}figure-${design}-graft.png`, clip: { x: box.x + split, y: box.y, width: box.width - split, height: box.height } });
}
await browser.close();
console.log(problems.length ? `Script errors: ${problems.join('; ')}` : 'Drawn: figure-A, figure-B and figure-X (and their -cell and -graft close-ups) in scripts/audit/out/.');
