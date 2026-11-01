// Integrity and rollback boundaries for synchronizing one science-export snapshot.
import { createHash } from 'node:crypto';
import { writeFile, mkdir, mkdtemp, rename, rm, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { validRelativePath, assertRegularPath, readRegularFile, acquireDirectoryLock } from '../connector/scripts/regular-files.mjs';

const inside = (candidate, root) => candidate === root || candidate.startsWith(root + path.sep);
const OWNERS = new WeakMap();
const SYNC_LOCK_NAME = '.openislet-sync-lock';

export async function acquireSyncLock(root) {
  const actualRoot = await realpath(root);
  const unlock = acquireDirectoryLock(path.join(actualRoot, SYNC_LOCK_NAME));
  const owner = { root: actualRoot, unlock, users: 0 };
  const token = {
    assertOwned() { unlock.assertOwned(); },
    release() { if (owner.users) throw new Error('Publication is still using this ownership.'); unlock(); },
  };
  OWNERS.set(token, owner);
  return token;
}
export async function readPinnedSource(repo, manifest, rel) {
  if (!validRelativePath(rel)) throw new Error('Invalid source-relative path.');
  const pin = manifest.artifacts?.[rel];
  const expected = pin?.local_audit_tree_sha256 ?? pin?.sha256;
  if (typeof expected !== 'string' || !/^[0-9a-f]{64}$/.test(expected)) throw new Error(`No source pin for ${rel}.`);
  const bytes = readRegularFile(repo, rel);
  if (createHash('sha256').update(bytes).digest('hex') !== expected) {
    throw new Error(`Science source changed since public export: ${rel}. Regenerate and retry sync-data.`);
  }
  return bytes;
}
export function assertPublicDownload(manifest, rel) {
  if (!validRelativePath(rel) || (rel !== 'manifest.json' && !manifest.public_export_file_inventory?.includes(rel))) throw new Error(`Download is not in the verified public export: ${rel}`);
}

export async function publishFiles(root, files, { renameFile = rename, lock = null } = {}) {
  const actualRoot = await realpath(root);
  const ownLock = !lock;
  lock ??= await acquireSyncLock(root);
  const owner = OWNERS.get(lock);
  if (!owner || owner.root !== actualRoot) throw new Error('Invalid sync ownership.');
  owner.unlock.assertOwned();
  if (owner.users) throw new Error('Publication ownership is already in use.');
  owner.users++;
  let stage = null, keepBackup = false, publicationError = null;
  const committed = [], entries = [], seen = new Set();
  try {
    for (const [target, bytes] of files) {
      const absolute = path.resolve(target);
      if (!inside(absolute, path.resolve(root)) || absolute === path.resolve(root)) throw new Error('Sync target escapes website root.');
      const rel = path.relative(path.resolve(root), absolute);
      if (!validRelativePath(rel) || seen.has(rel)) throw new Error('Invalid or duplicate canonical sync target.');
      if (rel.split('/').some(part => part.normalize('NFC').toLowerCase() === SYNC_LOCK_NAME)) {
        throw new Error('Sync target contains a reserved publication ownership path.');
      }
      seen.add(rel);
      const stat = assertRegularPath(actualRoot, rel, { missing: true });
      const old = stat ? readRegularFile(actualRoot, rel) : null;
      entries.push({ target: path.join(actualRoot, rel), rel, bytes: bytes === null ? null : Buffer.from(bytes), old, mode: stat ? stat.mode & 0o777 : 0o644 });
    }
    stage = await mkdtemp(path.join(actualRoot, '.openislet-sync-'));
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]; e.prepared = path.join(stage, `new-${i}`); e.backup = path.join(stage, `old-${i}`);
      if (e.bytes !== null) await writeFile(e.prepared, e.bytes, { mode: e.mode });
      if (e.old !== null) await writeFile(e.backup, e.old, { mode: e.mode });
    }
    const matches = (entry, expected) => {
      const stat = assertRegularPath(actualRoot, entry.rel, { missing: true });
      return expected === null ? stat === null : stat !== null && readRegularFile(actualRoot, entry.rel).equals(expected);
    };
    try {
      for (const e of entries) {
        owner.unlock.assertOwned();
        if (!matches(e, e.old)) throw new Error('Sync target changed after staging; refusing to overwrite another writer.');
        await mkdir(path.dirname(e.target), { recursive: true });
        owner.unlock.assertOwned();
        assertRegularPath(actualRoot, e.rel, { missing: true });
        if (e.bytes === null) await rm(e.target, { force: true });
        else await renameFile(e.prepared, e.target);
        committed.push(e);
        owner.unlock.assertOwned();
      }
    } catch (error) {
      const rollbackErrors = [];
      for (const e of committed.reverse()) {
        try {
          owner.unlock.assertOwned();
          if (!matches(e, e.bytes)) throw new Error('Another writer changed a committed file; its contents were preserved.');
          if (e.old === null) await rm(e.target, { force: true });
          else await renameFile(e.backup, e.target);
        } catch (rollback) { rollbackErrors.push(rollback); }
      }
      if (rollbackErrors.length) {
        keepBackup = true;
        throw new AggregateError([error, ...rollbackErrors], `Sync rollback incomplete; recovery files preserved at ${stage}`);
      }
      throw error;
    }
  } catch (error) {
    publicationError = error;
    throw error;
  } finally {
    if (stage && !keepBackup) await rm(stage, { recursive: true, force: true });
    owner.users--;
    if (ownLock) {
      try { lock.release(); }
      catch (error) { if (!publicationError) throw error; }
    }
  }
}
