import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error Executable shared JavaScript boundary.
import { readRegularFile, validRelativePath } from '../scripts/regular-files.mjs';
// @ts-expect-error Executable shared JavaScript boundary.
import { verifyPublicExport, readPublicArtifact, writeBundleAtomically } from '../scripts/bundle-io.mjs';
// @ts-expect-error Executable shared JavaScript boundary.
import { acquireSyncLock, publishFiles, readPinnedSource } from '../../scripts/sync-io.mjs';
import { bundle } from './helpers';
import { defaultConfig } from '../src/core/answer';
import { runChecks, parseDoc } from '../src/core/draft';
import { makeDraft, makeReview } from './fixtures';
import { FsStore } from '../src/node/fs-store';
import { Bundle } from '../src/core/bundle';
const dirs: string[]=[];
const temp=()=>{const p=fs.mkdtempSync(path.join(os.tmpdir(),'oi-release-'));dirs.push(p);return p;};
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
afterEach(()=>{for(const d of dirs.splice(0))fs.rmSync(d,{recursive:true,force:true});});
const pub=()=>{const d=temp();fs.writeFileSync(path.join(d,'.openislet_public_bundle'),'openislet_public_bundle_fixture');fs.writeFileSync(path.join(d,'payload.json'),'{}');const m={artifacts:{'payload.json':{sha256:sha('{}'),bytes:2}},public_export_file_inventory:['payload.json']};fs.writeFileSync(path.join(d,'manifest.json'),JSON.stringify(m));return {d,m};};

describe('Regular release identities',()=>{
  it.each(['../x','/x','x//y','x/./y','x/../y','x\\y','x\u0000y','x\u200by','é.json'])('rejects noncanonical path %s',(p)=>expect(validRelativePath(p)).toBe(false));
  it.each(['symlink','hardlink','fifo','directory'])('rejects %s before a read can block',(kind)=>{
    const d=temp(),p=path.join(d,'file');fs.writeFileSync(path.join(d,'original'),'payload');
    if(kind==='symlink')fs.symlinkSync(path.join(d,'original'),p);
    else if(kind==='hardlink')fs.linkSync(path.join(d,'original'),p);
    else if(kind==='fifo'){expect(spawnSync('mkfifo',[p]).status).toBe(0);}
    else fs.mkdirSync(p);
    expect(()=>readRegularFile(d,'file')).toThrow();
  });
  it('rejects a symlinked parent directory',()=>{const d=temp(),outside=temp();fs.writeFileSync(path.join(outside,'p'),'x');fs.symlinkSync(outside,path.join(d,'alias'));expect(()=>readRegularFile(d,'alias/p')).toThrow();});
  it('rejects a hardlinked source even when its digest matches',async()=>{const d=temp();fs.writeFileSync(path.join(d,'p'),'x');fs.linkSync(path.join(d,'p'),path.join(d,'alias'));await expect(readPinnedSource(d,{artifacts:{p:{sha256:sha('x')}}},'p')).rejects.toThrow();});
  it.each([0,3,true,null])('checks manifest byte count %s',(bytes)=>{const {d,m}=pub();(m.artifacts['payload.json'] as any).bytes=bytes;fs.writeFileSync(path.join(d,'manifest.json'),JSON.stringify(m));expect(()=>verifyPublicExport(d)).toThrow();});
  it('rejects a payload changed after verification',()=>{const {d}=pub();const m=verifyPublicExport(d);fs.writeFileSync(path.join(d,'payload.json'),'[]');expect(()=>readPublicArtifact(d,m,'payload.json')).toThrow(/changed/);});
  it.each(['duplicate','traversal','hardlink','extra'])('rejects %s public membership',(kind)=>{const {d,m}=pub();if(kind==='duplicate')m.public_export_file_inventory.push('payload.json');if(kind==='traversal')m.public_export_file_inventory=['../payload.json'];if(kind==='hardlink')fs.linkSync(path.join(d,'payload.json'),path.join(d,'other'));if(kind==='extra')fs.writeFileSync(path.join(d,'extra'),'x');fs.writeFileSync(path.join(d,'manifest.json'),JSON.stringify(m));expect(()=>verifyPublicExport(d)).toThrow();});
});

