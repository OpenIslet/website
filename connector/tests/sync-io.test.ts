import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { rename } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { websiteRoot, connectorRoot } from './helpers';
// @ts-expect-error Runtime JavaScript helper is tested directly.
import { readPinnedSource, assertPublicDownload, publishFiles } from '../../scripts/sync-io.mjs';
const dirs: string[] = [];
const temp = () => { const p=fs.mkdtempSync(path.join(os.tmpdir(),'oi-sync-')); dirs.push(p); return p; };
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
afterEach(() => { for (const p of dirs.splice(0)) fs.rmSync(p,{recursive:true,force:true}); });

describe('One-snapshot website sync', () => {
  it('reads original source bytes against their exported origin pin, and rejects drift', async () => {
    const r=temp();fs.writeFileSync(path.join(r,'rank.json'),'original');
    const mf={artifacts:{'rank.json':{sha256:sha('public transform'),local_audit_tree_sha256:sha('original')}}};
    expect((await readPinnedSource(r,mf,'rank.json')).toString()).toBe('original');
    fs.writeFileSync(path.join(r,'rank.json'),'changed');
    await expect(readPinnedSource(r,mf,'rank.json')).rejects.toThrow(/changed since public export/);
  });
  it('permits only exact public inventory download paths', () => {
    const m={public_export_file_inventory:['data/public.json']};
    expect(() => assertPublicDownload(m,'data/public.json')).not.toThrow();
    for (const p of ['../private','/absolute','data/../public.json','data/private.json']) expect(()=>assertPublicDownload(m,p)).toThrow();
  });
  it('restores earlier files when a later publication rename fails', async () => {
    const r=temp();const a=path.join(r,'a');const b=path.join(r,'b');fs.writeFileSync(a,'old-a');fs.writeFileSync(b,'old-b');let calls=0;
    await expect(publishFiles(r,new Map([[a,Buffer.from('new-a')],[b,Buffer.from('new-b')]]),{renameFile:async(s:string,t:string)=>{if(++calls===2)throw new Error('injected failure');return rename(s,t);}})).rejects.toThrow(/injected failure/);
    expect(fs.readFileSync(a,'utf8')).toBe('old-a');expect(fs.readFileSync(b,'utf8')).toBe('old-b');
    expect(fs.readdirSync(r).some(x=>x.startsWith('.openislet-sync-'))).toBe(false);
  });
  it('retains recovery material if restoration itself fails', async () => {
    const r=temp();const a=path.join(r,'a');const b=path.join(r,'b');fs.writeFileSync(a,'old-a');fs.writeFileSync(b,'old-b');let calls=0;
    await expect(publishFiles(r,new Map([[a,Buffer.from('new-a')],[b,Buffer.from('new-b')]]),{renameFile:async(s:string,t:string)=>{if(++calls>=2)throw new Error('injected failure');return rename(s,t);}})).rejects.toThrow(/recovery files preserved/);
    const recovery=fs.readdirSync(r).find(x=>x.startsWith('.openislet-sync-'))!;
    expect(fs.readFileSync(path.join(r,recovery,'old-0'),'utf8')).toBe('old-a');
  });
  it('rejects destination escape before publishing any files', async () => {
    const r=temp();const outside=temp();const a=path.join(r,'a');fs.writeFileSync(a,'old');
    await expect(publishFiles(r,new Map([[a,Buffer.from('new')],[path.join(outside,'escape'),Buffer.from('bad')]]))).rejects.toThrow(/escapes/);
    expect(fs.readFileSync(a,'utf8')).toBe('old');
  });
  it('the real sync CLI refuses a ranking mutation after export and preserves website files', () => {
    const t=temp();const w=path.join(t,'website');const r=path.join(t,'science');
    for(const d of [path.join(w,'scripts'),path.join(w,'src/data'),path.join(w,'connector/scripts'),path.join(w,'connector/src/core'),path.join(r,'scripts'),path.join(r,'data/extracted')])fs.mkdirSync(d,{recursive:true});
    fs.copyFileSync(process.env.ROUND2_SYNC_SOURCE??path.join(websiteRoot,'scripts/sync-data.mjs'),path.join(w,'scripts/sync-data.mjs'));
    fs.copyFileSync(path.join(websiteRoot,'scripts/sync-io.mjs'),path.join(w,'scripts/sync-io.mjs'));
    fs.copyFileSync(path.join(connectorRoot,'scripts/bundle-io.mjs'),path.join(w,'connector/scripts/bundle-io.mjs'));
    fs.copyFileSync(path.join(connectorRoot,'scripts/regular-files.mjs'),path.join(w,'connector/scripts/regular-files.mjs'));
    fs.writeFileSync(path.join(w,'src/data/assets.json'),JSON.stringify([{path:'manifest.json'},{path:'ISLET-1-BLUEPRINT.md'}]));
    fs.writeFileSync(path.join(w,'src/data/release.json'),'previous-good-release');
    const rankings={ranked_candidate_architectures:[],total_valid_combinatorial_stacks_evaluated:1620,total_feasible_unblocked_stacks:360,total_graveyard_blocked_stacks:1260,direct_output_logit_sensitivity_and_variance_decomposition:{uniform_grid_pooled_pediatric_gate_logit_variance_decomposition:{structural_share_of_total_variance:.99,empirical_gene_signal_share_of_total_variance:.001}}};
    const rankText=JSON.stringify(rankings);fs.writeFileSync(path.join(r,'data/extracted/islet1_candidate_stack_rankings.json'),rankText);
    fs.writeFileSync(path.join(r,'ISLET-1-BLUEPRINT.md'),'**Date:** 2026-10-24');
    const payloads:Record<string,string>={'ISLET-1-BLUEPRINT.md':'**Date:** 2026-10-24','data/graveyard/idea_graveyard_v0.5.json':'{}','data/protocols/wetlab_endpoint_contract_v0.8.0.json':'{}','data/constructs/islet1_scenario_a_constructs_v0.7.0.fasta':'>fixture\nATG\n'};
    for(const name of ['layer1_context_evidence_graph_atlas','layer2_regulatory_and_perturbation_atlas','layer3_structural_verification_atlas','layer4_tissue_and_metabolic_twin_atlas','layer5_personalized_patient_and_crispr_atlas'])payloads[`data/extracted/${name}.json`]='{}';
    const artifacts:Record<string,{sha256:string;bytes:number}>=Object.fromEntries(Object.entries(payloads).map(([k,v])=>[k,{sha256:sha(v),bytes:Buffer.byteLength(v)}]));artifacts['data/extracted/islet1_candidate_stack_rankings.json']={sha256:sha(rankText),bytes:Buffer.byteLength(rankText)};
    const counts=Object.fromEntries(['extracted_studies_total','extracted_arms_total','extracted_atomic_effects_total','ceg_screened_records_total','ceg_studies_total','ceg_arms_total','ceg_outcomes_total','ceg_blueprint_links_total','graveyard_entries_total','layer2_construct_cassettes_total','layer3_pdb_experimental_structures_verified','layer3_alphafold_structures_verified','layer3_immune_synapse_complexes_verified','layer5_crispr_guides_compiled','layer5_virtual_patients_simulated'].map(k=>[k,1]));
    const mf={schema_version:'OpenIsletManifest_v0.8.0',counts,artifacts,public_export_file_inventory:Object.keys(payloads)};
    fs.writeFileSync(path.join(r,'manifest.json'),JSON.stringify(mf));fs.writeFileSync(path.join(r,'fixture.json'),JSON.stringify({payloads,manifest:mf}));
    fs.writeFileSync(path.join(r,'scripts/generate_release_manifest.py'),`import pathlib,json,sys,os\nr=pathlib.Path(__file__).resolve().parents[1];d=pathlib.Path(sys.argv[sys.argv.index('--export-public-bundle')+1]);d.mkdir(parents=True);x=json.loads((r/'fixture.json').read_text())\nfor rel,value in x['payloads'].items():\n p=d/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(value)\n(d/'manifest.json').write_text(json.dumps(x['manifest']));(d/'.openislet_public_bundle').write_text('openislet_public_bundle_fixture')\nif os.environ.get('ROUND2_MUTATE_RANKING')=='1':\n p=r/'data/extracted/islet1_candidate_stack_rankings.json';a=json.loads(p.read_text());a['total_valid_combinatorial_stacks_evaluated']=9999;p.write_text(json.dumps(a))\n`);
    const result=spawnSync(process.execPath,[path.join(w,'scripts/sync-data.mjs')],{env:{...process.env,OPENISLET_REPO:r,ROUND2_MUTATE_RANKING:'1'},encoding:'utf8'});
    expect(result.status,result.stdout+result.stderr).not.toBe(0);
    expect(result.stderr).toContain('changed since public export');
    expect(fs.readFileSync(path.join(w,'src/data/release.json'),'utf8')).toBe('previous-good-release');
    expect(fs.existsSync(path.join(w,'public/downloads'))).toBe(false);
    fs.writeFileSync(path.join(r,'data/extracted/islet1_candidate_stack_rankings.json'),rankText);
    const stable=spawnSync(process.execPath,[path.join(w,'scripts/sync-data.mjs')],{env:{...process.env,OPENISLET_REPO:r,ROUND2_MUTATE_RANKING:'0'},encoding:'utf8'});
    expect(stable.status,stable.stdout+stable.stderr).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(w,'src/data/release.json'),'utf8')).counts.designs).toBe(1620);
  });
});
