// Measures text contrast from rendered pixels, for the places axe cannot decide (text over gradients, photos and overlapping layers).
// For every piece of visible text it hides all text, screenshots the page, and compares the text colour with the pixels behind it.
import puppeteer from 'puppeteer-core';
import { PNG } from 'pngjs';
import fs from 'node:fs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4400';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const pages = (process.env.PAGES ?? '/,/start,/blueprint,/idea-graveyard,/roadmap,/contributions,/contact,/submit,/submit/finish,/nope').split(',');
const viewports = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'phone', width: 375, height: 812, mobile: true },
];
const SLICE = 3000;

const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => {
  const [hi, lo] = lum(a) >= lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
  return (hi + 0.05) / (lo + 0.05);
};

// Runs inside the page: every piece of visible text, with where it is and what colour it is.
const collect = () => {
      const out = [];
      const parse = (s) => {
        let m = /rgba?\(([^)]+)\)/.exec(s);
        if (m) {
          const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
          return [p[0], p[1], p[2], p[3] ?? 1];
        }
        m = /color\(srgb ([^)]+)\)/.exec(s);
        if (m) {
          const p = m[1].split(/[ /]+/).filter(Boolean).map(Number);
          return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1];
        }
        return null;
      };
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.textContent.trim()) continue;
        const el = node.parentElement;
        if (!el || el.closest('script,style,noscript,[hidden],.sr-only')) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        let opacity = 1;
        for (let e = el; e; e = e.parentElement) opacity *= parseFloat(getComputedStyle(e).opacity);
        if (opacity === 0) continue;
        const svg = el instanceof SVGElement;
        const col = parse(svg ? cs.fill : cs.color);
        if (!col) continue;
        const size = parseFloat(cs.fontSize);
        const ctm = svg && el.getScreenCTM ? el.getScreenCTM() : null;
        const scale = ctm ? Math.hypot(ctm.a, ctm.b) : 1;
        const weight = parseInt(cs.fontWeight, 10) || 400;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const r0 of range.getClientRects()) {
          if (r0.width < 3 || r0.height < 3) continue;
          // Only the part that can be seen: clip to every ancestor that hides overflow (scrolling code blocks, sideways strips).
          let L = r0.left, T = r0.top, R = r0.right, B = r0.bottom;
          for (let a = el; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
            const acs = getComputedStyle(a);
            if (acs.overflowX === 'visible' && acs.overflowY === 'visible') continue;
            const ar = a.getBoundingClientRect();
            if (acs.overflowX !== 'visible') { L = Math.max(L, ar.left); R = Math.min(R, ar.right); }
            if (acs.overflowY !== 'visible') { T = Math.max(T, ar.top); B = Math.min(B, ar.bottom); }
          }
          if (R - L < 3 || B - T < 3) continue;
          const r = { left: L, top: T, width: R - L, height: B - T };
          out.push({
            text: node.textContent.trim().replace(/\s+/g, ' ').slice(0, 48),
            tag: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : ''),
            decorative: !!el.closest('[aria-hidden="true"]'),
            chain: (() => { const c = []; for (let a = el; a && c.length < 4 && a !== document.body; a = a.parentElement) c.push(a.tagName.toLowerCase() + (typeof a.className === 'string' && a.className ? '.' + a.className.trim().split(/\s+/).join('.') : (a.className && a.className.baseVal ? '.' + a.className.baseVal.trim().split(/\s+/).join('.') : ''))); return c.join(' < '); })(),
            pos: Math.round(r0.left) + ',' + Math.round(r0.top + scrollY),
            x: r.left + scrollX,
            y: r.top + scrollY,
            w: r.width,
            h: r.height,
            color: [col[0], col[1], col[2]],
            alpha: col[3] * opacity,
            // Text inside a drawing is measured by how big it is on the screen, not in the drawing's own units.
            large: size * scale >= 24 || (size * scale >= 18.66 && weight >= 700),
            size: Math.round(size * scale * 10) / 10,
          });
        }
      }
      return out;
    };

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const failures = [];
const stats = { texts: 0, views: 0 };

