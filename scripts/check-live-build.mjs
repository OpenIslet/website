// Checks that a build is the live site before it is deployed, so a plain `npm run build` can never go live by mistake.
// A plain build has the submission form switched off, the pages marked noindex and the connector shown as planned.
//
//   npm run build:live && npm run check:live     (checks ./dist)
//   node scripts/check-live-build.mjs <folder>    (checks another build folder)
//
// It prints what is wrong in plain words and exits with 1, or prints "Live build: OK" and exits with 0.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = process.argv[2] ?? 'dist';
const read = (file) => (existsSync(join(dist, file)) ? readFileSync(join(dist, file), 'utf8') : null);
const problems = [];

const submit = read('submit/index.html');
const home = read('index.html');
const start = read('start/index.html');
const contributions = read('contributions/index.html');
const blueprint = read('blueprint/index.html');
const pack = read('openislet-starter-pack.md');
const changelog = JSON.parse(readFileSync('src/data/changelog.json', 'utf8'));

if (!submit || !home || !start || !blueprint || !pack) {
  problems.push(`${dist}/ is not a finished build (a page is missing). Run npm run build:live first.`);
} else {
  if (!submit.includes('data-open="true"')) problems.push('The submission form is built CLOSED: visitors would see "not open yet". Build with npm run build:live.');
  if (/<meta name="robots" content="[^"]*noindex/.test(home)) problems.push('The pages are marked noindex, so search engines would drop the site. Build with npm run build:live.');
  if (!start.includes('https://mcp.openislet.org/mcp')) problems.push('Start here does not show the live connector address (https://mcp.openislet.org/mcp).');
  if (start.includes('mcp-staging')) problems.push('Start here mentions the staging connector.');
  if (/HLA-E (?:itself )?stays unchanged/i.test(blueprint)) problems.push('Blueprint page still contains stale "HLA-E stays unchanged" text.');
  for (const entry of changelog) {
    if (entry.contribution && !blueprint.includes(`/contributions#${entry.contribution.toLowerCase()}`)) {
      problems.push(`Blueprint changelog is missing contributor credit link for ${entry.contribution}.`);
    }
  }
  const actualWords = pack.trim().split(/\s+/).length;
  const wordMatch = /About ([\d,]+) words/.exec(start);
  if (wordMatch) {
    const statedWords = Number(wordMatch[1].replace(/,/g, ''));
    if (Math.abs(actualWords - statedWords) / actualWords > 0.2) {
      problems.push(`Start here claims ~${statedWords} words, but openislet-starter-pack.md has ${actualWords} words.`);
    }
  }
}
if (contributions && contributions.includes('IIP-EXAMPLE')) problems.push('The Contributions page shows the labelled example rows. They must be off for the live site.');

if (problems.length) {
  console.error(`NOT a live build (${dist}):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`Live build: OK (${dist}: form open, pages indexable, live connector address, no example rows).`);
