// Taps through the interactive parts of every page with a simulated finger at phone width, and reports what happened.
import puppeteer from 'puppeteer-core';
const BASE = process.env.BASE ?? 'http://127.0.0.1:4400';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const W = +(process.env.W ?? 390);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const results = [];
const ok = (name, pass, detail = '') => results.push(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function open(path) {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  // Reduced motion, so a simulated finger never lands while the page is still scrolling smoothly.
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE + path, { waitUntil: 'networkidle0' });
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} });
  await page.reload({ waitUntil: 'networkidle0' });
  page._errors = errors;
  return page;
}
async function tap(page, sel) {
  const el = await page.$(sel);
  if (!el) throw new Error('no element ' + sel);
  await el.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await wait(250);
  await el.tap();
  await wait(350);
}
const visibleIn = (page, sel, boxSel) => page.evaluate((sel, boxSel) => {
  const el = document.querySelector(sel); const box = boxSel ? document.querySelector(boxSel) : null;
  if (!el) return 'missing';
  const r = el.getBoundingClientRect(); const b = box ? box.getBoundingClientRect() : { left: 0, right: document.documentElement.clientWidth };
  return r.left >= b.left - 1 && r.right <= b.right + 1 ? 'yes' : `no (${Math.round(r.left)}-${Math.round(r.right)} in ${Math.round(b.left)}-${Math.round(b.right)})`;
}, sel, boxSel);

// The menu row: is this page's own link fully on screen?
for (const [path, label] of [['/', null], ['/blueprint', 'Blueprint'], ['/idea-graveyard', 'Idea Graveyard'], ['/roadmap', 'Roadmap'], ['/contributions', 'Contributions'], ['/about', 'About'], ['/contact', null], ['/start', null]]) {
  const page = await open(path);
  if (label) ok(`menu row shows the current page (${label})`, (await visibleIn(page, '.nav__link[aria-current="page"]', '.nav__links')) === 'yes', await visibleIn(page, '.nav__link[aria-current="page"]', '.nav__links'));
  const more = await page.evaluate(() => { const n = document.querySelector('.nav__links'); return n.scrollWidth - n.clientWidth; });
  if (path === '/') ok('menu row: links off screen to the right', true, `${more}px hidden`);
  ok(`no script errors on ${path}`, page._errors.length === 0, page._errors.slice(0, 2).join(' | '));
  await page.close();
}

// Home
{
  const page = await open('/');
  await tap(page, '.define__term');
  ok('home: tapping "cure" opens its meaning', await page.$eval('.define__tip', (t) => getComputedStyle(t).display === 'block'));
  ok('home: the meaning stays on screen', (await visibleIn(page, '.define__box', null)) === 'yes', await visibleIn(page, '.define__box', null));
  await tap(page, '.goal__h');
  ok('home: tapping elsewhere closes it', await page.$eval('.define__tip', (t) => getComputedStyle(t).display === 'none'));
  await tap(page, 'button[data-path]:not([aria-pressed="true"])');
  const shown = await page.evaluate(() => [...document.querySelectorAll('div.path[data-path]')].filter((d) => !d.hidden).map((d) => d.dataset.path));
  const pressed = await page.evaluate(() => document.querySelector('button[data-path][aria-pressed="true"]')?.dataset.path);
  ok('home: "I work at an AI lab" switches the steps', shown.length === 1 && shown[0] === pressed, `${shown} / ${pressed}`);
  await tap(page, '.ringlink .ringtag');
  ok('home: a ring in the hero picture jumps to its test', await page.evaluate(() => location.hash === '#test-1' && Math.abs(document.getElementById('test-1').getBoundingClientRect().top) < 120), await page.evaluate(() => location.hash + ' ' + Math.round(document.getElementById('test-1').getBoundingClientRect().top)));
  await page.close();
}

