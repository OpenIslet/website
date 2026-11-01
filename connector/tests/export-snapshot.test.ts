// A public copy of the blueprint repository (a plain clone of it) already is the export. `npm run export` uses it as it is: exporting
// it a second time would redact and seal it again, change its manifest, and the website's numbers would no longer match.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { connectorRoot } from './helpers';

const exportDir = path.join(connectorRoot, 'export');
const script = path.join(connectorRoot, 'scripts', 'export-public.sh');
const haveExport = fs.existsSync(path.join(exportDir, '.openislet_public_bundle'));

const scratch: string[] = [];
afterEach(() => {
  for (const d of scratch.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** A plain clone of the public repository: the export, plus what a clone and a run of its tests leave behind. */
function clone() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oi-snapshot-'));
  scratch.push(dir);
  const repo = path.join(dir, 'clone');
  fs.cpSync(exportDir, repo, { recursive: true });
  fs.mkdirSync(path.join(repo, '.git'));
  fs.writeFileSync(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  fs.mkdirSync(path.join(repo, '.pytest_cache'));
  fs.writeFileSync(path.join(repo, '.pytest_cache', 'CACHEDIR.TAG'), 'cache');
  fs.mkdirSync(path.join(repo, 'scripts', '__pycache__'));
  fs.writeFileSync(path.join(repo, 'scripts', '__pycache__', 'x.pyc'), 'bytecode');
  return { dir, repo, dest: path.join(dir, 'out'), incoming: path.join(dir, '.out.incoming') };
}
const run = (repo: string, dest: string) =>
  spawnSync('bash', [script], { env: { ...process.env, OPENISLET_REPO: repo, OPENISLET_EXPORT_DEST: dest }, encoding: 'utf8' });

describe.skipIf(!haveExport)('exporting a public copy of the blueprint repository', () => {
  it('copies a plain clone as it is: no Git folder, no caches, and the very same manifest', () => {
    const { repo, dest, incoming } = clone();
    const r = run(repo, dest);
    expect(r.status, r.stderr).toBe(0);
    for (const gone of ['.git', '.pytest_cache', path.join('scripts', '__pycache__')]) expect(fs.existsSync(path.join(dest, gone)), gone).toBe(false);
    expect(fs.existsSync(path.join(dest, '.openislet_public_bundle'))).toBe(true);
    expect(fs.readFileSync(path.join(dest, 'manifest.json')).equals(fs.readFileSync(path.join(exportDir, 'manifest.json')))).toBe(true);
    expect(fs.existsSync(incoming)).toBe(false);
  });

  it('replaces an earlier export, and leaves the repository it read untouched', () => {
    const { repo, dest } = clone();
    fs.mkdirSync(dest);
    fs.writeFileSync(path.join(dest, 'old.txt'), 'an earlier export');
    const before = fs.readdirSync(repo).sort();
    expect(run(repo, dest).status).toBe(0);
    expect(fs.existsSync(path.join(dest, 'old.txt'))).toBe(false);
    expect(fs.readdirSync(repo).sort()).toEqual(before);
    expect(fs.existsSync(path.join(repo, '.git', 'HEAD'))).toBe(true);
  });

  it('refuses a clone with a changed file, and keeps the earlier export', () => {
    const { repo, dest, incoming } = clone();
    const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'manifest.json'), 'utf8')) as { public_export_file_inventory: string[] };
    const victim = manifest.public_export_file_inventory[0];
    fs.appendFileSync(path.join(repo, victim), '\nedited after the export was sealed\n');
    fs.mkdirSync(dest);
    fs.writeFileSync(path.join(dest, 'keep.txt'), 'the earlier export');
    const r = run(repo, dest);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/does not verify/);
    expect(fs.existsSync(path.join(dest, 'keep.txt'))).toBe(true);
    expect(fs.existsSync(incoming)).toBe(false);
  });

  it('refuses a clone with a file the manifest does not list', () => {
    const { repo, dest } = clone();
    fs.writeFileSync(path.join(repo, 'NOTES-FROM-SOMEONE.md'), 'not part of the release');
    const r = run(repo, dest);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Unpinned public artifact/);
    expect(fs.existsSync(dest)).toBe(false);
  });
});
