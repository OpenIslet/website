import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validRelativePath, assertRegularPath, readRegularFile, acquireDirectoryLock } from './regular-files.mjs';

const digest = (b) => createHash('sha256').update(b).digest('hex');
const inside = (a, b) => a === b || a.startsWith(b + path.sep);

export function verifyPublicExport(root) {
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error('Public export root may not be a symbolic link.');
  if (!fs.existsSync(path.join(root, '.openislet_public_bundle'))) throw new Error('A marked rights-aware public export is required.');
  const marker = readRegularFile(root, '.openislet_public_bundle').toString('utf8');
  if (!/^openislet_public_bundle_[A-Za-z0-9._-]+\n?$/.test(marker)) throw new Error('A marked rights-aware public export is required.');
  if (fs.existsSync(path.join(root, 'data/dossiers'))) throw new Error('Private dossiers cannot enter a connector bundle.');
  const manifest = JSON.parse(readRegularFile(root, 'manifest.json').toString('utf8'));
  const inventory = manifest.public_export_file_inventory;
  if (!Array.isArray(inventory) || !inventory.length || inventory.some(p => !validRelativePath(p)) || new Set(inventory).size !== inventory.length) throw new Error('Exact public export inventory with canonical paths is required.');
  const shipped = new Set(inventory);
  for (const rel of inventory) {
    if (['manifest.json', '.openislet_public_bundle'].includes(rel) || !Object.hasOwn(manifest.artifacts ?? {}, rel)) throw new Error('Invalid public inventory path.');
    const pin = manifest.artifacts[rel];
    const expected = pin?.public_export_sha256 ?? pin?.sha256;
    if (!/^[0-9a-f]{64}$/.test(expected ?? '') || !Number.isSafeInteger(pin.bytes) || pin.bytes < 0) throw new Error('Invalid public artifact pin.');
    if (!fs.existsSync(path.join(root, rel))) throw new Error(`Missing public artifact: ${rel}`);
    const bytes = readRegularFile(root, rel);
    if (bytes.length !== pin.bytes || digest(bytes) !== expected) throw new Error(`Public artifact hash mismatch or byte-size mismatch: ${rel}`);
  }
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, e.name);
      if (e.isSymbolicLink()) throw new Error('Public export may not contain symbolic links.');
      if (e.isDirectory()) walk(file);
      else {
        const rel = path.relative(root, file);
        assertRegularPath(root, rel);
        if (!['manifest.json', '.openislet_public_bundle'].includes(rel) && !shipped.has(rel)) throw new Error(`Unpinned public artifact: ${rel}`);
      }
    }
  }
  walk(root);
  return manifest;
}

export function readPublicArtifact(root, manifest, rel) {
  if (!manifest.public_export_file_inventory.includes(rel)) throw new Error('File is not in the public export inventory.');
  const bytes = readRegularFile(root, rel), pin = manifest.artifacts[rel];
  if (bytes.length !== pin.bytes || digest(bytes) !== (pin.public_export_sha256 ?? pin.sha256)) throw new Error(`Public artifact changed after verification: ${rel}`);
  return bytes;
}

export function validateDestination(out, id, protectedRoots = []) {
  if (!/^[a-z0-9][a-z0-9.-]{0,79}$/.test(id) || id.includes('..')) throw new Error('Invalid bundle id.');
  out = path.resolve(out);
  let ancestor = out;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const realOut = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, out));
  for (const protectedRoot of protectedRoots) {
    const real = fs.realpathSync(protectedRoot);
    if (inside(real, realOut)) throw new Error('Bundle output cannot replace an input directory or its ancestor.');
  }
  if (fs.existsSync(out)) {
    if (fs.lstatSync(out).isSymbolicLink()) throw new Error('Bundle output cannot be a symbolic link.');
    if (fs.readdirSync(out).length) {
      const metaPath = path.join(out, 'meta.json');
      if (!fs.existsSync(metaPath)) throw new Error('Refusing to replace a non-bundle directory.');
      const meta = JSON.parse(readRegularFile(out, 'meta.json').toString('utf8'));
      if (meta.schema !== 'openislet-bundle/1' || meta.id !== id) throw new Error('Existing bundle identity does not match output.');
    }
  }
  return out;
}

