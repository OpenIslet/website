// Runs axe-core (WCAG 2.2 A and AA, plus best practice) over every page at desktop and phone width,
// including the content behind tabs and toggles. Prints a short report and writes the full one to axe-report.json.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const BASE = process.env.BASE ?? 'http://127.0.0.1:4400';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const pages = (process.env.PAGES ?? '/,/start,/blueprint,/idea-graveyard,/roadmap,/contributions,/contact,/about,/submit,/submit/finish,/nope').split(',');
const viewports = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'phone', width: 375, height: 812, mobile: true },
];
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const found = new Map(); // key -> record
const incomplete = new Map();

async function runAxe(page, label) {
  const res = await page.evaluate(async (tags) => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations', 'incomplete'] });
    const trim = (list) =>
      list.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.map((n) => ({ target: n.target.join(' '), html: n.html.slice(0, 140), summary: (n.failureSummary || '').split('\n').slice(0, 3).join(' ').slice(0, 220) })),
      }));
    return { violations: trim(r.violations), incomplete: trim(r.incomplete) };
  }, TAGS);
  for (const [kind, store] of [['violations', found], ['incomplete', incomplete]]) {
    for (const v of res[kind]) {
      for (const n of v.nodes) {
        const key = `${v.id}|${n.target}|${n.html.slice(0, 60)}`;
        const rec = store.get(key) ?? { id: v.id, impact: v.impact, help: v.help, target: n.target, html: n.html, summary: n.summary, where: new Set() };
        rec.where.add(label);
        store.set(key, rec);
      }
    }
  }
}

for (const vp of viewports) {
  for (const path of pages) {
    const page = await browser.newPage();
    await page.setViewport({ width: vp.width, height: vp.height, isMobile: !!vp.mobile, hasTouch: !!vp.mobile, deviceScaleFactor: 1 });
    await page.goto(BASE + path, { waitUntil: 'networkidle0' });
    await page.evaluate(axeSource);
    const label = `${path} (${vp.name})`;
    await runAxe(page, label);
    // Everything behind "details" and toggles, so hidden content is checked too.
    await page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));
    await runAxe(page, `${label} + details open`);
    const toggles = await page.$$('button[data-client], button[data-guidepath], button[data-guideroute], button[data-scen], .path__item button, button[data-design], [role="tab"]');
    for (const t of toggles) {
      try {
        await t.click({ delay: 0 });
        // Let the page react (for example the scroll-box helper, which runs after a panel is shown) before checking.
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await runAxe(page, `${label} + toggle`);
      } catch {
        /* not clickable at this width */
      }
    }
    await page.close();
  }
}
await browser.close();

const pack = (store) =>
  [...store.values()].map((r) => ({ ...r, where: [...r.where] }));
const report = { violations: pack(found), incomplete: pack(incomplete) };
fs.mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./out/axe-report.json', import.meta.url), JSON.stringify(report, null, 1));

const group = (list) => {
  const by = new Map();
  for (const r of list) {
    const g = by.get(r.id) ?? { id: r.id, impact: r.impact, help: r.help, nodes: 0, pages: new Set(), examples: [] };
    g.nodes++;
    r.where.forEach((w) => g.pages.add(w.replace(/ \+ .*/, '')));
    if (g.examples.length < 3) g.examples.push(`${r.target}  ::  ${r.html.replace(/\s+/g, ' ').slice(0, 90)}`);
    by.set(r.id, g);
  }
  return [...by.values()].sort((a, b) => ['critical', 'serious', 'moderate', 'minor'].indexOf(a.impact) - ['critical', 'serious', 'moderate', 'minor'].indexOf(b.impact));
};
console.log(`\nVIOLATIONS: ${report.violations.length} elements`);
for (const g of group(report.violations)) {
  console.log(`\n[${g.impact}] ${g.id}: ${g.help}  (${g.nodes} elements on ${g.pages.size} page views)`);
  g.examples.forEach((e) => console.log('    ' + e));
}
console.log(`\nNEEDS A HUMAN LOOK (axe could not decide): ${report.incomplete.length} elements`);
for (const g of group(report.incomplete)) console.log(`  ${g.id}: ${g.nodes} elements on ${g.pages.size} page views`);
