// Cross-surface consistency checks: whenever an Islet Improvement Proposal (IIP) or odds update changes a design,
// hurdle, citation, wet-lab metadata key or changelog entry, every place on the website, starter pack and connector
// that describes the same part must agree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));

test('Blueprint #odds, #designs, #spec and Home Designs carry no cross-section contradictions on Designs A, B and X', () => {
  const odds = readJson('src/data/success-probability.json');
  const blueprintTs = read('src/data/blueprint.ts');
  const specMd = read('src/content/blueprint-spec.md');
  const homeDesigns = read('src/components/Designs.astro');

  for (const [name, text] of [
    ['src/data/blueprint.ts', blueprintTs],
    ['src/content/blueprint-spec.md', specMd],
    ['src/components/Designs.astro', homeDesigns],
  ]) {
    assert.ok(!/HLA-E (?:itself )?stays unchanged/i.test(text), `${name} still claims HLA-E stays unchanged`);
  }

  const cloakPlain = odds.gates.find((g) => g.id === 'cloak')?.plain ?? '';
  if (/20-variant HLA-E/i.test(cloakPlain)) {
    assert.match(blueprintTs, /20-(?:variant|construct).*HLA-E/s, 'src/data/blueprint.ts should reflect the 20-variant HLA-E panel');
    assert.match(specMd, /20-construct.*HLA-E/s, 'src/content/blueprint-spec.md should reflect the 20-construct HLA-E panel');
  }

  const attackPlain = odds.gates.find((g) => g.id === 'attack')?.plain ?? '';
  if (/scar-free SERPINB9/i.test(attackPlain)) {
    assert.match(blueprintTs, /scar-free \(2A-free\)/i, 'src/data/blueprint.ts should explain the scar-free SERPINB9 comparator');
    assert.match(specMd, /scar-free \(`?2A`?-free\)/i, 'src/content/blueprint-spec.md should explain the scar-free SERPINB9 comparator');
  }
  if (/IL-1 and Fas/i.test(attackPlain)) {
    assert.match(blueprintTs, /Multi-miR\(IL1R1 \+ FAS\)/, 'src/data/blueprint.ts should include Multi-miR(IL1R1 + FAS) on Design X');
    assert.match(specMd, /Multi-miR\(IL1R1 \+ FAS\)/, 'src/content/blueprint-spec.md should include Multi-miR(IL1R1 + FAS)');
  }

  const oxygenPlain = odds.gates.find((g) => g.id === 'oxygen')?.plain ?? '';
  if (/140 µm bead-free/i.test(oxygenPlain)) {
    assert.match(blueprintTs, /140 µm bead-free/i, 'src/data/blueprint.ts should link Design B to the 140 µm bead-free sheet comparator');
    assert.match(specMd, /140 µm`? bead-free/i, 'src/content/blueprint-spec.md should link Design B to the 140 µm bead-free sheet comparator');
    assert.match(homeDesigns, /140 µm bead-free/i, 'src/components/Designs.astro should note the 140 µm bead-free sheet comparator');
  }
});

test('every #ref-PMID in blueprint-spec.md has full bibliography metadata in references.json, and all blueprint/OQ PMIDs are well-formed', () => {
  const refs = readJson('src/data/references.json');

  const specMd = read('src/content/blueprint-spec.md');
  const missingSpec = [...specMd.matchAll(/#ref-(\d{5,9})\b/g)]
    .map((m) => m[1])
    .filter((id) => !refs[id]?.title);
  assert.deepEqual(missingSpec, [], `Unresolved #ref-PMID citations in src/content/blueprint-spec.md: ${missingSpec.join(', ')}`);

  const blueprintTs = read('src/data/blueprint.ts');
  const badBp = [...blueprintTs.matchAll(/pmids:\s*\[([^\]]*)\]/g)]
    .flatMap((m) => [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]))
    .filter((id) => !/^\d{7,9}$/.test(id));
  assert.deepEqual(badBp, [], `Malformed pmids in src/data/blueprint.ts: ${badBp.join(', ')}`);

  const oqs = readJson('connector/data/open-questions.json');
  const badOq = oqs.flatMap((q) => (q.pmids ?? []).filter((id) => !/^\d{7,9}$/.test(String(id))).map((id) => `${q.id}:${id}`));
  assert.deepEqual(badOq, [], `Malformed pmids in connector/data/open-questions.json: ${badOq.join(', ')}`);
});

test('blueprint.astro renders contributor credits for both recent and older changelog entries', () => {
  const bpPage = read('src/pages/blueprint.astro');
  const creditBlocks = [...bpPage.matchAll(/class="cl__credit"/g)];
  assert.ok(creditBlocks.length >= 2, 'src/pages/blueprint.astro must render cl__credit in both recent and older changelog lists');
});

test('connector server derives wet-lab readout metadata keys from wetlab-endpoint-contract.json', () => {
  const serverTs = read('connector/src/server.ts');
  const contract = readJson('connector/src/core/wetlab-endpoint-contract.json');
  assert.ok(Array.isArray(contract.metadata_keys) && contract.metadata_keys.length >= 30, 'expected metadata_keys in wetlab-endpoint-contract.json');
  assert.match(serverTs, /WETLAB_METADATA_KEYS\.map/, 'connector/src/server.ts must derive wetlabReadoutsSchema metadata fields from WETLAB_METADATA_KEYS');
});

test('built starter pack word count and blueprint changelog credits stay in sync when dist/ is present', () => {
  const packPath = join(root, 'dist/openislet-starter-pack.md');
  if (existsSync(packPath)) {
    const pack = readFileSync(packPath, 'utf8');
    const actualWords = pack.trim().split(/\s+/).length;
    const startAstro = read('src/pages/start.astro');
    const m = /About ([\d,]+) words/.exec(startAstro);
    assert.ok(m, 'expected "About X,000 words" in src/pages/start.astro');
    const statedWords = Number(m[1].replace(/,/g, ''));
    const relDiff = Math.abs(actualWords - statedWords) / actualWords;
    assert.ok(
      relDiff <= 0.2,
      `src/pages/start.astro states ~${statedWords} words, but dist/openislet-starter-pack.md has ${actualWords} words`,
    );
    assert.match(pack, /Four-hurdle computational odds/, 'starter pack should include the four-hurdle computational odds section');
  }

  const bpHtmlPath = join(root, 'dist/blueprint/index.html');
  if (existsSync(bpHtmlPath)) {
    const bpHtml = readFileSync(bpHtmlPath, 'utf8');
    const changelog = readJson('src/data/changelog.json');
    for (const entry of changelog) {
      if (entry.contribution) {
        assert.ok(
          bpHtml.includes(`/contributions#${entry.contribution.toLowerCase()}`),
          `dist/blueprint/index.html is missing credit link for ${entry.contribution}`,
        );
      }
    }
  }
});
