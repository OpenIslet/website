#!/usr/bin/env node
// Checks the hidden marker on the last line of a queue issue: was it written by the OpenIslet bot, and is the issue still as the bot wrote it?
//
//   gh issue view 42 --repo openislet/openislet --json body -q .body | STATE_SIGNING_KEY="..." node scripts/verify-marker.mjs
//
// The marker is `<!-- openislet:submission {...} -->`. Its `sig` is the HMAC-SHA-256 (hex) of JSON.stringify of the other
// fields, in the order they are written, under the Worker's STATE_SIGNING_KEY. Only the Worker has that key.
// One of those fields, `body_sha256`, is the SHA-256 of all the text above the marker (who signed in, the draft, the review and
// the rest). So there are two checks: the signature (the bot made the marker) and the digest (the text has not changed since, and
// the marker was not copied from another issue). Prints the marker's fields and says "genuine" or "NOT genuine".
// The exit code is 0 only when both pass.
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const MARKER_NAME = 'openislet:submission';

/** The text as the Worker fingerprints it: plain line endings and the end trimmed. Keep in step with canonicalBody in issue.ts. */
const canonical = (text) => text.replace(/\r\n?/g, '\n').trimEnd();

/** @param {string} body the issue body  @param {string} key the signing key */
export function verifyMarker(body, key) {
  const text = canonical(String(body));
  const cut = text.lastIndexOf('\n');
  const last = text.slice(cut + 1);
  const m = new RegExp(`^<!-- ${MARKER_NAME} (\\{.*\\}) -->$`).exec(last);
  if (!m) return { found: false, genuine: false, reason: 'there is no marker on the last line' };
  let parsed;
  try {
    parsed = JSON.parse(m[1]);
  } catch {
    return { found: true, genuine: false, reason: 'the marker is not valid JSON' };
  }
  const { sig, ...fields } = parsed;
  if (typeof sig !== 'string' || !/^[0-9a-f]{64}$/.test(sig)) return { found: true, genuine: false, fields, reason: 'the marker has no signature' };
  const expected = crypto.createHmac('sha256', key).update(JSON.stringify(fields)).digest('hex');
  const signatureOk = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!signatureOk) {
    return { found: true, genuine: false, signatureOk, fields, reason: 'the signature does not match: the marker was not made by the bot, or a field was changed' };
  }
  // The signature is good, so the digest in the marker is the one the bot wrote. Is the text above the marker still the text it was written for?
  if (typeof fields.body_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(fields.body_sha256)) {
    return { found: true, genuine: false, signatureOk, fields, reason: 'the marker has no fingerprint of the issue text, so it cannot show that the text is unchanged' };
  }
  const above = cut === -1 ? '' : canonical(text.slice(0, cut));
  const actual = crypto.createHash('sha256').update(above).digest('hex');
  const contentOk = crypto.timingSafeEqual(Buffer.from(fields.body_sha256), Buffer.from(actual));
  return {
    found: true,
    genuine: contentOk,
    signatureOk,
    contentOk,
    fields,
    reason: contentOk
      ? undefined
      : 'the marker is the bot\'s, but the issue text above it is not what the bot signed: the draft, the review or the name was changed after posting, or this marker was copied from another issue',
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const key = process.env.STATE_SIGNING_KEY;
  if (!key) {
    console.error('Set STATE_SIGNING_KEY to the Worker\'s signing key first.');
    process.exit(2);
  }
  let body = '';
  for await (const chunk of process.stdin) body += chunk;
  const result = verifyMarker(body, key);
  if (result.fields) console.log(JSON.stringify(result.fields, null, 2));
  console.log(result.genuine ? 'genuine: made by the OpenIslet bot, and the issue text is unchanged' : `NOT genuine: ${result.reason}`);
  process.exit(result.genuine ? 0 : 1);
}
