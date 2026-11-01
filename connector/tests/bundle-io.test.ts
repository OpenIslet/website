import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
// @ts-expect-error Build-time JavaScript helper is exercised directly.
import { validateDestination, verifyPublicExport, writeBundleAtomically } from '../scripts/bundle-io.mjs';

describe('bundle boundaries under independent negative controls', () => {
  it('preserves unrelated output directories and rejects traversal ids', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oi-guard-'));
    try {
      fs.writeFileSync(path.join(root, 'keep.txt'), 'original');
      expect(() => validateDestination(root, 'draft')).toThrow(/non-bundle/);
      expect(() => validateDestination(path.join(root, 'new'), '../escape')).toThrow(/id/);
      expect(fs.readFileSync(path.join(root, 'keep.txt'), 'utf8')).toBe('original');
    } finally { fs.rmSync(root, {recursive: true}); }
  });
  it('preserves frozen metadata even if payload content is unchanged', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oi-frozen-'));
    const dest = path.join(root, 'v1');
    const meta = {schema: 'openislet-bundle/1', id: 'v1', frozen: true, doi: 'locked'};
    const files = new Map([['meta.json', Buffer.from(JSON.stringify(meta))], ['payload.json', Buffer.from('{}')]]);
    try {
      writeBundleAtomically(dest, 'v1', files);
      expect(() => writeBundleAtomically(dest, 'v1', files)).not.toThrow();
      const altered = new Map(files); altered.set('meta.json', Buffer.from(JSON.stringify({...meta, frozen: false})));
      expect(() => writeBundleAtomically(dest, 'v1', altered)).toThrow(/locked/);
      expect(JSON.parse(fs.readFileSync(path.join(dest, 'meta.json'), 'utf8')).frozen).toBe(true);
    } finally { fs.rmSync(root, {recursive: true}); }
  });
  it('rejects a changed public file, unmarked exports and unpinned additions', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oi-pins-'));
    try {
      fs.writeFileSync(path.join(root, 'record.json'), '{}');
      fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({public_export_file_inventory: ['record.json'], artifacts: {'record.json': {sha256: createHash('sha256').update('{}').digest('hex'), bytes:2}}}));
      expect(() => verifyPublicExport(root)).toThrow(/marked/);
      fs.writeFileSync(path.join(root, '.openislet_public_bundle'), 'openislet_public_bundle_v0.8.0');
      expect(() => verifyPublicExport(root)).not.toThrow();
      fs.renameSync(path.join(root, 'record.json'), path.join(root, 'missing.tmp'));
      expect(() => verifyPublicExport(root)).toThrow(/missing/i);
      fs.renameSync(path.join(root, 'missing.tmp'), path.join(root, 'record.json'));
      fs.writeFileSync(path.join(root, 'record.json'), '{"unreviewed":1}');
      expect(() => verifyPublicExport(root)).toThrow(/hash mismatch/);
      fs.writeFileSync(path.join(root, 'record.json'), '{}');
      fs.writeFileSync(path.join(root, 'injected.json'), '{}');
      expect(() => verifyPublicExport(root)).toThrow(/Unpinned/);
    } finally { fs.rmSync(root, {recursive: true}); }
  });
});
