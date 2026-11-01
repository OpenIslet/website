import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createConnectorServer } from '../src/server';
import { defaultConfig } from '../src/core/answer';
import { Bundle } from '../src/core/bundle';
import { checkExact, NAMED_DESIGNS } from '../src/core/graveyard';
import { store } from './helpers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bundle, connect, readJson } from './helpers';
import { listVersions, resolveVersion } from '../src/core/versions';
import type { VersionsFile } from '../src/core/types';

let session: Awaited<ReturnType<typeof connect>>;
beforeAll(async () => { session = await connect(); });
afterAll(async () => { await session.close(); });
const versions = () => structuredClone(readJson<VersionsFile>('versions/versions.json'));
const withVersions = (v: VersionsFile) => { const b = bundle(); b.versions = async () => v; return b; };

describe('Exact record identity and version resolution', () => {
  it.each(['IIP-0001junk', '1.9', '1e6', '+1'])('rejects malformed record id %s instead of returning record1', async id => {
    const r = await session.call('get_submission_status', { id });
    expect(r.isError).toBe(true);
    expect(r.structuredContent?.found).not.toBe(true);
  });
  it.each(['1', '#1', 'IIP-0001', ' iip-0001 '])('accepts documented record id %s', async id => {
    const r = await session.call('get_submission_status', { id });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.record.id).toBe('IIP-0001');
  });
  it('does not fall back to an open draft when latest locked data is missing', async () => {
    const v = versions();
    v.locked = [{ id: 'islet-1.0', name: 'Islet-1.0', lock_date: '2027-02-01', frozen: true, doi: '10.1234/test' }];
    const r = await resolveVersion('latest', withVersions(v), async () => false);
    expect(r).toHaveProperty('error');
  });
  it('rejects a mutable bundle that the version index lists as locked', async () => {
    const v = versions();v.locked=[{id:'islet-1.0',name:'Islet-1.0',lock_date:'2027-02-01',frozen:true,doi:null}];
    const text=JSON.stringify(v);const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
    const original=readJson('meta.json');const draft=structuredClone(original);
    draft.files=draft.files.map((p:any)=>p.path==='versions/versions.json'?{...p,bytes:Buffer.byteLength(text),sha256:digest(text)}:p);
    draft.fingerprint=digest([...draft.files].sort((a:any,b:any)=>a.path<b.path?-1:1).map((p:any)=>`${p.path}\t${p.sha256}`).join('\n'));
    const malformed={...original,id:'islet-1.0',name:'Islet-1.0',frozen:false};
    const custom={read:async(id:string,file:string)=>{
      if(id==='islet-1-draft'&&file==='meta.json')return JSON.stringify(draft);
      if(id==='islet-1-draft'&&file==='versions/versions.json')return text;
      if(id==='islet-1.0'&&file==='meta.json')return JSON.stringify(malformed);
      return store.read(id==='islet-1.0'?'islet-1-draft':id,file);
    }};
    const factory=process.env.ROUND2_SERVER_MODULE?(await import(pathToFileURL(process.env.ROUND2_SERVER_MODULE).href)).createConnectorServer:createConnectorServer;
    const server=factory({store:custom,config:defaultConfig});const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);
    const client=new Client({name:'frozen-test',version:'1.0.0'});await client.connect(a);
    try { const r=await client.callTool({name:'get_blueprint_overview',arguments:{version:'latest'}});expect(r.isError).toBe(true); }
    finally {await client.close();await server.close();}
  });
  it.each([undefined,'draft','islet-1.0'])('classifies an indexed active lock for selector %s',async asked=>{
    const v=versions();v.locked=[{id:'islet-1.0',name:'Islet-1.0',lock_date:'2027-02-01',frozen:true,doi:null}];
    const active=new Bundle(store,'islet-1.0');active.versions=async()=>v;
    expect(await resolveVersion(asked,active,async()=>true)).toMatchObject({bundleId:'islet-1.0',requiresFrozen:true});
  });
  it('rejects an unknown rule trigger instead of silently disabling a policy',async()=>{
    const b=bundle();const entries=structuredClone(await b.entries());
    entries[0].trigger_pattern={requires_any_module:['CYTO_NONEXISTENT_MODULE']};b.entries=async()=>entries;
    await expect(checkExact(b,{design:'A'})).rejects.toThrow(/unknown Graveyard trigger/);
  });
  it('can resolve an open draft with no locked or scheduled releases', async () => {
    const v = versions(); v.locked = []; v.planned = [];
    expect(await resolveVersion('latest', withVersions(v), async () => false)).toMatchObject({ bundleId: 'islet-1-draft' });
  });
  it('can describe an open draft with no remaining scheduled release', async () => {
    const v = versions(); v.locked = []; v.planned = [];
    const r = await listVersions(withVersions(v));
    expect(r.summary).toContain('open draft');
    expect(r.summary).not.toContain('undefined');
  });
});
