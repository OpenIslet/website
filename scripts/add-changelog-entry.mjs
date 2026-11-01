// Adds one entry to the top of the blueprint changelog (src/data/changelog.json).
//
//   npm run changelog -- --version v0.8.1 --title "Hour-zero CD47 fix" \
//     --summary "A reviewer found the CD47 target was too low, and the design was changed." \
//     --fixed "Raised the CD47 target to 200,000 molecules per cell." \
//     --added "A new Idea Graveyard rule." --contribution IIP-0002
//
// Use --added, --changed, --fixed and --removed once per line, as many times as you need.
// --date defaults to today. The review pipeline can call this same script when it merges a change.
// It refuses entries dated before the open draft opens: the changelog starts at release.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const path = join(resolve(here, '..'), 'src/data/changelog.json');

const args = process.argv.slice(2);
const one = {};
const changes = [];
const kinds = ['added', 'changed', 'fixed', 'removed'];
const singular = new Set(['version', 'title', 'summary', 'date', 'contribution']);

function invalid(message) {
  console.error(message);
  process.exit(1);
}

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (!a.startsWith('--')) invalid(`Unexpected positional argument: ${a}`);
  const key = a.slice(2);
  if (!kinds.includes(key) && !singular.has(key)) invalid(`Unknown argument: ${a}`);
  if (singular.has(key) && Object.hasOwn(one, key)) invalid(`Duplicate argument: ${a}`);
  const value = args[i + 1];
  if (value === undefined || value.startsWith('--') || value.trim().length === 0) {
    console.error(`Missing a value after ${a}`);
    process.exit(1);
  }
  i++;
  if (kinds.includes(key)) changes.push({ kind: key, text: value });
  else one[key] = value;
}

const missing = ['version', 'title', 'summary'].filter((k) => !one[k]);
if (missing.length || changes.length === 0) {
  console.error(
    `Needs ${missing.length ? missing.map((k) => `--${k}`).join(', ') + ' and ' : ''}at least one of --added, --changed, --fixed or --removed.\n` +
      'Example: npm run changelog -- --version v0.8.1 --title "A short title" --summary "One plain sentence." --fixed "What changed."',
  );
  process.exit(1);
}
const number = '(?:0|[1-9]\\d*)';
const identifier = `(?:${number}|\\d*[A-Za-z-][0-9A-Za-z-]*)`;
const versionPattern = new RegExp(`^v${number}\\.${number}\\.${number}(?:-${identifier}(?:\\.${identifier})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`);
if (!versionPattern.test(one.version)) {
  console.error(`The version should look like v0.8.1, not "${one.version}".`);
  process.exit(1);
}
const date = one.date ?? new Date().toISOString().slice(0, 10);
const parsedDate = new Date(`${date}T00:00:00Z`);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
  invalid(`The date must be a real calendar date in YYYY-MM-DD form: ${date}`);
}

// The changelog starts at release: nothing done before the open draft opens is reported (Kev, 26 October 2026). The opening date is read
// from src/data/versions.ts. Set CHANGELOG_BEFORE_RELEASE=1 only if that rule has changed.
const opens = await readFile(join(resolve(here, '..'), 'src/data/versions.ts'), 'utf8').then(
  (text) => /opens:\s*'(\d{4}-\d{2}-\d{2})'/.exec(text)?.[1] ?? null,
  () => null,
);
if (opens && date < opens && process.env.CHANGELOG_BEFORE_RELEASE !== '1') {
  invalid(`The changelog starts when the open draft opens (${opens}). Nothing dated ${date} is reported before then. Set CHANGELOG_BEFORE_RELEASE=1 to add it anyway.`);
}

const log = JSON.parse(await readFile(path, 'utf8'));
if (!Array.isArray(log) || log.some((e) => !e || typeof e !== 'object' || typeof e.version !== 'string')) {
  invalid('The existing changelog must be an array of versioned entries.');
}
if (log.some((e) => e.version === one.version)) {
  console.error(`${one.version} is already in the changelog. Edit src/data/changelog.json to change it.`);
  process.exit(1);
}

const entry = {
  version: one.version,
  date,
  title: one.title,
  summary: one.summary,
  changes,
  ...(one.contribution ? { contribution: one.contribution } : {}),
};
log.unshift(entry);
await writeFile(path, JSON.stringify(log, null, 2) + '\n');
console.log(`Added ${entry.version} (${entry.date}) to the changelog: ${entry.title}`);
