// Measures every tap target on every page at a phone size (W, default 390), with every fold-out open.
// Flags targets under 24 x 24 px that are not inline links in running text (WCAG 2.2 target size, minimum), unless a 24 px circle
// around each stays clear of its neighbours (the spacing exception), and lists targets under 44 px tall (the size Apple and Google recommend).
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4400';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const pages = (process.env.PAGES ?? '/,/blueprint,/roadmap,/start,/start?route=mcp,/contributions,/idea-graveyard,/contact,/submit,/nope').split(',');
const W = +(process.env.W ?? 390), VH = +(process.env.H ?? 844);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
for (const spec of pages) {
  const [path, clicks] = spec.split('::');
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: VH, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.goto(BASE + path, { waitUntil: 'networkidle0' });
  if (clicks) for (const sel of clicks.split(';;')) { await page.click(sel).catch(() => {}); await new Promise((r) => setTimeout(r, 300)); }
  await page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));
  await new Promise((r) => setTimeout(r, 400));
  const res = await page.evaluate(() => {
    const sel = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [tabindex="0"]';
    const name = (el) => el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : el.className && el.className.baseVal ? '.' + el.className.baseVal.split(/\s+/)[0] : '');
    const items = [];
    for (const el of document.querySelectorAll(sel)) {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (el.closest('[hidden], [aria-hidden="true"]') && !el.matches('summary')) continue;
      let r = el.getBoundingClientRect();
      // a checkbox inside a label: the label is the target
      if (el.matches('input[type=checkbox], input[type=radio]') && el.closest('label')) r = el.closest('label').getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (el.classList.contains('skip')) continue;
      // inline link inside running text: exempt from the minimum
      const inline = cs.display === 'inline' && el.parentElement && [...el.parentElement.childNodes].some((n) => n !== el && n.nodeType === 3 && n.textContent.trim().length > 2);
      items.push({ el, r: { x: r.left, y: r.top + scrollY, w: r.width, h: r.height }, name: name(el), text: (el.getAttribute('aria-label') || el.textContent || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 40), inline });
    }
    const out = { small: [], short: [] };
    for (const it of items) {
      if (it.inline) continue;
      const { w, h } = it.r;
      if (w < 24 || h < 24) {
        // spacing exception: a 24 px circle centred on it must not overlap another target or its circle
        const cx = it.r.x + w / 2, cy = it.r.y + h / 2;
        const clash = items.some((o) => o !== it && !o.inline && (() => {
          const ox = o.r.x + o.r.w / 2, oy = o.r.y + o.r.h / 2;
          const near = Math.hypot(ox - cx, oy - cy) < 24;
          const rectHit = cx + 12 > o.r.x && cx - 12 < o.r.x + o.r.w && cy + 12 > o.r.y && cy - 12 < o.r.y + o.r.h;
          return near || rectHit;
        })());
        out.small.push({ name: it.name, text: it.text, size: `${Math.round(w)}x${Math.round(h)}`, y: Math.round(it.r.y), clash });
      } else if (h < 44) {
        out.short.push({ name: it.name, text: it.text, size: `${Math.round(w)}x${Math.round(h)}`, y: Math.round(it.r.y) });
      }
    }
    return out;
  });
  console.log(`\n=== ${spec} at ${W}px`);
  const group = (list) => {
    const m = new Map();
    for (const x of list) { const k = x.name + (x.clash === undefined ? '' : x.clash ? ' [too close to another]' : ' [spaced ok]'); const g = m.get(k) ?? { n: 0, sizes: new Set(), eg: x.text, y: x.y }; g.n++; g.sizes.add(x.size); m.set(k, g); }
    return [...m.entries()].map(([k, g]) => `   ${k} x${g.n}  ${[...g.sizes].slice(0, 4).join(', ')}  e.g. "${g.eg}" (y ${g.y})`);
  };
  if (res.small.length) console.log(' UNDER 24px:\n' + group(res.small).join('\n'));
  if (res.short.length) console.log(' under 44px tall:\n' + group(res.short).join('\n'));
  await page.close();
}
await browser.close();
