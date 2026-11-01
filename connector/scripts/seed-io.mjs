// Local R2 publication consumes the already verified map from readConnectorBundle.
// The filesystem sync lock serializes cooperating local seeders; remote writes are outside this helper.
import { Buffer } from 'node:buffer';

const parseIdentity = (bytes, id) => {
  let meta;
  try { meta = JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error('Invalid existing R2 bundle metadata; inspect local storage before retrying.'); }
  if (!meta || meta.schema !== 'openislet-bundle/1' || meta.id !== id || typeof meta.frozen !== 'boolean') {
    throw new Error('Invalid existing R2 bundle identity or frozen state; inspect local storage before retrying.');
  }
  return meta;
};

export async function seedVerifiedBundle(bucket, id, payloads, { assertOwned = () => {} } = {}) {
  assertOwned();
  if (!/^[a-z0-9][a-z0-9.-]{0,79}$/.test(id) || id.includes('..') || !payloads.has('meta.json')) throw new Error('Invalid verified seed bundle.');
  const nextMetadata = payloads.get('meta.json');
  parseIdentity(nextMetadata, id);
  const prior = await bucket.get(`${id}/meta.json`);
  assertOwned();
  if (prior !== null) {
    const priorBytes = Buffer.from(await prior.arrayBuffer());
    const previous = parseIdentity(priorBytes, id);
    if (previous.frozen) {
      if (!priorBytes.equals(nextMetadata)) throw new Error('R2 bundle is locked; metadata and all payload bytes must remain identical.');
      for (const [relative, body] of payloads) {
        if (relative === 'meta.json') continue;
        const old = await bucket.get(`${id}/${relative}`);
        assertOwned();
        if (!old || !Buffer.from(await old.arrayBuffer()).equals(body)) throw new Error('R2 bundle is locked; metadata and all payload bytes must remain identical.');
      }
      return { files: 0, bytes: 0, unchangedFrozen: true };
    }
  }
  let files = 0, bytes = 0;
  // Always publish metadata last, even if the input map is reordered.
  for (const [relative, body] of [...payloads].filter(([relative]) => relative !== 'meta.json').concat([['meta.json', nextMetadata]])) {
    assertOwned();
    await bucket.put(`${id}/${relative}`, body);
    assertOwned();
    files++; bytes += body.length;
  }
  return { files, bytes, unchangedFrozen: false };
}
