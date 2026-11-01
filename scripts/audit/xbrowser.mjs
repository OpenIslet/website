// Photographs every page in Chrome (Blink) and in WebKit (the engine inside Safari) at desktop and phone width, with motion frozen the same way in both,
// then compares them two ways: where every box on the page sits (the reliable one) and what the pictures look like, tile by tile.
import puppeteer from 'puppeteer-core';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const require = createRequire(new URL('../../package.json', import.meta.url));
const sharp = require('sharp');

const here = new URL('.', import.meta.url).pathname;
const BASE = process.env.BASE ?? 'http://127.0.0.1:4400';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WEBKIT = `${here}bin/webkitshot`;
const out = `${here}out`;
fs.mkdirSync(out, { recursive: true });
const pages = (process.env.PAGES ?? '/,/start,/blueprint,/idea-graveyard,/roadmap,/contributions,/contact,/submit,/submit/finish,/nope').split(',');
const views = [
  { name: 'desktop', w: 1280 },
  { name: 'phone', w: 390, mobile: true },
].filter((v) => !process.env.VIEWS || process.env.VIEWS.split(',').includes(v.name));
const FREEZE = '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;animation-iteration-count:1!important;animation-fill-mode:forwards!important;transition:none!important;scroll-behavior:auto!important}';
const geomSrc = fs.readFileSync(`${here}geom.js`, 'utf8');
const slug = (p) => (p === '/' ? 'home' : p.replace(/\W+/g, ''));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SLICE = 3000;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const results = [];