for (const vp of viewports) {
  for (const path of pages) {
    const page = await browser.newPage();
    await page.setViewport({ width: vp.width, height: vp.height, isMobile: !!vp.mobile, hasTouch: !!vp.mobile, deviceScaleFactor: 1 });
    await page.goto(BASE + path, { waitUntil: 'networkidle0' });
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
    await page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));
    await new Promise((r) => setTimeout(r, 300));

    const items = await page.evaluate(`(${collect.toString()})()`);

    // Hide every piece of text, then photograph the page in slices.
    await page.addStyleTag({
      content:
        '*,*::before,*::after{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important}svg text,svg tspan{fill:transparent!important;stroke:none!important}',
    });
    await new Promise((r) => setTimeout(r, 150));
    const total = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
    const slices = [];
    for (let y = 0; y < total; y += SLICE) {
      const h = Math.min(SLICE, total - y);
      const buf = await page.screenshot({ clip: { x: 0, y, width: vp.width, height: h }, captureBeyondViewport: true });
      slices.push({ y, h, png: PNG.sync.read(buf) });
    }
    const px = (x, y) => {
      const s = slices[Math.max(0, Math.min(slices.length - 1, Math.floor(y / SLICE)))];
      const sx = Math.max(0, Math.min(s.png.width - 1, Math.round(x)));
      const sy = Math.max(0, Math.min(s.png.height - 1, Math.round(y - s.y)));
      const i = (sy * s.png.width + sx) * 4;
      return [s.png.data[i], s.png.data[i + 1], s.png.data[i + 2]];
    };

    // Some pages change as they are photographed (design toggles, sticky bars). Keep only text that did not move.
    const after = new Set((await page.evaluate(`(${collect.toString()})()`)).map((i) => `${i.text}|${Math.round(i.x)}|${Math.round(i.y)}`));
    for (const it of items) {
      if (!after.has(`${it.text}|${Math.round(it.x)}|${Math.round(it.y)}`)) continue;
      // Off the page (the skip link waits above the top edge until it is focused): checked in the keyboard test instead.
      if (it.y + it.h <= 0 || it.x + it.w <= 0 || it.x >= vp.width) continue;
      const ratios = [];
      const bgs = [];
      const stepX = Math.max(2, Math.floor(it.w / 24));
      const stepY = Math.max(2, Math.floor(it.h / 6));
      for (let yy = it.y + 1; yy < it.y + it.h - 1; yy += stepY) {
        for (let xx = it.x + 1; xx < it.x + it.w - 1; xx += stepX) {
          const bg = px(xx, yy);
          const fg = it.color.map((c, k) => it.alpha * c + (1 - it.alpha) * bg[k]);
          ratios.push(ratio(fg, bg));
          bgs.push(bg);
        }
      }
      if (!ratios.length) continue;
      stats.texts++;
      ratios.sort((a, b) => a - b);
      const p5 = ratios[Math.floor(ratios.length * 0.05)];
      const need = it.large ? 3 : 4.5;
      if (p5 < need) {
        const med = bgs[Math.floor(bgs.length / 2)];
        failures.push({ view: `${path} (${vp.name})`, chain: it.chain, pos: it.pos, text: it.text, tag: it.tag, size: it.size, large: it.large, decorative: it.decorative, color: it.color.map(Math.round).join(','), alpha: Math.round(it.alpha * 100) / 100, bg: med.join(','), ratio: Math.round(p5 * 100) / 100, need });
      }
    }
    stats.views++;
    await page.close();
  }
}
await browser.close();
fs.mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./out/contrast-report.json', import.meta.url), JSON.stringify(failures, null, 1));

console.log(`Measured ${stats.texts} pieces of text over ${stats.views} page views. Below the WCAG AA minimum: ${failures.length}`);
const key = (f) => `${f.tag}|${f.color}|${f.bg}`;
const groups = new Map();
for (const f of failures) {
  const g = groups.get(key(f)) ?? { ...f, count: 0, views: new Set(), examples: [] };
  g.count++;
  g.views.add(f.view);
  if (g.examples.length < 3) g.examples.push(f.text);
  g.ratio = Math.min(g.ratio, f.ratio);
  groups.set(key(f), g);
}
for (const g of [...groups.values()].sort((a, b) => a.ratio - b.ratio).slice(0, 40)) {
  console.log(`${g.ratio.toFixed(2)} (need ${g.need}) ${g.decorative ? '[decorative] ' : ''}${g.tag}  text ${g.color}${g.alpha < 1 ? ' @' + g.alpha : ''} on ${g.bg}  x${g.count} in ${[...g.views].slice(0, 3).join(', ')}  e.g. "${g.examples[0]}"`);
}