// Blueprint
{
  const page = await open('/blueprint');
  await tap(page, '.subnav__switch button[data-scen="B"]');
  const state = await page.evaluate(() => ({ fig: document.querySelector('[data-bpfig]')?.dataset.design, panels: [...document.querySelectorAll('div[data-scen]')].filter((d) => !d.hidden).map((d) => d.dataset.scen) }));
  ok('blueprint: Design B switches the drawing and panels', state.fig === 'B' && state.panels.every((p) => p === 'B'), JSON.stringify(state));
  ok('blueprint: the design switch stays on screen while scrolling', await page.evaluate(async () => { window.scrollTo(0, 6000); await new Promise((r) => setTimeout(r, 300)); const r = document.querySelector('.subnav__switch').getBoundingClientRect(); return r.top >= 0 && r.bottom < 200; }));
  await page.evaluate(() => window.scrollTo(0, 0));
  await tap(page, '.specwrap__sum');
  ok('blueprint: tapping the specification row opens it', await page.$eval('#spec', (d) => d.open));
  await tap(page, '.toc a[href="#references"]');
  ok('blueprint: a contents link jumps inside the paper', await page.evaluate(() => Math.abs(document.getElementById('references').getBoundingClientRect().top) < 140), await page.evaluate(() => Math.round(document.getElementById('references').getBoundingClientRect().top)));
  await tap(page, '.locwrap:not([hidden]) button[data-locus]:not([aria-pressed="true"])');
  const loc = await page.evaluate(() => { const w = document.querySelector('.locwrap:not([hidden])'); const b = w.querySelector('button[aria-pressed="true"]'); const p = [...w.querySelectorAll('div[data-locus]')].filter((d) => !d.hidden); return { b: b?.dataset.locus, p: p.map((d) => d.dataset.locus) }; });
  ok('blueprint: an edit button shows that edit', loc.p.length === 1 && loc.p[0] === loc.b, JSON.stringify(loc));
  const parts = await page.$$('.bp-parts a, .bp-list a, [data-spec]');
  ok('blueprint: the numbered parts list exists below the drawing', parts.length > 0, `${parts.length} links`);
  await page.close();
}

// Start, copy-and-paste route
{
  const page = await open('/start');
  await tap(page, 'button[data-copy-pack]');
  const status = await page.$eval('[data-pack-status]', (s) => s.textContent.trim());
  ok('start: Copy the starter pack gives feedback', status.length > 0, status.slice(0, 60));
  await tap(page, '.gstep__foot a.btn--primary');
  const tick = await page.evaluate(() => document.querySelector('[data-rail="1"]')?.classList.contains('is-done'));
  ok('start: Next ticks step 1 in the step bar', tick);
  await page.evaluate(() => document.getElementById('step-5').scrollIntoView());
  await wait(800);
  ok('start: the step bar shows the current step (5) on screen', (await visibleIn(page, '.rail a.is-current', '.rail')) === 'yes', await visibleIn(page, '.rail a.is-current', '.rail'));
  ok('start: the step bar stays at the top', await page.evaluate(() => { const r = document.querySelector('.rail').getBoundingClientRect(); return r.top <= 1 && r.bottom > 20; }));
  const stepTop = await page.evaluate(() => { location.hash = '#step-3'; return new Promise((r) => setTimeout(() => r(Math.round(document.getElementById('step-3').getBoundingClientRect().top)), 500)); });
  const railH = await page.evaluate(() => Math.round(document.querySelector('.rail').getBoundingClientRect().height));
  ok('start: jumping to a step lands below the sticky step bar', stepTop >= railH - 2, `step top ${stepTop}, bar ${railH}`);
  await page.close();
}

