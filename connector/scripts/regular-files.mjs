// Files entering a published bundle must have one ordinary, canonical identity.
import fs from 'node:fs';
import path from 'node:path';

export function validRelativePath(rel) {
  return typeof rel === 'string' && /^[A-Za-z0-9._/-]+$/.test(rel)
    && rel.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}
export function assertRegularPath(root, rel, { missing = false } = {}) {
  if (!validRelativePath(rel)) throw new Error('Invalid canonical relative file path.');
  const parts = rel.split('/');
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (error) { if (missing && error.code === 'ENOENT') return null; throw error; }
    if (stat.isSymbolicLink()) throw new Error('Symbolic links are not allowed in release paths.');
    if (i < parts.length - 1) {
      if (!stat.isDirectory()) throw new Error('Release parent must be a directory.');
    } else if (!stat.isFile() || stat.nlink !== 1) {
      throw new Error('Release file must be regular and have a single hard link.');
    } else return stat;
  }
}
export function readRegularFile(root, rel) {
  const before = assertRegularPath(root, rel);
  const fd = fs.openSync(path.join(root, rel), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino) throw new Error('Release file identity changed while opening.');
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd);
    if (after.size !== bytes.length || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) throw new Error('Release file changed while reading.');
    return bytes;
  } finally { fs.closeSync(fd); }
}
export function acquireDirectoryLock(lockPath) {
  // Do not steal stale locks: after a crashed publisher, an operator must inspect
  // its staged/recovery files before removing this ownership marker.
  try { fs.mkdirSync(lockPath); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Another publication owns this destination; retry after it finishes.'); throw error; }
  const identity = fs.lstatSync(lockPath);
  let released = false;
  const assertOwned = () => {
    if (released) throw new Error('Publication ownership has already been released.');
    const current = fs.lstatSync(lockPath);
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino) throw new Error('Publication ownership changed.');
  };
  const release = () => {
    if (released) return;
    assertOwned();
    fs.rmdirSync(lockPath);
    released = true;
  };
  release.assertOwned = assertOwned;
  return release;
}
