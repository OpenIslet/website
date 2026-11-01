// Keyboard, motion and reflow checks that axe cannot do: walks the Tab order on every page, looks for a visible focus indicator,
// checks the skip link, reduced-motion handling, reflow at 320px wide and text resized to 200%.
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4400';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const pages = (process.env.PAGES ?? '/,/start,/blueprint,/idea-graveyard,/roadmap,/contributions,/contact,/submit,/submit/finish,/nope').split(',');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const problems = [];
const note = (page, msg) => problems.push(`${page}: ${msg}`);

// ---- 1. The Tab order ----
for (const path of pages) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(BASE + path, { waitUntil: 'networkidle0' });
  await page.addStyleTag({ content: '*{scroll-behavior:auto!important}' });
  const stops = [];
  let first = null;
  for (let i = 0; i < 160; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return { body: true };
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const name = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.getAttribute('alt') || el.getAttribute('href') || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40);
      // What a keyboard user sees: an outline, a shadow, or a changed border or background.
      const indicator = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 ? 'outline' : cs.boxShadow !== 'none' ? 'shadow' : 'none';
      return {
        tag: el.tagName.toLowerCase(), cls: String(el.className?.baseVal ?? el.className).split(' ')[0], name, indicator,
        top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height),
        inView: r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth,
        hiddenAncestor: !!el.closest('[aria-hidden="true"]'), tabindex: el.getAttribute('tabindex'),
        invisible: cs.visibility === 'hidden' || cs.opacity === '0' || (r.width < 2 && r.height < 2),
        inDetailsClosed: !!el.closest('details:not([open])') && !el.matches('summary'),
        key: el.tagName + '|' + (el.getAttribute('href') || '') + '|' + (el.innerText || '').slice(0, 20),
      };
    });
    if (info.body) break;
    if (first === null) first = info;
    else if (info.key === first.key && stops.length > 2) break;
    stops.push(info);
  }
  const label = `${path} (${stops.length} tab stops)`;
  if (!stops.length) note(label, 'nothing can be reached with the keyboard');
  else {
    const s0 = stops[0];
    if (!/skip/i.test(s0.name) || !s0.inView || s0.top < 0) note(label, `the first Tab stop is "${s0.name}", not a visible skip link (top ${s0.top})`);
  }
  for (const s of stops) {
    if (s.indicator === 'none') note(label, `no visible focus indicator on ${s.tag}.${s.cls} "${s.name}"`);
    if (!s.inView) note(label, `focus moves off screen to ${s.tag}.${s.cls} "${s.name}" (top ${s.top}, left ${s.left})`);
    if (s.hiddenAncestor) note(label, `focusable ${s.tag}.${s.cls} "${s.name}" is inside aria-hidden`);
    if (s.invisible) note(label, `focus lands on an invisible element ${s.tag}.${s.cls} "${s.name}"`);
    if (s.tabindex && Number(s.tabindex) > 0) note(label, `positive tabindex on ${s.tag}.${s.cls}`);
    if (s.inDetailsClosed) note(label, `focus reaches ${s.tag}.${s.cls} "${s.name}" inside a closed details`);
  }
  console.log(`${path}: ${stops.length} tab stops, first "${stops[0]?.name}", last "${stops.at(-1)?.name}"`);
  await page.close();
}

// ---- 2. Motion ----
{
  const run = async (reduce) => {
    const page = await browser.newPage();
    if (reduce) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 1200));
    const n = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getTiming().iterations === Infinity).length);
    const later = await (async () => { await new Promise((r) => setTimeout(r, 6000)); return page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getTiming().iterations === Infinity).length); })();
    await page.close();
    return { n, later };
  };
  const normal = await run(false);
  const reduced = await run(true);
  console.log(`\nMotion on the home page: endless animations running: ${normal.n} at 1s and ${normal.later} after 7s; with "reduce motion" on: ${reduced.n} and ${reduced.later}`);
  if (reduced.n > 0) note('/', `${reduced.n} endless animations still run when the visitor asks for reduced motion`);
  if (normal.later > 0) note('/', `${normal.later} endless animations are still running after 7 seconds and there is no pause control (WCAG 2.2.2)`);
}

// ---- 3. Reflow at 320px, and text at 200% ----
for (const path of pages) {
  for (const [label, w, fontSize] of [['320px wide', 320, null], ['text at 200%', 1280, '200%']]) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: 800, isMobile: w < 600, hasTouch: w < 600 });
    await page.goto(BASE + path, { waitUntil: 'networkidle0' });
    if (fontSize) await page.evaluate((f) => (document.documentElement.style.fontSize = f), fontSize);
    await new Promise((r) => setTimeout(r, 200));
    const res = await page.evaluate(() => {
      const W = innerWidth;
      const over = [];
      for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el);
        if (cs.position === 'fixed' || cs.display === 'none') continue;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > W + 2) {
          let clipped = false;
          for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
            const acs = getComputedStyle(a);
            if (acs.overflowX !== 'visible') { clipped = true; break; }
          }
          if (!clipped) over.push(el.tagName.toLowerCase() + '.' + String(el.className?.baseVal ?? el.className).split(' ')[0] + ' right=' + Math.round(r.right));
        }
      }
      return { overflow: document.documentElement.scrollWidth > W + 1, scrollW: document.documentElement.scrollWidth, W, over: over.slice(0, 4) };
    });
    if (res.overflow) note(`${path} (${label})`, `the page scrolls sideways (${res.scrollW}px in ${res.W}px)${res.over.length ? ': ' + res.over.join('; ') : ''}`);
    await page.close();
  }
}
await browser.close();

console.log(`\nKEYBOARD, MOTION AND REFLOW PROBLEMS: ${problems.length}`);
const seen = new Map();
for (const p of problems) {
  const k = p.replace(/^\S+ \([^)]*\): /, '').replace(/\d+/g, '#');
  seen.set(k, (seen.get(k) ?? 0) + 1);
}
problems.slice(0, 60).forEach((p) => console.log('  ' + p));
if (problems.length > 60) console.log(`  … and ${problems.length - 60} more`);