describe('Publication ownership and recovery',()=>{
  it('a second sync cannot commit while the first owns the tree',async()=>{
    const d=temp(),file=path.join(d,'file');fs.writeFileSync(file,'old');
    const lock=await acquireSyncLock(d);
    await expect(publishFiles(d,new Map([[file,Buffer.from('second')]]))).rejects.toThrow(/owns/);
    await publishFiles(d,new Map([[file,Buffer.from('first')]]),{lock});lock.release();
    expect(fs.readFileSync(file,'utf8')).toBe('first');
  });
  it('preserves another writer when rollback sees an intervening change',async()=>{
    const d=temp(),a=path.join(d,'a'),b=path.join(d,'b');fs.writeFileSync(a,'old-a');fs.writeFileSync(b,'old-b');let calls=0;
    await expect(publishFiles(d,new Map([[a,Buffer.from('new-a')],[b,Buffer.from('new-b')]]),{renameFile:async(s:string,t:string)=>{if(++calls===2){fs.writeFileSync(a,'external-writer');throw new Error('injected');}return rename(s,t);}})).rejects.toThrow(/recovery/);
    expect(fs.readFileSync(a,'utf8')).toBe('external-writer');expect(fs.readFileSync(b,'utf8')).toBe('old-b');
    const backup=fs.readdirSync(d).find(p=>p.startsWith('.openislet-sync-'))!;expect(fs.readFileSync(path.join(d,backup,'old-0'),'utf8')).toBe('old-a');
  });
  it('retired managed files participate in rollback',async()=>{
    const d=temp(),a=path.join(d,'retired'),b=path.join(d,'b');fs.writeFileSync(a,'old');fs.writeFileSync(b,'old-b');let calls=0;
    await expect(publishFiles(d,new Map<string,Buffer|null>([[a,null],[b,Buffer.from('new')]]),{renameFile:async(s:string,t:string)=>{if(++calls===1)throw new Error('injected');return rename(s,t);}})).rejects.toThrow(/injected/);
    expect(fs.readFileSync(a,'utf8')).toBe('old');
    await publishFiles(d,new Map([[a,null]]));expect(fs.existsSync(a)).toBe(false);
  });
  it('rejects two aliases for one canonical destination',async()=>{const d=temp();await expect(publishFiles(d,new Map([[path.join(d,'p'),Buffer.from('a')],[d+'/sub/../p',Buffer.from('b')]]))).rejects.toThrow(/duplicate/);expect(fs.existsSync(path.join(d,'p'))).toBe(false);});
  it('rejects symlinked bundle metadata rather than using it as overwrite authority',()=>{const parent=temp(),out=path.join(parent,'bundle');fs.mkdirSync(out);fs.writeFileSync(path.join(parent,'meta'),JSON.stringify({schema:'openislet-bundle/1',id:'draft'}));fs.symlinkSync(path.join(parent,'meta'),path.join(out,'meta.json'));expect(()=>writeBundleAtomically(out,'draft',new Map())).toThrow(/links/);});
});

describe('Draft ambiguity and complete-input secret checks',()=>{
  it.each(['field','section','title','long-line'])('rejects ambiguous %s structure',async(kind)=>{
    let draft=makeDraft();let review=makeReview();
    if(kind==='field')review=review.replace(/\*\*Verdict:\*\*[^\n]*/, '**Verdict:** Supported\n**Verdict:** Not supported');
    if(kind==='section')draft+='\n## Evidence\nConflicting second evidence section.';
    if(kind==='title')draft+='\n# Another title';
    if(kind==='long-line')draft+='\n'+'x'.repeat(2001);
    const r=await runChecks(bundle(),defaultConfig,{draft,review,consent:true});expect(r.ready).toBe(false);expect([...parseDoc(draft).parseIssues,...parseDoc(review).parseIssues].length).toBeGreaterThan(0);
  });
  it.each(['plain','unicode'])('finds %s secrets outside the selected code fence',async(kind)=>{
    const token=kind==='plain'?'sk-test123456789012345678901234':'sk-\u200btest123456789012345678901234';
    const r=await runChecks(bundle(),defaultConfig,{draft:'```markdown\n'+makeDraft()+'\n```\n'+token,review:makeReview(),consent:true});
    expect(r.door.find(d=>d.id==='no_secrets')?.status).toBe('fail');
  });
  it('preserves the valid ordinary template',async()=>{expect((await runChecks(bundle(),defaultConfig,{draft:makeDraft(),review:makeReview(),consent:true})).ready).toBe(true);});
});

describe('Runtime storage boundary',()=>{
  it('rejects file traversal even when FsStore is invoked directly',async()=>{const d=temp();fs.writeFileSync(path.join(d,'secret'),'private');await expect(new FsStore(d).read('draft','../secret')).rejects.toThrow();});
  it('does not serialize private storage errors into connector responses',async()=>{const b=new Bundle({read:async()=>{throw new Error('private-path /Users/private/secrets TOKEN');}},'draft');await expect(b.exists()).rejects.toThrow('Unable to read bundle storage. Please retry.');await expect(b.meta()).rejects.not.toThrow(/private-path|TOKEN/);});
});

