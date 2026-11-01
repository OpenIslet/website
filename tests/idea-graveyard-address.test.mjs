// The Idea Graveyard lives at /idea-graveyard (Kev, 28 October 2026: the bare word "graveyard" can sound bad to people living with
// type 1 diabetes). No page links to the old address, and the old address forwards, keeping a link to one entry (#gy-004).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));

test('the page is at /idea-graveyard, and the menu points there', () => {
  assert.ok(existsSync(join(root, 'src/pages/idea-graveyard.astro')));
  assert.match(readFileSync(join(root, 'src/data/site.ts'), 'utf8'), /href: '\/idea-graveyard', label: 'Idea Graveyard'/);
});

test('no page, component or data file links to the old /graveyard address', () => {
  const offenders = files(join(root, 'src'))
    .filter((f) => /\.(astro|ts|tsx|md|json)$/.test(f) && !f.endsWith(join('pages', 'graveyard.astro')))
    .filter((f) => /(href=|['"`(])\/graveyard(?![\w-])/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(offenders.map((f) => f.slice(root.length + 1)), []);
});

test('the old address forwards to the new one and keeps the #entry part', () => {
  const page = readFileSync(join(root, 'src/pages/graveyard.astro'), 'utf8');
  assert.match(page, /const target = '\/idea-graveyard'/);
  assert.match(page, /location\.replace\(target \+ location\.search \+ location\.hash\)/);
  assert.match(page, /http-equiv="refresh"/);
  assert.match(page, /name="robots" content="noindex"/);
});
