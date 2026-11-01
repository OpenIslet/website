import test from 'node:test';
import assert from 'node:assert/strict';
import { build, transform } from 'esbuild';
import vm from 'node:vm';
import { readFile, writeFile, mkdir, mkdtemp, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let importId = 0;
async function loadTs(relative, overrides = {}) {
  const result = await build({
    entryPoints: [join(root, relative)], bundle: true, write: false,
    format: 'esm', platform: 'node', logLevel: 'silent',
    define: { 'import.meta.env': '{}' },
    plugins: [{ name: 'independent-test-inputs', setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) => Object.hasOwn(overrides, args.path)
        ? { path: args.path, namespace: 'test-input' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'test-input' }, (args) => ({ contents: overrides[args.path], loader: 'ts' }));
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text + `\n// ${++importId}`).toString('base64')}`);
}

const tokenInputs = {
  './site': `export const release = {version:'v0.8.0',date:'2026-10-25',counts:{experimentalStructures:8,predictedStructures:2},variance:{assumptions:80,overlap:15,findings:5}}; export const longDate = x => x;`,
  './scenarios': `export const designScore = () => ({edits:4,baseEdits:0,weakestTest:'2B',rank:1,composite:0.1085}); export const xAgainstA = () => ({sameTests:true,lowerOverall:true});`,
  './graveyard': 'export const rules = [];',
};
test('specification tokens reject inherited and unknown names', async () => {
  const { fillTokens } = await loadTs('src/data/specTokens.ts', tokenInputs);
  assert.equal(fillTokens('{{version}}/{{version}}'), 'v0.8.0/v0.8.0');
  for (const key of ['constructor', 'toString', '__proto__', 'not_a_token']) {
    assert.throws(() => fillTokens(`{{${key}}}`), Error, key);
  }
});

test('valid contributor handles cannot collide with Object prototype properties', async () => {
  const rows = ['constructor', 'toString', '__proto__'].map((handle, i) => ({
    id:`IIP-${i}`, date:'2026-10-25', title:'Synthetic test', summary:'fixture', type:'test', status:'merged',
    contributor:{handle,kind:'person',verified:{github:false,orcid:false}},models:[],outcome:{kind:'changed_blueprint',note:'fixture'},
  }));
  const { contributors } = await loadTs('src/data/contributions.ts', {
    './contributions.json': `export default ${JSON.stringify(rows)};`,
    './specTokens': 'export const fillTokens = x => x;',
  });
  for (const handle of rows.map(x => x.contributor.handle)) {
    const found = contributors.find(c => c.handle === handle);
    assert.deepEqual(found?.did, [{ key: 'changed_blueprint', label: 'Changed the blueprint', n: 1 }]);
    assert.equal(found?.contributions.length, 1);
  }
});

test('graveyard shorthand must resolve to exactly one source rule', async () => {
  const entry = {id:'GY-1',source:'GRAVEYARD_001_',title:'fixture',added:'2026-10-25',version:'v0.8.0'};
  const source = {graveyard_id:'GRAVEYARD_001_A',severity_level:'WARN',curation_status:'corroborated',evidence_basis_class:'direct_islet_empirical',supporting_pmids:[]};
  const overrides = (sources) => ({
    './graveyard.json': `export default ${JSON.stringify([entry])};`,
    './idea_graveyard_v0.5.json': `export default ${JSON.stringify({graveyard_entries:sources})};`,
  });
  assert.equal((await loadTs('src/data/graveyard.ts',overrides([source]))).rules.length,1);
  await assert.rejects(loadTs('src/data/graveyard.ts',overrides([source,{...source,graveyard_id:'GRAVEYARD_001_B'}])),Error);
});

test('an unknown group selection leaves the visible panel and aria state intact', async () => {
  const { wireGroup } = await loadTs('src/scripts/group.ts');
  function element(id) { return {dataset:{path:id},hidden:id!=='ai',attrs:{'aria-pressed':String(id==='ai')},setAttribute(k,v){this.attrs[k]=v;},addEventListener(){}}; }
  const buttons = ['ai','lab'].map(element), panels = ['ai','lab'].map(element);
  const changes=[];
  const select = wireGroup({key:'path',buttons:'buttons',panels:'panels',root:{querySelectorAll:s=>s==='buttons'?buttons:panels},onChange:id=>changes.push(id)});
  select('unrecognized-hash');
  assert.deepEqual(panels.map(p=>p.hidden),[false,true]);
  assert.deepEqual(buttons.map(b=>b.attrs['aria-pressed']),['true','false']);
  assert.deepEqual(changes,[]);
  select('lab');
  assert.deepEqual(panels.map(p=>p.hidden),[true,false]);
  assert.deepEqual(changes,['lab']);
});

test('rapid double copyWithFlash preserves original button label across overlapping timers', async () => {
  const { copyWithFlash } = await loadTs('src/scripts/group.ts');
  const timers = new Map();
  let nextTimerId = 1;
  const prevWindow = globalThis.window;
  const prevNav = globalThis.navigator;
  globalThis.window = {
    setTimeout(fn) { const id = nextTimerId++; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { async writeText() {} } },
    configurable: true,
    writable: true,
  });
  try {
    const button = { textContent: 'Copy prompt', querySelector: () => null };
    await copyWithFlash(button, 'first');
    assert.equal(button.textContent, 'Copied');
    assert.equal(timers.size, 1);
    await copyWithFlash(button, 'second');
    assert.equal(button.textContent, 'Copied');
    assert.equal(timers.size, 1);
    for (const fn of [...timers.values()]) fn();
    assert.equal(button.textContent, 'Copy prompt');
  } finally {
    globalThis.window = prevWindow;
    Object.defineProperty(globalThis, 'navigator', {
      value: prevNav,
      configurable: true,
      writable: true,
    });
  }
});

test('copyWithFlash flashes only the visible label and keeps the hidden words for screen readers', async () => {
  const { copyWithFlash } = await loadTs('src/scripts/group.ts');
  const timers = new Map();
  let nextTimerId = 1;
  const prevWindow = globalThis.window;
  const prevNav = globalThis.navigator;
  globalThis.window = {
    setTimeout(fn) { const id = nextTimerId++; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { async writeText() {} } },
    configurable: true,
    writable: true,
  });
  try {
    const visible = { textContent: 'Copy' };
    const button = { textContent: 'Copy Reviewer prompt', querySelector: (sel) => (sel === '[data-copy-text]' ? visible : null) };
    await copyWithFlash(button, 'text');
    assert.equal(visible.textContent, 'Copied');
    assert.equal(button.textContent, 'Copy Reviewer prompt');
    for (const fn of [...timers.values()]) fn();
    assert.equal(visible.textContent, 'Copy');
  } finally {
    globalThis.window = prevWindow;
    Object.defineProperty(globalThis, 'navigator', {
      value: prevNav,
      configurable: true,
      writable: true,
    });
  }
});

test('the contributions board filters by outcome, lists newest first and never ranks', async () => {
  const source=await readFile(join(root,'src/pages/contributions.astro'),'utf8');
  assert.doesNotMatch(source,/impact score|weights|crow__rank|Highest impact/i);
  const script=source.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const item=(outcome)=>({dataset:{outcome},hidden:false});
  const row=(name,last,items)=>({dataset:{name,last,kind:'person',outcomes:items.map(i=>i.dataset.outcome).join(' '),search:name},hidden:false,items,querySelectorAll:()=>items});
  const a=row('alpha','2026-11-02',[item('changed_blueprint'),item('waiting')]);
  const b=row('beta','2026-11-09',[item('dead_end')]);
  const order=[];
  const listeners=[];
  const control=(value)=>({value,form:null,blur(){},addEventListener:(type,f)=>{if(type==='input')listeners.push(f);}});
  const els={q:control(''),kind:control('all'),outcome:control('all'),sort:control('recent'),count:{textContent:''},empty:{hidden:true},rows:{appendChild:(r)=>order.push(r.dataset.name)}};
  const document={querySelectorAll:()=>[a,b],getElementById:(id)=>els[id]};
  vm.runInNewContext((await transform(script,{loader:'ts',format:'iife'})).code,{document});
  assert.deepEqual(order,['beta','alpha']);
  els.outcome.value='changed_blueprint';
  order.length=0;
  listeners[0]();
  assert.equal(a.hidden,false);
  assert.equal(b.hidden,true);
  assert.deepEqual(a.items.map(i=>i.hidden),[false,true]);
  assert.equal(els.count.textContent,'1 contributor');
  els.outcome.value='all';
  els.sort.value='name';
  order.length=0;
  listeners[0]();
  assert.deepEqual(order,['alpha','beta']);
});

const validArgs=['--version','v0.8.1','--title','Fixture title','--summary','Fixture summary','--fixed','Fixture change'];
async function runChangelog(args, {opens, env}={}) {
  const dir=await mkdtemp(join(tmpdir(),'openislet-changelog-test-'));
  try {
    await mkdir(join(dir,'scripts')); await mkdir(join(dir,'src/data'),{recursive:true});
    await copyFile(join(root,'scripts/add-changelog-entry.mjs'),join(dir,'scripts/add-changelog-entry.mjs'));
    if (opens) await writeFile(join(dir,'src/data/versions.ts'),`export const draft = { opens: '${opens}' };\n`);
    const path=join(dir,'src/data/changelog.json'); const before='[]\n'; await writeFile(path,before);
    const result=spawnSync(process.execPath,[join(dir,'scripts/add-changelog-entry.mjs'),...args],{encoding:'utf8',env:{...process.env,...env}});
    return {...result,before,after:await readFile(path,'utf8')};
  } finally { await rm(dir,{recursive:true,force:true}); }
}
for (const [name, mutate] of [
  ['version suffix', a=>a.map((v,i)=>i===1?'v0.8.1garbage':v)],
  ['impossible date', a=>[...a,'--date','2026-02-30']],
  ['non-ISO date', a=>[...a,'--date','tomorrow']],
  ['unknown flag', a=>[...a,'--titlle','typo']],
  ['duplicate singular flag', a=>[...a,'--version','v0.8.2']],
  ['stray positional', a=>[...a,'unexpected']],
  ['empty title', a=>a.map((v,i)=>i===3?'   ':v)],
]) test(`changelog rejects ${name} without writing`,async()=>{
  const result=await runChangelog(mutate(validArgs));
  assert.notEqual(result.status,0);
  assert.equal(result.after,result.before);
});
test('changelog accepts an exact release and real leap day',async()=>{
  const result=await runChangelog([...validArgs,'--date','2028-02-29']);
  assert.equal(result.status,0,result.stderr);
  const saved=JSON.parse(result.after);
  assert.equal(saved.length,1); assert.equal(saved[0].date,'2028-02-29');
});

// The changelog starts at release (Kev, 26 October 2026): nothing dated before the open draft opens is reported.
test('changelog refuses an entry dated before the open draft opens',async()=>{
  const result=await runChangelog([...validArgs,'--date','2026-10-31'],{opens:'2026-11-01'});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/starts when the open draft opens \(2026-11-01\)/);
  assert.equal(result.after,result.before);
});
test('changelog accepts an entry from the day the open draft opens',async()=>{
  const result=await runChangelog([...validArgs,'--date','2026-11-01'],{opens:'2026-11-01'});
  assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.after)[0].date,'2026-11-01');
});
test('changelog can be told to accept an earlier entry on purpose',async()=>{
  const result=await runChangelog([...validArgs,'--date','2026-10-31'],{opens:'2026-11-01',env:{CHANGELOG_BEFORE_RELEASE:'1'}});
  assert.equal(result.status,0,result.stderr);
});