// @ts-expect-error Executable shared JavaScript boundary.
import { acquireDirectoryLock } from '../scripts/regular-files.mjs';
// @ts-expect-error Executable shared JavaScript boundary.
import { readConnectorBundle } from '../scripts/bundle-io.mjs';
import { normalisePmid } from '../src/core/search';
it('a stale release cannot remove a newer owner lock',()=>{const d=temp(),p=path.join(d,'lock');const old=acquireDirectoryLock(p);old();const current=acquireDirectoryLock(p);old();expect(fs.existsSync(p)).toBe(true);current();});
it('a released token cannot write while a newer token owns the tree',async()=>{const d=temp(),p=path.join(d,'p');const old=await acquireSyncLock(d);old.release();const current=await acquireSyncLock(d);await expect(publishFiles(d,new Map([[p,Buffer.from('stale')]]),{lock:old})).rejects.toThrow(/released/);expect(fs.existsSync(p)).toBe(false);current.release();});
it('an in-flight publication retains its lease',async()=>{const d=temp(),p=path.join(d,'p');const lock=await acquireSyncLock(d);await publishFiles(d,new Map([[p,Buffer.from('ok')]]),{lock,renameFile:async(s:string,t:string)=>{expect(()=>lock.release()).toThrow(/still using/);return rename(s,t);}});lock.release();expect(fs.readFileSync(p,'utf8')).toBe('ok');});
it.each(['https://pubmed.ncbi.nlm.nih.gov/1234567890/','https://pubmed.ncbi.nlm.nih.gov.evil/12345/','https://evil.test/?link=pubmed.ncbi.nlm.nih.gov/12345/','http://user@pubmed.ncbi.nlm.nih.gov/12345/','PMID:12345x'])('does not resolve malformed PMID %s',(v)=>expect(normalisePmid(v)).toBeNull());
it.each(['PMID:12345','12345','https://pubmed.ncbi.nlm.nih.gov/12345/?from=fixture'])('resolves exact PMID %s',(v)=>expect(normalisePmid(v)).toBe('12345'));
it.each(['none','bytes','extra','symlink','wrong-id','frozen-type','missing-name','missing-release'])('validates local seed bundle before any write: %s',(mutation)=>{
  const d=temp();fs.writeFileSync(path.join(d,'payload'),'x');const pins=[{path:'payload',bytes:1,sha256:sha('x')}];const meta:any={schema:'openislet-bundle/1',id:'draft',name:'fixture',frozen:false,blueprint_release:'v0.8.0',files:pins,fingerprint:sha('payload\t'+sha('x'))};
  if(mutation==='frozen-type')meta.frozen='false';if(mutation==='missing-name')delete meta.name;if(mutation==='missing-release')delete meta.blueprint_release;if(mutation==='bytes')pins[0].bytes=2;if(mutation==='extra')fs.writeFileSync(path.join(d,'extra'),'x');if(mutation==='symlink'){fs.renameSync(path.join(d,'payload'),path.join(d,'real'));fs.symlinkSync(path.join(d,'real'),path.join(d,'payload'));}fs.writeFileSync(path.join(d,'meta.json'),JSON.stringify(meta));
  if(mutation==='none')expect([...readConnectorBundle(d,'draft').keys()]).toEqual(['payload','meta.json']);else expect(()=>readConnectorBundle(d,mutation==='wrong-id'?'other':'draft')).toThrow();
});
it('returned metadata cannot mutate the internal integrity snapshot',async()=>{
  const b=bundle();const meta=await b.meta();const pin=meta.files[0];const original=pin.sha256;
  expect(()=>{pin.sha256='0'.repeat(64);}).toThrow();expect(()=>{meta.frozen=true;}).toThrow();
  expect((await b.meta()).files[0].sha256).toBe(original);await expect(b.text(pin.path)).resolves.toBeTypeOf('string');
});
import { getStudy } from '../src/core/studies';
it('retains inequality statistics through both bundle and study response',async()=>{
  const b=bundle();const all=await b.findings();let checked=0;
  for(const pmid of new Set(all.map(f=>f.pmid))){
    const raw=await b.study(pmid);const bounded=(raw?.atomic_effects??[]).filter((e:any)=>e.p_value_relation && e.p_value_relation!=='=');
    if(!bounded.length)continue;
    const answer=await getStudy(b,pmid);expect(answer.found).toBe(true);if(!answer.found)throw new Error('missing study');
    for(const e of bounded){const f=all.find(f=>f.id===e.effect_id)!;expect(f.stat.p).toBeNull();expect(f.stat.p_relation).toBe(e.p_value_relation);expect(f.stat.p_bound).toBe(e.p_value_bound);const shown=answer.findings.find(f=>f.id===e.effect_id)!.statistics;expect(shown.p_value_relation).toBe(e.p_value_relation);expect(shown.p_value_bound).toBe(e.p_value_bound);checked++;}
  }
  expect(checked).toBeGreaterThan(0);
});
