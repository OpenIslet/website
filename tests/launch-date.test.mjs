// The launch dates live in one file, src/data/versions.ts. This test fails if a date from that file is also typed into a page,
// a component, a script or a data module, because moving the launch would then leave the site saying two different things.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const src = path.join(root, 'src');
const versionsFile = path.join(src, 'data', 'versions.ts');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const read = fs.readFileSync(versionsFile, 'utf8');
const dates = [...read.matchAll(/(opens|freezeFrom|lock):\s*'(\d{4})-(\d{2})-(\d{2})'/g)].map((m) => ({
  kind: m[1],
  y: Number(m[2]),
  m: Number(m[3]),
  d: Number(m[4]),
}));

/** The ways a date is likely to be typed by hand. The open draft's day is also caught without a year ("1 November"). */
function spellings({ kind, y, m, d }) {
  const month = MONTHS[m - 1];
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const out = [new RegExp(`(?<!\\d)${d} ${month} ${y}\\b`), new RegExp(`\\b${month} ${d},? ${y}\\b`), new RegExp(iso)];
  if (kind === 'opens') out.push(new RegExp(`(?<!\\d)${d} ${month}\\b`));
  return out;
}

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return /\.(astro|ts|md|mjs)$/.test(e.name) ? [p] : [];
  });
}

test('the version plan has the dates this guard reads', () => {
  assert.ok(dates.some((x) => x.kind === 'opens'), 'expected the open draft date in src/data/versions.ts');
  assert.ok(dates.filter((x) => x.kind === 'lock').length >= 4, 'expected the planned locks in src/data/versions.ts');
});

test('no page, component or data module types a version date in by hand', () => {
  const offenders = [];
  for (const file of files(src)) {
    if (file === versionsFile) continue;
    // src/data/connect.ts holds the day the assistants' steps were last checked. That is not a launch date, but it can fall on the
    // same day, so that one line is not scanned.
    const text = fs.readFileSync(file, 'utf8').replace(/^export const checkedOn = '[^']*';\s*$/m, '');
    for (const date of dates) {
      for (const re of spellings(date)) {
        const hit = re.exec(text);
        if (hit) offenders.push(`${path.relative(root, file)}: "${hit[0]}"`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'Write launch and lock dates in src/data/versions.ts only, and read them from there.');
});