export function writeBundleAtomically(out, id, files, protectedRoots = []) {
  out = validateDestination(out, id, protectedRoots);
  for (const rel of files.keys()) if (!validRelativePath(rel)) throw new Error('Unsafe bundle payload path.');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const unlock = acquireDirectoryLock(out + '.publish-lock');
  try {
  validateDestination(out, id, protectedRoots);
  return writeBundleLocked(out, id, files);
  } finally { unlock(); }
}

function writeBundleLocked(out, id, files) {
  if (fs.existsSync(path.join(out, 'meta.json'))) {
    const old = JSON.parse(readRegularFile(out, 'meta.json').toString('utf8'));
    if (old.frozen) {
      // Metadata (including frozen/DOI) is part of the lock, not only payload fingerprint.
      const actual = [];
      const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          if (e.isSymbolicLink()) throw new Error('Locked bundle contains a symbolic link.');
          if (e.isDirectory()) walk(p); else actual.push(path.relative(out, p));
        }
      };
      walk(out);
      if (JSON.stringify(actual.sort()) !== JSON.stringify([...files.keys()].sort())) throw new Error('Locked bundle file set differs.');
      for (const [rel, bytes] of files) {
        if (!fs.existsSync(path.join(out, rel)) || !readRegularFile(out, rel).equals(bytes)) throw new Error('Bundle is locked; metadata and all payload bytes must remain identical.');
      }
      return;
    }
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const stage = fs.mkdtempSync(path.join(path.dirname(out), '.openislet-bundle-'));
  const backupRoot = fs.mkdtempSync(path.join(path.dirname(out), '.openislet-backup-'));
  const backup = path.join(backupRoot, 'previous');
  let moved = false;
  let committed = false;
  try {
    for (const [rel, bytes] of files) {
      if (!validRelativePath(rel)) throw new Error('Unsafe bundle payload path.');
      const target = path.join(stage, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);
    }
    if (fs.existsSync(out)) { fs.renameSync(out, backup); moved = true; }
    try { fs.renameSync(stage, out); committed = true; }
    catch (e) { if (moved) { fs.renameSync(backup, out); moved = false; } throw e; }
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
    if (!moved || committed) fs.rmSync(backupRoot, { recursive: true, force: true });
  }
}

export function readConnectorBundle(root, id) {
  if (!/^[a-z0-9][a-z0-9.-]{0,79}$/.test(id) || id.includes('..')) throw new Error('Invalid bundle id.');
  if (!fs.lstatSync(root).isDirectory() || fs.lstatSync(root).isSymbolicLink()) throw new Error('Bundle root must be a real directory.');
  const metadata = readRegularFile(root, 'meta.json');
  const meta = JSON.parse(metadata.toString('utf8'));
  if (!meta || meta.schema !== 'openislet-bundle/1' || meta.id !== id || typeof meta.name !== 'string' || typeof meta.frozen !== 'boolean' || typeof meta.blueprint_release !== 'string' || !Array.isArray(meta.files)) throw new Error('Invalid bundle metadata.');
  const files = new Map();
  for (const pin of meta.files) {
    if (!validRelativePath(pin.path) || pin.path === 'meta.json' || files.has(pin.path) || !Number.isSafeInteger(pin.bytes) || pin.bytes < 0 || !/^[a-f0-9]{64}$/.test(pin.sha256)) throw new Error('Invalid bundle inventory.');
    const bytes = readRegularFile(root, pin.path);
    if (bytes.length !== pin.bytes || digest(bytes) !== pin.sha256) throw new Error('Bundle payload integrity mismatch.');
    files.set(pin.path, bytes);
  }
  const fingerprint = digest([...meta.files].sort((a,b)=>a.path<b.path?-1:1).map(p=>`${p.path}\t${p.sha256}`).join('\n'));
  if (fingerprint !== meta.fingerprint) throw new Error('Bundle fingerprint mismatch.');
  function walk(dir) {
    for (const e of fs.readdirSync(dir,{withFileTypes:true})) {
      if (e.isSymbolicLink()) throw new Error('Bundle contains a symbolic link.');
      const full=path.join(dir,e.name), rel=path.relative(root,full);
      if(e.isDirectory()) walk(full);
      else if(rel!=='meta.json' && !files.has(rel)) throw new Error('Bundle contains an unlisted file.');
    }
  }
  walk(root);
  files.set('meta.json', metadata); // Publish metadata last, after payloads.
  return files;
}
