import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/answer';
import { Bundle } from '../src/core/bundle';
import { MemoryStore } from '../src/core/store';
import { bundleFor, createConnectorServer } from '../src/server';

const id = 'islet-1-draft';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
function fixture(payloads: Record<string, string>) {
  const files: Record<string, string> = {};
  const publish = (next: Record<string, string>) => {
    for (const key of Object.keys(files)) delete files[key];
    const pins = Object.entries(next).map(([path, text]) => ({ path, bytes: Buffer.byteLength(text), sha256: sha(text) }));
    const fingerprint = sha([...pins].sort((a,b) => a.path < b.path ? -1 : 1).map(f => `${f.path}\t${f.sha256}`).join('\n'));
    files[`${id}/meta.json`] = JSON.stringify({ schema: 'openislet-bundle/1', id, name: 'Draft',
      family: 'Islet-1', frozen: false, doi: null, blueprint_release: '0.8.0', files: pins, fingerprint });
    for (const [path, text] of Object.entries(next)) files[`${id}/${path}`] = text;
  };
  publish(payloads);
  return { files, publish, store: new MemoryStore(files) };
}

describe('runtime bundle revision and payload integrity', () => {
  it('does not reuse stale parsed data after a mutable draft revision', async () => {
    const f = fixture({ 'blueprint/overview.json': '{"revision":1}' });
    expect((await bundleFor(f.store,id).overview()).revision).toBe(1);
    f.publish({ 'blueprint/overview.json': '{"revision":2}' });
    expect((await bundleFor(f.store,id).overview()).revision).toBe(2);
  });

  it('rejects changed payload bytes even when the JSON remains valid', async () => {
    const f = fixture({ 'blueprint/overview.json': '{"revision":1}' });
    f.files[`${id}/blueprint/overview.json`] = '{"revision":2}';
    await expect(new Bundle(f.store,id).overview()).rejects.toThrow(/hash|integrity/i);
  });

  it('verifies full study records through the same inventory', async () => {
    const f = fixture({ 'studies/123.json': '{"title":"source"}' });
    f.files[`${id}/studies/123.json`] = '{"title":"forged"}';
    await expect(new Bundle(f.store,id).study('123')).rejects.toThrow(/hash|integrity/i);
  });

  it('rejects a partial update against a request metadata snapshot', async () => {
    const f = fixture({ 'blueprint/overview.json': '{"revision":1}' });
    const b = new Bundle(f.store,id);
    await b.meta();
    f.publish({ 'blueprint/overview.json': '{"revision":2}' });
    await expect(b.overview()).rejects.toThrow(/hash|integrity/i);
  });

  it('rejects unlisted paths and malformed metadata inventory', async () => {
    const f = fixture({ 'blueprint/overview.json': '{}' });
    f.files[`${id}/private.json`] = '{"private":true}';
    await expect(new Bundle(f.store,id).text('private.json')).rejects.toThrow(/listed|inventory/i);
    const meta = JSON.parse(f.files[`${id}/meta.json`]);
    meta.files.push(meta.files[0]);
    f.files[`${id}/meta.json`] = JSON.stringify(meta);
    await expect(new Bundle(f.store,id).meta()).rejects.toThrow(/duplicate|inventory/i);
  });

  it('does not turn a missing pinned study into a legitimate absent record', async () => {
    const f = fixture({ 'studies/123.json': '{}' });
    delete f.files[`${id}/studies/123.json`];
    await expect(new Bundle(f.store,id).study('123')).rejects.toThrow(/missing|no file/i);
    expect(await new Bundle(f.store,id).study('999')).toBeNull();
  });

  it('verifies UTF-8 byte counts and manifest fingerprints', async () => {
    const f = fixture({ 'blueprint/overview.json': '{"title":"β cell"}' });
    expect((await new Bundle(f.store,id).overview()).title).toBe('β cell');
    const meta = JSON.parse(f.files[`${id}/meta.json`]);
    meta.fingerprint = '0'.repeat(64);
    f.files[`${id}/meta.json`] = JSON.stringify(meta);
    await expect(new Bundle(f.store,id).meta()).rejects.toThrow(/fingerprint/i);
  });

  it('pins metadata once for multiple payload loads within a request', async () => {
    const f = fixture({ 'a.json': '{}', 'b.json': '{}' });
    let metaReads = 0;
    const b = new Bundle({ read: async (bundleId, path) => {
      if (path === 'meta.json') metaReads++;
      return f.store.read(bundleId,path);
    } },id);
    await Promise.all([b.text('a.json'), b.text('b.json'), b.meta()]);
    expect(metaReads).toBe(1);
    const originalMeta = await b.text('meta.json');
    f.publish({ 'a.json': '{"new":true}', 'b.json': '{}' });
    expect(await b.text('meta.json')).toBe(originalMeta);
    expect(metaReads).toBe(1);
  });

  it('rejects unsafe internal IDs and paths before any store access', async () => {
    let reads = 0;
    const store = { read: async () => { reads++; return null; } };
    for (const badId of ['../private','id/other','UpperCase','']) {
      expect(() => new Bundle(store,badId)).toThrow(/ID/);
    }
    const b = new Bundle(store,id);
    for (const badPath of ['../private.json','/private.json','x/../private.json','x//y','x\\y']) {
      await expect(b.text(badPath)).rejects.toThrow(/path/);
    }
    expect(reads).toBe(0);
  });

  it('refreshes a same-ID draft and rejects corruption through the actual MCP resource handler', async () => {
    const f = fixture({ 'studies/123.json': '{"revision":1}' });
    const [clientSide,serverSide] = InMemoryTransport.createLinkedPair();
    const server = createConnectorServer({ store:f.store, config:{ ...defaultConfig,activeBundle:id } });
    const client = new Client({ name:'runtime-integrity-test', version:'1.0.0' });
    await server.connect(serverSide);
    await client.connect(clientSide);
    try {
      const read = async () => {
        const result = await client.readResource({ uri:'openislet://study/123' });
        return JSON.parse((result.contents[0] as { text:string }).text);
      };
      expect((await read()).revision).toBe(1);
      f.publish({ 'studies/123.json': '{"revision":2}' });
      expect((await read()).revision).toBe(2);
      f.files[`${id}/studies/123.json`] = '{"revision":3}';
      await expect(read()).rejects.toThrow(/hash|integrity/i);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
