// The weekend job's way to tell a marker the bot wrote from text a contributor pasted: scripts/verify-marker.mjs.
import { describe, expect, it } from 'vitest';
import { buildIssueBody } from '../src/core/queue/issue';
// @ts-expect-error The script is plain JavaScript, shared with the command line.
import { verifyMarker } from '../scripts/verify-marker.mjs';
import { SIGNING_KEY } from './queue-fakes';

const content = {
  login: 'octo-cat',
  via: 'mcp_link' as const,
  contributor: {},
  aiTools: { draft: 'A', review: 'B' },
  writtenAgainst: 'islet-1-draft',
  draft: '# T\n\nbody',
  review: '# R\n\nbody',
  claim: 'It says --> and <b>html</b> & more',
  pmids: ['1370298', '12345678'],
  idempotencyKey: 'key-1',
};

describe('verify-marker', () => {
  it('accepts the marker the Worker writes, and returns its fields', async () => {
    const body = await buildIssueBody(content, SIGNING_KEY);
    const result = verifyMarker(body, SIGNING_KEY);
    expect(result).toMatchObject({ found: true, genuine: true, fields: { v: 1, idempotency_key: 'key-1', claim: content.claim, pmids: content.pmids, via: 'mcp_link' } });
  });

  it('binds the issue text: a genuine marker moved onto other text, or an edited issue, is not genuine', async () => {
    const body = await buildIssueBody(content, SIGNING_KEY);
    const marker = body.trimEnd().split('\n').pop() as string;

    // The marker is the bot's and unchanged, but it now sits under a rewritten draft, a rewritten review, or a different GitHub name.
    const rewrittenDraft = body.replace('body\n\n</details>', 'a very different claim\n\n</details>');
    const rewrittenReview = body.replace('# R\n\nbody', '# R\n\nthis review says something else');
    const otherName = body.replace('Submitted by @octo-cat', 'Submitted by @someone-else');
    for (const [what, edited] of [['draft', rewrittenDraft], ['review', rewrittenReview], ['name', otherName]] as const) {
      expect(edited, `the ${what} edit changed the text`).not.toBe(body);
      const result = verifyMarker(edited, SIGNING_KEY);
      expect(result, `a changed ${what} is caught`).toMatchObject({ found: true, genuine: false, signatureOk: true, contentOk: false });
      expect(result.reason).toMatch(/not what the bot signed/);
    }

    // A real marker pasted under made-up text, as someone moving it to another issue would do.
    const transplanted = `Submitted by @octo-cat (verified through GitHub)\n\nAn IIP the bot never saw.\n\n${marker}`;
    expect(verifyMarker(transplanted, SIGNING_KEY)).toMatchObject({ found: true, genuine: false, contentOk: false });

    // Line endings and trailing blank lines do not matter: an editor or GitHub may change them without changing the words.
    expect(verifyMarker(body.replace(/\n/g, '\r\n') + '\r\n\r\n', SIGNING_KEY).genuine).toBe(true);
  });

  it('does not accept a marker that carries no fingerprint of the text', async () => {
    const crypto = await import('node:crypto');
    const fields = { v: 1, idempotency_key: null, claim: null, pmids: [], via: 'web_form' };
    const sig = crypto.createHmac('sha256', SIGNING_KEY).update(JSON.stringify(fields)).digest('hex');
    const result = verifyMarker(`Some text\n<!-- openislet:submission ${JSON.stringify({ ...fields, sig })} -->`, SIGNING_KEY);
    expect(result).toMatchObject({ found: true, genuine: false, signatureOk: true });
    expect(result.reason).toMatch(/no fingerprint/);
  });

  it('refuses a key that is not the Worker\'s, a changed field, text after the marker and a body with no marker', async () => {
    const body = await buildIssueBody(content, SIGNING_KEY);
    expect(verifyMarker(body, 'another-signing-key-of-the-same-sort-0123456789').genuine).toBe(false);
    expect(verifyMarker(body.replace('"via":"mcp_link"', '"via":"web_form"'), SIGNING_KEY).genuine).toBe(false);
    expect(verifyMarker(body.replace('"pmids":["1370298","12345678"]', '"pmids":["1"]'), SIGNING_KEY).genuine).toBe(false);
    expect(verifyMarker(`${body}\nextra line after the marker`, SIGNING_KEY)).toMatchObject({ found: false, genuine: false });
    expect(verifyMarker('no marker here', SIGNING_KEY)).toMatchObject({ found: false, genuine: false });
    expect(verifyMarker('<!-- openislet:submission {not json} -->', SIGNING_KEY)).toMatchObject({ found: true, genuine: false });
    expect(verifyMarker(`<!-- openislet:submission ${JSON.stringify({ v: 1, sig: 'x' })} -->`, SIGNING_KEY)).toMatchObject({ found: true, genuine: false });
  });
});
