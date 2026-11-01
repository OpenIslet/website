// The "realistic chance of working" estimates on the Blueprint page (src/data/success-probability.json and
// src/data/successProbability.ts). The percentages are the team's own estimates and are meant to be edited by hand, so these tests
// check that the combined figures always follow from them, and that a slip in the file stops the build instead of reaching the page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(root, 'src/data/successProbability.ts');

/** Loads the module, optionally with other JSON in place of success-probability.json. */
async function load(json) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    plugins: json
      ? [
          {
            name: 'other-json',
            setup(b) {
              b.onResolve({ filter: /success-probability\.json$/ }, () => ({ path: 'other.json', namespace: 'other' }));
              b.onLoad({ filter: /.*/, namespace: 'other' }, () => ({ contents: JSON.stringify(json), loader: 'json' }));
            },
          },
        ]
      : [],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${Math.random()}`);
}

const file = JSON.parse(await readFile(join(root, 'src/data/success-probability.json'), 'utf8'));
const odds = await load();

test('there are four hurdles, each with two percentages from 0 to 100 and the words the page needs', () => {
  assert.equal(odds.oddsGates.length, 4);
  for (const g of odds.oddsGates) {
    for (const key of ['singleArmPct', 'threeArmPct']) assert.ok(g[key] >= 0 && g[key] <= 100, `${g.id} ${key}`);
    for (const key of ['title', 'badge', 'plain', 'evidence']) assert.ok(g[key].trim().length > 0, `${g.id} ${key}`);
    assert.ok(['shown', 'partial', 'unknown'].includes(g.badgeKind), g.id);
  }
  assert.deepEqual(odds.oddsGates.map((g) => g.number), [1, 2, 3, 4]);
  assert.match(odds.oddsLastUpdated, /^\d{4}-\d{2}-\d{2}$/);
});

test('the combined figures are the hurdles multiplied together, and shown as whole numbers', () => {
  assert.ok(Math.abs(odds.combine([88, 50]) - 44) < 1e-9);
  assert.ok(Math.abs(odds.combine([100, 100]) - 100) < 1e-9);
  assert.equal(odds.combine([50, 0, 90]), 0);
  const product = (key) => odds.oddsGates.reduce((total, g) => (total * g[key]) / 100, 100);
  assert.ok(Math.abs(odds.oddsSingle - product('singleArmPct')) < 1e-9);
  assert.ok(Math.abs(odds.oddsThree - product('threeArmPct')) < 1e-9);
  assert.equal(odds.wholePercent(20.592), 21);
  assert.equal(odds.wholePercent(37.4), 37);
  // The figures at the time of writing: 88 x 78 x 50 x 60 and 88 x 82 x 72 x 72.
  assert.equal(odds.wholePercent(odds.oddsSingle), 21);
  assert.equal(odds.wholePercent(odds.oddsThree), 37);
});

test('testing three designs never lowers a hurdle, and never makes the whole more likely than any one hurdle', () => {
  for (const g of odds.oddsGates) assert.ok(g.threeArmPct >= g.singleArmPct, `${g.id}: three side by side should be at least as likely as one`);
  assert.ok(odds.oddsThree >= odds.oddsSingle);
  assert.ok(odds.oddsThree <= Math.min(...odds.oddsGates.map((g) => g.threeArmPct)));
});

test('a hurdle links to PubMed only where its evidence is a paper, and the PubMed ID is well formed', () => {
  const cited = odds.oddsGates.filter((g) => g.pmid);
  for (const g of cited) assert.match(g.pmid, /^\d{5,9}$/, g.id);
  assert.equal(new Set(cited.map((g) => g.pmid)).size, cited.length, 'a paper is cited twice');
  assert.ok(cited.length >= 2, 'the two human trials should be cited');
});

test('a slip in the file stops the build with a clear message', async () => {
  const gate = file.gates[0];
  await assert.rejects(load({ ...file, gates: [{ ...gate, singleArmPct: 120 }] }), /singleArmPct must be a number from 0 to 100/);
  await assert.rejects(load({ ...file, gates: [{ ...gate, threeArmPct: '88' }] }), /threeArmPct must be a number from 0 to 100/);
  await assert.rejects(load({ ...file, gates: [{ ...gate, badgeKind: 'proven' }] }), /badgeKind must be one of/);
  await assert.rejects(load({ ...file, gates: [{ ...gate, plain: '  ' }] }), /plain must be text and cannot be empty/);
  await assert.rejects(load({ ...file, lastUpdated: 'yesterday' }), /lastUpdated must be a date/);
  await assert.rejects(load({ ...file, gates: [] }), /at least one hurdle/);
  // ...and a good file with a changed percentage works through to the totals.
  const changed = await load({ ...file, gates: file.gates.map((g) => ({ ...g, singleArmPct: 100, threeArmPct: 100 })) });
  assert.equal(changed.wholePercent(changed.oddsSingle), 100);
});

test('the page takes its numbers from the file, so none of the figures is typed into the page', async () => {
  const section = await readFile(join(root, 'src/components/Odds.astro'), 'utf8');
  const markup = section.slice(0, section.indexOf('<style>'));
  assert.ok(!/\b(21|37)\s*%/.test(markup), 'a combined figure is written into the section instead of being worked out');
  for (const g of odds.oddsGates) {
    for (const key of ['singleArmPct', 'threeArmPct']) assert.ok(!markup.includes(`>${g[key]}%<`), `${g.id} ${key} is written into the section`);
  }
});
