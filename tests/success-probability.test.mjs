// The "realistic chance of working" estimates on the Blueprint page (src/data/success-probability.json and
// src/data/successProbability.ts). The percentages are the team's own computational estimates and are meant to be edited by hand, so these
// tests check that the combined figures always follow from them, and that a slip in the file stops the build instead of reaching the page.
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

test('there are four hurdles, each with percentages for A, B, X and three side by side from 0 to 100 and the words the page needs', () => {
  assert.equal(odds.oddsGates.length, 4);
  for (const g of odds.oddsGates) {
    for (const key of ['singleArmPct', 'designBPct', 'designXPct', 'threeArmPct']) {
      assert.ok(g[key] >= 0 && g[key] <= 100, `${g.id} ${key}`);
    }
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
  assert.ok(Math.abs(odds.oddsDesignA - product('singleArmPct')) < 1e-9);
  assert.ok(Math.abs(odds.oddsDesignB - product('designBPct')) < 1e-9);
  assert.ok(Math.abs(odds.oddsDesignX - product('designXPct')) < 1e-9);
  assert.ok(Math.abs(odds.oddsThree - product('threeArmPct')) < 1e-9);
  assert.equal(odds.wholePercent(20.592), 21);
  assert.equal(odds.wholePercent(37.4), 37);
  // Current 2026-11-16 figures across Designs A, B, X and three side by side:
  assert.equal(odds.wholePercent(odds.oddsDesignA), 27);
  assert.equal(odds.wholePercent(odds.oddsDesignB), 31);
  assert.equal(odds.wholePercent(odds.oddsDesignX), 36);
  assert.equal(odds.wholePercent(odds.oddsThree), 53);
});

test('testing three designs never lowers a hurdle below any single design, and never makes the whole more likely than any one hurdle', () => {
  for (const g of odds.oddsGates) {
    const bestSingle = Math.max(g.singleArmPct, g.designBPct, g.designXPct);
    assert.ok(g.threeArmPct >= bestSingle, `${g.id}: three side by side should be at least as likely as each single design`);
  }
  assert.ok(odds.oddsThree >= Math.max(odds.oddsDesignA, odds.oddsDesignB, odds.oddsDesignX));
  assert.ok(odds.oddsThree <= Math.min(...odds.oddsGates.map((g) => g.threeArmPct)));
});

test('a hurdle links to PubMed only where its evidence is a paper, and the PubMed ID is well formed', () => {
  const cited = odds.oddsGates.filter((g) => g.pmid);
  for (const g of cited) assert.match(g.pmid, /^\d{5,9}$/, g.id);
  assert.equal(new Set(cited.map((g) => g.pmid)).size, cited.length, 'a paper is cited twice');
  assert.ok(cited.length >= 2, 'the two human trials should be cited');
  for (const g of odds.oddsGates.filter((x) => x.followUpPmid)) {
    assert.match(g.followUpPmid, /^\d{5,9}$/, `${g.id} followUpPmid`);
    assert.notEqual(g.followUpPmid, g.pmid, `${g.id} followUpPmid duplicates pmid`);
  }
  const cloak = odds.oddsGates.find((g) => g.id === 'cloak');
  assert.equal(cloak?.pmid, '40757665');
  assert.equal(cloak?.followUpPmid, '42430558');
});

test('structured two-route and legacy three-slot 2^12 portfolio scenarios are exported and ordered sensibly', () => {
  const s = odds.oddsPortfolioScenarios;
  assert.equal(s.sharedAxLockedPct, 50.78);
  assert.equal(s.sharedAxModularPct, 54.12);
  assert.equal(s.legacyThreeSlotLockedPct, 52.59);
  assert.equal(s.legacyThreeSlotModularPct, 55.63);
  assert.equal(s.commonShockCeilingPct, 57.92);
  assert.ok(s.sharedAxLockedPct < s.legacyThreeSlotLockedPct);
  assert.ok(s.sharedAxLockedPct < s.sharedAxModularPct);
  assert.ok(s.legacyThreeSlotModularPct < s.commonShockCeilingPct);
});

test('a slip in the file stops the build with a clear message', async () => {
  const gate = file.gates[0];
  await assert.rejects(load({ ...file, gates: [{ ...gate, singleArmPct: 120 }] }), /singleArmPct must be a number from 0 to 100/);
  await assert.rejects(load({ ...file, gates: [{ ...gate, designBPct: -5 }] }), /designBPct must be a number from 0 to 100/);
  await assert.rejects(load({ ...file, gates: [{ ...gate, designXPct: '81' }] }), /designXPct must be a number from 0 to 100/);
  await assert.rejects(load({ ...file, gates: [{ ...gate, threeArmPct: '88' }] }), /threeArmPct must be a number from 0 to 100/);
  await assert.rejects(load({ ...file, gates: [{ ...gate, badgeKind: 'proven' }] }), /badgeKind must be one of/);
  await assert.rejects(load({ ...file, gates: [{ ...gate, plain: '  ' }] }), /plain must be text and cannot be empty/);
  await assert.rejects(load({ ...file, lastUpdated: 'yesterday' }), /lastUpdated must be a date/);
  await assert.rejects(load({ ...file, gates: [] }), /at least one hurdle/);
  // ...and a good file with a changed percentage works through to the totals.
  const changed = await load({
    ...file,
    gates: file.gates.map((g) => ({ ...g, singleArmPct: 100, designBPct: 100, designXPct: 100, threeArmPct: 100 })),
  });
  assert.equal(changed.wholePercent(changed.oddsSingle), 100);
  assert.equal(changed.wholePercent(changed.oddsDesignX), 100);
});

test('the page takes its numbers from the file, so none of the figures is typed into the page', async () => {
  const section = await readFile(join(root, 'src/components/Odds.astro'), 'utf8');
  const markup = section.slice(0, section.indexOf('<style>'));
  assert.ok(!/\b(21|26|27|31|34|36|37|51|53|54|56)\s*%/.test(markup), 'a combined figure is written into the section instead of being worked out');
  assert.ok(!/\b(50\.78|54\.12|52\.59|55\.63|57\.92)\s*%/.test(markup), 'a portfolio scenario figure is written into the section instead of being worked out');
  for (const g of odds.oddsGates) {
    for (const key of ['singleArmPct', 'designBPct', 'designXPct', 'threeArmPct']) {
      assert.ok(!markup.includes(`>${g[key]}%<`), `${g.id} ${key} is written into the section`);
    }
  }
});