// Start, MCP route
{
  const page = await open('/start?route=mcp');
  await tap(page, 'button.ctab[data-client="chatgpt"]');
  const shown = await page.evaluate(() => [...document.querySelectorAll('.cpanel[data-client]')].filter((d) => !d.hidden).map((d) => d.dataset.client));
  ok('start MCP: tapping ChatGPT shows its steps', shown.length === 1 && shown[0] === 'chatgpt', String(shown));
  await page.close();
  const p2 = await open('/start');
  await tap(p2, '.pathpick button:not([aria-pressed="true"])');
  ok('start: tapping "Connect with MCP" switches route', await p2.evaluate(() => { const v = [...document.querySelectorAll('[data-route-only="mcp"]')].some((e) => e.offsetParent !== null); return v; }));
  await p2.close();
}

// Contributions
{
  const page = await open('/contributions');
  const before = await page.$eval('#rows > li details', (d) => d.open);
  await tap(page, '#rows > li:nth-child(2) summary');
  ok('contributions: tapping a row opens it', await page.$eval('#rows > li:nth-child(2) details', (d) => d.open));
  await page.type('#q', 'stress');
  await wait(300);
  const n = await page.evaluate(() => [...document.querySelectorAll('#rows > li')].filter((l) => !l.hidden).length);
  ok('contributions: search filters the board', n >= 1 && n < 4, `${n} rows shown`);
  ok('contributions: the outcome filter narrows the board', await page.evaluate(() => {
    const q = document.getElementById('q');
    q.value = '';
    q.dispatchEvent(new Event('input', { bubbles: true }));
    const o = document.getElementById('outcome');
    o.value = 'dead_end';
    o.dispatchEvent(new Event('input', { bubbles: true }));
    const shown = [...document.querySelectorAll('#rows > li')].filter((l) => !l.hidden).length;
    o.value = 'all';
    o.dispatchEvent(new Event('input', { bubbles: true }));
    return shown === 1;
  }));
  await page.close();
}

// Idea Graveyard
{
  const page = await open('/idea-graveyard');
  await tap(page, '#list > li:first-child summary');
  ok('graveyard: tapping an idea opens it', await page.$eval('#list > li:first-child details', (d) => d.open));
  await page.select('#level', 'BLOCK');
  await wait(300);
  const n = await page.evaluate(() => [...document.querySelectorAll('#list > li')].filter((l) => !l.hidden).map((l) => l.dataset.level));
  ok('graveyard: the Status filter shows dead ends only', n.length > 0 && n.every((l) => l === 'BLOCK'), `${n.length} shown`);
  await page.close();
}

// The old Idea Graveyard address forwards, keeping a link to one entry, which opens.
{
  const page = await open('/graveyard#gy-004');
  await page.waitForFunction(() => location.pathname.replace(/\/$/, '') === '/idea-graveyard', { timeout: 10000 }).catch(() => {});
  await wait(600);
  const at = await page.evaluate(() => ({ path: location.pathname.replace(/\/$/, ''), hash: location.hash, open: document.getElementById('gy-004')?.open ?? null }));
  ok('the old /graveyard#gy-004 link lands on /idea-graveyard with that entry open', at.path === '/idea-graveyard' && at.hash === '#gy-004' && at.open === true, JSON.stringify(at));
  await page.close();
}

// Submit
{
  const page = await open('/submit');
  const sizes = await page.evaluate(() => [...document.querySelectorAll('textarea, input[type=text], input[type=search], select')].map((e) => parseFloat(getComputedStyle(e).fontSize)));
  ok('submit: text boxes are 16px or more, so iPhone does not zoom in on them', sizes.every((s) => s >= 16), sizes.join(','));
  await tap(page, '.agree');
  ok('submit: tapping the consent text ticks the box', await page.$eval('#consent', (c) => c.checked));
  await page.close();
}
for (const path of ['/contributions', '/idea-graveyard']) {
  const page = await open(path);
  const sizes = await page.evaluate(() => [...document.querySelectorAll('textarea, input[type=text], input[type=search], select')].map((e) => parseFloat(getComputedStyle(e).fontSize)));
  ok(`${path}: form text is 16px or more`, sizes.every((s) => s >= 16), sizes.join(','));
  await page.close();
}

await browser.close();
console.log(results.join('\n'));
