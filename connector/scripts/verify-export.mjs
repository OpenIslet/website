#!/usr/bin/env node
// Checks that a folder is a rights-aware public export of the blueprint, with the verifier that `npm run bundle` uses: the marker
// file, no private dossiers, every file pinned in the manifest with the right size and hash, and nothing else in the folder.
//
//   node scripts/verify-export.mjs <folder>
import path from 'node:path';
import { verifyPublicExport } from './bundle-io.mjs';

if (!process.argv[2]) {
  console.error('Usage: node scripts/verify-export.mjs <folder>');
  process.exit(2);
}
const root = path.resolve(process.argv[2]);
try {
  const manifest = verifyPublicExport(root);
  console.log(`Verified ${manifest.public_export_file_inventory.length} public files in ${root}`);
} catch (error) {
  console.error(`Not a verified public export: ${error.message}`);
  process.exit(1);
}
