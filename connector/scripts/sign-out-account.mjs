// Ends every AI-app sign-in of one GitHub account at once: for example, when someone tells us an AI app was approved in their
// name without their consent. It first writes `signed-out:<id>` in OAUTH_KV with the time: the connector then refuses every
// approval made before it (src/connector-oauth.ts, `signedOut`), even one that a refresh already under way writes back. Then it
// deletes that account's grants and tokens, so each app has to sign in again, with the person's own approval. Nothing else
// changes: IIPs already posted stay, and the web form's sign-in keeps nothing to remove.
//
//   node scripts/sign-out-account.mjs <github-user-id> [--env staging] [--dry-run]
//
// The id is GitHub's number for the account, not its name (`gh api users/<name> --jq .id`). It runs wrangler with your login.
// --dry-run only counts what would be deleted. tests/queue-oauth.test.ts proves that deleting these keys ends the sign-in.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The record that ends the account's approvals: the same key and lifetime as `signedOutKey` and `SIGNED_OUT_TTL_SECONDS`. */
export function signedOutRecord(githubId, now = Date.now()) {
  prefixesFor(githubId);
  return { key: `signed-out:${githubId}`, value: String(now), ttl: 8 * 24 * 60 * 60 };
}

/** The OAUTH_KV key prefixes that hold one account's AI-app sign-ins (@cloudflare/workers-oauth-provider: grant:{userId}:…, token:{userId}:…). */
export function prefixesFor(githubId) {
  if (!/^\d{1,12}$/.test(String(githubId))) throw new Error(`Not a GitHub user id: ${githubId} (use the number, not the name)`);
  return [`grant:${githubId}:`, `token:${githubId}:`];
}

function main() {
  const args = process.argv.slice(2);
  const env = args.includes('--env') ? args[args.indexOf('--env') + 1] : undefined;
  const dryRun = args.includes('--dry-run');
  const id = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--env');
  const prefixes = prefixesFor(id);

  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const wrangler = join(root, 'node_modules', '.bin', 'wrangler');
  const where = ['--binding', 'OAUTH_KV', '--remote', ...(env ? ['--env', env] : [])];
  if (!dryRun) {
    const record = signedOutRecord(id);
    execFileSync(wrangler, ['kv', 'key', 'put', record.key, record.value, '--ttl', String(record.ttl), ...where], { cwd: root, stdio: 'inherit' });
    console.log(`Every approval made before now is refused (${record.key}).`);
  }
  const names = [];
  for (const prefix of prefixes) {
    const listed = JSON.parse(execFileSync(wrangler, ['kv', 'key', 'list', '--prefix', prefix, ...where], { cwd: root, encoding: 'utf8' }));
    names.push(...listed.map((k) => k.name));
    console.log(`${prefix.split(':')[0]} keys: ${listed.length}`);
  }
  if (dryRun || names.length === 0) {
    console.log(dryRun ? 'Dry run: nothing was written or deleted.' : 'This account has no AI-app sign-ins left to delete.');
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'openislet-sign-out-'));
  try {
    const file = join(dir, 'keys.json');
    writeFileSync(file, JSON.stringify(names));
    execFileSync(wrangler, ['kv', 'bulk', 'delete', file, ...where, '--force'], { cwd: root, stdio: 'inherit' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`Signed out: ${names.length} keys deleted. Each AI app has to sign in again (allow up to a minute to reach every location).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
