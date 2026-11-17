import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

async function loadTs(relative) {
  const result = await build({
    entryPoints: [join(root, relative)],
    bundle: true,
    write: false,
    metafile: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    define: { 'import.meta.env': '{}' },
  });
  const mod = await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
  );
  return { mod, inputs: Object.keys(result.metafile.inputs).filter((k) => !k.startsWith('<')) };
}

function walkFiles(dir, exts) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkFiles(full, exts));
    else if (exts.some((ext) => entry.endsWith(ext))) out.push(full);
  }
  return out;
}

test('future.ts is strictly isolated in both directions from starter pack, blueprint, roadmap, and connector', async () => {
  const { mod, inputs } = await loadTs('src/data/future.ts');
  assert.deepEqual(inputs, ['src/data/future.ts'], 'src/data/future.ts must have zero external data imports');

  const checkFiles = [
    ...walkFiles(join(root, 'src'), ['.ts', '.astro', '.mjs']),
    ...walkFiles(join(root, 'connector'), ['.ts', '.mjs', '.json']),
  ].filter(
    (f) => !f.endsWith('src/data/future.ts') && !f.endsWith('src/pages/future.astro')
  );

  for (const file of checkFiles) {
    const content = readFileSync(file, 'utf8');
    assert.doesNotMatch(
      content,
      /['"`][^'"`]*data\/future(?:\.ts)?['"`]|['"`]\.\/future(?:\.ts)?['"`]/,
      `${file} must not import isolated forward-planning module src/data/future.ts`
    );
  }

  // Every proposal collection carries explicit unbuilt metadata and null version/date/regulatory fields
  const collections = [
    mod.timelineStages,
    mod.horizon1Items,
    mod.horizon2Items,
    mod.horizon3Padlocks,
    mod.failureModes,
    mod.ruledOutByPhysics,
  ];
  for (const list of collections) {
    assert.ok(Array.isArray(list) && list.length > 0);
    for (const item of list) {
      assert.equal(item.status, 'unbuilt proposal', `${item.id} must be marked 'unbuilt proposal'`);
      assert.equal(item.assignedVersion, null, `${item.id} must have assignedVersion: null`);
      assert.equal(item.calendarDate, null, `${item.id} must have calendarDate: null`);
      assert.equal(item.regulatoryAgreement, null, `${item.id} must have regulatoryAgreement: null`);
    }
  }

  // Safety ratchet invariant: safetyUnits never shrink across scenarios, while waitUnits strictly compress
  const [seq, prep, floor] = mod.scenarios;
  assert.deepEqual(seq.safetyUnits, mod.LOCKED_SAFETY_UNITS);
  assert.deepEqual(prep.safetyUnits, mod.LOCKED_SAFETY_UNITS);
  assert.deepEqual(floor.safetyUnits, mod.LOCKED_SAFETY_UNITS);
  for (let i = 0; i < mod.LOCKED_SAFETY_UNITS.length; i++) {
    assert.ok(seq.waitUnits[i] > prep.waitUnits[i], `stage ${i + 1} waitUnits should shrink from sequential to prepared`);
    assert.ok(prep.waitUnits[i] > floor.waitUnits[i], `stage ${i + 1} waitUnits should shrink from prepared to floor`);
  }

  // 100-dot setback distributions sum to 100
  for (const mode of mod.setbackModes) {
    assert.equal(mode.cleanCount + mode.moderateRepeatCount + mode.bunchedRepeatCount, 100, `${mode.id} must total 100 runs`);
  }

  // Unified 2D FVM cup-and-gap stop rule (>=1% cluster volume <5 mmHg): 15 µm clean water and 10 µm fouled fluid must be 'starved'
  const tierAt = (opt, gap) => mod.ladderModel.rules[opt].find((t) => t.upTo === null || gap <= t.upTo);
  assert.equal(tierAt('water', 5).verdictKey, 'comfortable');
  assert.equal(tierAt('water', 10).verdictKey, 'tight');
  assert.equal(tierAt('water', 15).verdictKey, 'starved');
  assert.equal(tierAt('fouled', 5).verdictKey, 'tight');
  assert.equal(tierAt('fouled', 10).verdictKey, 'starved');
  assert.equal(tierAt('pfc', 45).verdictKey, 'comfortable');
  assert.equal(tierAt('pfc', 45).rowStatuses[3], 'tight');
  assert.equal(tierAt('pfc', 45).rowStatuses[5], 'comfortable');
});

const FORBIDDEN_COMMERCIAL = /\b(?:costs?|price|prices|pricing|afford|affordable|affordability|cheaper|profits?|funds?|funding|funded|contracts?|contracting|money|reimbursements?)\b|\$(?!\{)|["'“”‘’]free["'“”‘’]|per DEC-093/i;
const FORBIDDEN_VERSIONS = /\bIslet-1\.[123]\b|\bIslet-3\b/;
const FORBIDDEN_PLAIN_SHORTHAND = /\b(?:CLK-[1-6]|CBER|Pre-RFD|UBMTA|ISTAND|NAMs|Lantidra|ZT0|ZT12)\b|21 CFR 1271/;

test('future source files obey commercial, version, shorthand, and share-card guardrails', async () => {
  const futureTs = read('src/data/future.ts');
  const siteTs = read('src/data/site.ts');

  // The page is layout only; its parts are the components in src/components/future/. Every one of them is checked.
  // Strip <script> and <style> blocks before prose checks (since JS template literals use `${...}`)
  const markupOf = (text) => text.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  const partFiles = readdirSync(join(root, 'src/components/future'))
    .filter((f) => f.endsWith('.astro'))
    .map((f) => `src/components/future/${f}`);
  const markups = ['src/pages/future.astro', ...partFiles].map((rel) => [`${rel} (markup)`, markupOf(read(rel))]);
  const astroMarkup = markups.map(([, text]) => text).join('\n');

  for (const [name, text] of [
    ['src/data/future.ts', futureTs],
    ...markups,
  ]) {
    assert.doesNotMatch(text, FORBIDDEN_COMMERCIAL, `${name} contains forbidden commercial/money wording`);
    assert.doesNotMatch(text, FORBIDDEN_VERSIONS, `${name} references reserved Islet-1.x / Islet-3 versions`);
    assert.doesNotMatch(text, /OpenIslet Constitution/i, `${name} must leave out the parked Constitution`);
    assert.doesNotMatch(text, /\bVerified\b/, `${name} must not mark unbuilt proposals as Verified`);
  }

  // Share card alt text in site.ts and #bench-shelf-svg <text> nodes must be strictly numberless
  const altMatch = /future:\s*\{\s*src:\s*'\/og\/future\.jpg',\s*alt:\s*'([^']+)'/.exec(siteTs);
  assert.ok(altMatch, 'pageShareImages.future must be configured in src/data/site.ts');
  assert.doesNotMatch(altMatch[1], /\d/, 'pageShareImages.future.alt must be numberless');
  assert.doesNotMatch(altMatch[1], FORBIDDEN_COMMERCIAL, 'pageShareImages.future.alt must have zero commercial terms');

  const benchSvgMatch = /<svg[^>]*id="bench-shelf-svg"[\s\S]*?<\/svg>/.exec(astroMarkup);
  assert.ok(benchSvgMatch, 'the /future page must render #bench-shelf-svg (src/components/future/BenchShelfArt.astro)');
  const svgTextNodes = [...benchSvgMatch[0].matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1]);
  assert.ok(svgTextNodes.length >= 5, '#bench-shelf-svg should contain descriptive labels');
  for (const label of svgTextNodes) {
    assert.doesNotMatch(label, /\d/, `#bench-shelf-svg text "${label}" must remain numberless for the share card`);
  }

  // The picture's labels are filled from pageCopy.benchShelf, so the words themselves are checked too.
  const { mod } = await loadTs('src/data/future.ts');
  const { svgTitle, captionBench, captionShelf, ...onPicture } = mod.pageCopy.benchShelf;
  const pictureLabels = Object.values(onPicture).flat();
  assert.ok(pictureLabels.length >= 5, 'pageCopy.benchShelf should hold the labels drawn on #bench-shelf-svg');
  for (const label of pictureLabels) {
    assert.doesNotMatch(label, /\d/, `#bench-shelf-svg label "${label}" must remain numberless for the share card`);
    assert.doesNotMatch(label, FORBIDDEN_COMMERCIAL, `#bench-shelf-svg label "${label}" must have zero commercial terms`);
  }
});

test('rendered dist/future/index.html and dist/openislet-starter-pack.md pass full hygiene checks when built', () => {
  const htmlPath = join(root, 'dist/future/index.html');
  if (!existsSync(htmlPath)) return;

  const html = readFileSync(htmlPath, 'utf8');
  const withoutScriptsStyles = html
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<head[\s\S]*?<\/head>/g, '');

  assert.doesNotMatch(withoutScriptsStyles, FORBIDDEN_COMMERCIAL, 'dist/future/index.html contains forbidden commercial wording');
  assert.doesNotMatch(withoutScriptsStyles, FORBIDDEN_VERSIONS, 'dist/future/index.html references Islet-1.1/1.2/1.3 or Islet-3');
  assert.doesNotMatch(withoutScriptsStyles, /enroll now|join our trial|recruiting participants for/i);

  // Strip <details class="sci">...</details> to verify plain-English surface copy
  const plainSurface = withoutScriptsStyles.replace(/<details class="sci[^"]*"[\s\S]*?<\/details>/g, '');
  assert.doesNotMatch(plainSurface, /\b25\s*kg\b/i, '25 kg mass-scaling arithmetic must stay strictly inside For scientists drawers');
  assert.doesNotMatch(plainSurface, /9[–-]16\s*mmHg|9\.4\s*mmHg|15\.7\s*mmHg/i, 'plain copy must not claim point mmHg core margins');
  assert.doesNotMatch(plainSurface, FORBIDDEN_PLAIN_SHORTHAND, 'plain copy must not contain insider/US-only shorthand');
  assert.doesNotMatch(plainSurface, /\bG-(?:0[1-9]|1[0-6])\b/, 'plain copy must not expose internal G-01..G-16 gate codes');
  assert.doesNotMatch(plainSurface, /\*\*/, 'rendered HTML must not contain unparsed ** markdown asterisks');
  assert.doesNotMatch(withoutScriptsStyles, /`/, 'rendered HTML must not contain literal markdown backticks');
  assert.match(html, /\b25 kg\b/, 'For scientists drawer should retain the illustrative 25 kg geometry note');
  assert.match(plainSurface, /Illustrative planning model — not OpenIslet’s plan for any partner/);
  assert.match(plainSurface, /OpenIslet is not recruiting participants/);
  assert.match(plainSurface, /Ahead of Month 0/);

  assert.ok(existsSync(join(root, 'public/og/future.jpg')), 'public/og/future.jpg must exist');

  const packPath = join(root, 'dist/openislet-starter-pack.md');
  if (existsSync(packPath)) {
    const pack = readFileSync(packPath, 'utf8');
    assert.doesNotMatch(pack, /Shut padlock|Oxygen Margin Ladder|Ruled out by physics during forward-planning/i);
  }
});
