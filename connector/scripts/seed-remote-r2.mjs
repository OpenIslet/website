#!/usr/bin/env node
// Loads a built bundle into the Cloudflare R2 bucket that the deployed Worker reads (`openislet-bundle`), the remote twin of
// seed-local-r2.mjs. Staging and the live connector read the same bucket.
//
//   npm run bundle && npm run seed:remote            (needs `wrangler login`; writes to Cloudflare)
//
// It uses the same checks as the local seed: the bundle is verified before anything is written, the metadata goes last, and a
// locked (frozen) bundle already in the bucket is only compared, never changed.
import { getPlatformProxy } from 'wrangler';
import { readConnectorBundle } from './bundle-io.mjs';
import { seedVerifiedBundle } from './seed-io.mjs';
import { acquireSyncLock } from '../../scripts/sync-io.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const connector = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = process.argv[2] ?? 'islet-1-draft';
const bucket = 'openislet-bundle';
const lock = await acquireSyncLock(path.resolve(connector, '..'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openislet-seed-'));
try {
  const payloads = readConnectorBundle(path.join(connector, 'bundle', id), id);
  // A throwaway config holding only the bucket, marked remote, so nothing local is read or written.
  const configPath = path.join(tmp, 'wrangler.json');
  fs.writeFileSync(configPath, JSON.stringify({ name: 'openislet-seed', compatibility_date: '2026-10-01', r2_buckets: [{ binding: 'BUNDLE', bucket_name: bucket, remote: true }] }));
  const { env, dispose } = await getPlatformProxy({ configPath, remoteBindings: true, persist: false });
  let result;
  try {
    result = await seedVerifiedBundle(env.BUNDLE, id, payloads, { assertOwned: () => lock.assertOwned() });
  } finally {
    await dispose();
  }
  console.log(
    result.unchangedFrozen
      ? `Bundle "${id}" is locked in R2 and matches this one exactly; nothing was written.`
      : `Loaded ${result.files} files (${(result.bytes / 1048576).toFixed(1)} MB) of bundle "${id}" into the Cloudflare R2 bucket "${bucket}".`,
  );
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
  lock.release();
}
