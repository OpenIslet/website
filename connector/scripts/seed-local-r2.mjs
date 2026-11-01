#!/usr/bin/env node
// Loads a built bundle into the local R2 that `wrangler dev` uses, so the Worker can be tried on this machine.
//
//   npm run bundle && npm run seed && npm run dev
//
// This writes only to connector/.wrangler/state. It does not touch Cloudflare.
import { getPlatformProxy } from 'wrangler';
import { readConnectorBundle } from './bundle-io.mjs';
import { seedVerifiedBundle } from './seed-io.mjs';
import { acquireSyncLock } from '../../scripts/sync-io.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const connector = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = process.argv[2] ?? 'islet-1-draft';
const lock = await acquireSyncLock(path.resolve(connector,'..'));
try {
const dir = path.join(connector, 'bundle', id);
const payloads = readConnectorBundle(dir,id);
const { env, dispose } = await getPlatformProxy({ configPath: path.join(connector, 'wrangler.jsonc'), persist: { path: path.join(connector, '.wrangler', 'state', 'v3') } });
let result;
try {
  result = await seedVerifiedBundle(env.BUNDLE, id, payloads, { assertOwned: () => lock.assertOwned() });
} finally { await dispose(); }
console.log(`Seeded ${result.files} files (${(result.bytes / 1048576).toFixed(1)} MB) of bundle "${id}" into the local R2 (connector/.wrangler/state).`);
} finally { lock.release(); }