for (const v of views) {
  const args = ['--base', BASE, '--pages', pages.join(','), '--width', String(v.w), '--tag', v.name, '--out', out, '--freeze', '--geom', `${here}geom.js`];
  if (v.mobile) args.push('--mobile');
  const r = spawnSync(WEBKIT, args, { encoding: 'utf8', timeout: 290000 });
  if (r.status !== 0) { console.log(`WebKit run failed for ${v.name}: status ${r.status} ${r.stderr.slice(0, 200)}`); continue; }
  const wk = JSON.parse(fs.readFileSync(`${out}/webkit-${v.name}-report.json`, 'utf8'));

  for (const p of pages) {
    const w = wk.find((x) => x.page === p);
    const res = { page: p, view: v.name, webkit: { error: w?.error, messages: w?.messages ?? [], overflow: w?.sidewaysOverflow, overflowing: w?.overflowing ?? [], badImages: w?.images ?? [], fonts: (w?.fonts ?? []).length, inputs: w?.inputs ?? [], features: Object.entries(w?.features ?? {}).filter(([, ok]) => !ok).map(([k]) => k) } };
    if (!w || w.error) { res.problem = `WebKit could not photograph this page: ${w?.error ?? 'no result'}`; results.push(res); continue; }

    // ---- Chrome ----
    const page = await browser.newPage();
    await page.setViewport({ width: v.w, height: 900, deviceScaleFactor: 2 });
    await page.goto(BASE + p, { waitUntil: 'networkidle0' });
    await page.addStyleTag({ content: FREEZE });
    await page.evaluate(() => document.fonts.ready);
    await sleep(900);
    const geomC = await page.evaluate(geomSrc);
    const H = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
    res.chromeOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    const layers = [];
    const grey = [];
    for (let y = 0; y < H; y += SLICE) {
      const h = Math.min(SLICE, H - y);
      const buf = await page.screenshot({ clip: { x: 0, y, width: v.w, height: h }, captureBeyondViewport: true });
      layers.push({ input: buf, top: Math.round(y * 2), left: 0 });
      grey.push(await sharp(buf).resize({ width: v.w, height: h, fit: 'fill' }).greyscale().raw().toBuffer());
    }
    await page.close();
    const chromePng = `${out}/${slug(p)}-${v.name}-chrome.png`;
    await sharp({ create: { width: v.w * 2, height: H * 2, channels: 3, background: '#ffffff' }, limitInputPixels: false }).composite(layers).png().toFile(chromePng);
    const A = Buffer.concat(grey);

    // ---- WebKit picture, brought to the same 1x grey scale ----
    const wkPng = `${out}/${slug(p)}-${v.name}-webkit.png`;
    const wkMeta = await sharp(wkPng, { limitInputPixels: false }).metadata();
    const wkH1 = Math.round(wkMeta.height / (wkMeta.width / v.w));
    const B = await sharp(wkPng, { limitInputPixels: false }).resize({ width: v.w, height: wkH1, fit: 'fill' }).greyscale().raw().toBuffer();
    res.height = { chrome: H, webkit: w.scrollHeight };

    // ---- where every box sits ----
    const mapC = new Map(geomC.map((g) => [g[0], g]));
    const dev = [];
    let firstDrift = null;
    let both = 0;
    for (const g of w.geom ?? []) {
      const c = mapC.get(g[0]);
      if (!c) { dev.push({ key: g[0], note: 'only in WebKit', label: g[6] }); continue; }
      both++;
      const dx = g[1] - c[1], dy = g[2] - c[2], dw = g[3] - c[3], dh = g[4] - c[4];
      if (!firstDrift && (Math.abs(dy) > 4 || Math.abs(dx) > 4)) firstDrift = { key: g[0], cls: c[5], label: c[6], dy: Math.round(dy), dx: Math.round(dx) };
      if (Math.abs(dw) > 3 || Math.abs(dh) > 5) dev.push({ key: g[0], cls: c[5], label: c[6], chrome: `${c[3]}x${c[4]}`, webkit: `${g[3]}x${g[4]}`, d: Math.abs(dw) + Math.abs(dh) });
    }
    for (const c of geomC) if (!(w.geom ?? []).some((g) => g[0] === c[0])) dev.push({ key: c[0], note: 'only in Chrome', label: c[6] });
    dev.sort((a, b) => (b.d ?? 999) - (a.d ?? 999));
    res.boxes = { compared: both, differ: dev.length, firstDrift, worst: dev.slice(0, 8) };

    // ---- what the pictures look like ----
    const Hm = Math.min(H, wkH1);
    const T = 40;
    const bad = [];
    for (let ty = 0; ty < Hm; ty += T) {
      for (let tx = 0; tx < v.w; tx += T) {
        let sa = 0, sb = 0, sd = 0, n = 0;
        for (let y = ty; y < Math.min(Hm, ty + T); y += 2) {
          for (let x = tx; x < Math.min(v.w, tx + T); x += 2) {
            const a = A[y * v.w + x], b = B[y * v.w + x];
            sa += a; sb += b; sd += Math.abs(a - b); n++;
          }
        }
        if (Math.abs(sa - sb) / n > 12 || sd / n > 40) bad.push({ x: tx, y: ty });
      }
    }
    const bands = [];
    for (const t of bad) {
      const last = bands[bands.length - 1];
      if (last && t.y - last.y1 <= 80) { last.y1 = Math.max(last.y1, t.y + T); last.n++; last.x0 = Math.min(last.x0, t.x); last.x1 = Math.max(last.x1, t.x + T); }
      else bands.push({ y0: t.y, y1: t.y + T, x0: t.x, x1: t.x + T, n: 1 });
    }
    res.pixels = { tilesDiffering: bad.length, of: Math.ceil(Hm / T) * Math.ceil(v.w / T), bands: bands.filter((b) => b.n >= 2).slice(0, 8) };
    results.push(res);
    console.log(`${p.padEnd(14)} ${v.name.padEnd(8)} height ${H} vs ${w.scrollHeight} | boxes differing ${dev.length}/${both} | tiles differing ${bad.length}/${res.pixels.of} | webkit errors ${res.webkit.messages.length}${res.webkit.overflow ? ' | SIDEWAYS SCROLL IN WEBKIT' : ''}`);
  }
}
await browser.close();
fs.writeFileSync(`${out}/xbrowser-report.json`, JSON.stringify(results, null, 1));
