// The browser-side helpers of the submission form (src/scripts/submit.ts). The Worker's own checks are the ones that count;
// these only catch common slips early, so they must be right about the things they do say.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function load() {
  const result = await build({ entryPoints: [join(root, 'src/scripts/submit.ts')], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const { MAX_TEXT, sizeOf, orcidOk, orcidClean, xHandleOk, verdictOf, quickCheck, draftProblems, reviewProblems, whatIsThis, tidy, sha256Hex, newSecret, stateOf, bindingKey, store, STAGED_KEY } = await load();

// Complete files, written the way the templates in src/data/prompts.ts ask (the Worker refuses anything less, so the form does too).
const goodDraft = [
  '# Too little CD47 at hour zero?',
  '**Type:** Problem found',
  '**Claim in one sentence:** The cells may carry too little CD47 in the first hours.',
  '**In plain English:** The new cells may carry too little of the signal that tells macrophages to leave them alone.',
  '**Affects test:** 3, because macrophages attack in the first hours',
  '**Affects design:** Design A',
  '## Evidence',
  '- Example paper, PMID 12345678, "The exact sentence from the paper goes here."',
  '## What I propose changing',
  'Measure CD47 at hour zero.',
  '## How this could be wrong',
  'Inflammation may raise it in time.',
  '## Cheapest way to check it',
  'Count CD47 on resting cells.',
  '## AI tools used',
  'Example model (High Effort)',
].join('\n');
const goodReview = [
  '# Review: CD47',
  '**Claim reviewed:** The cells may carry too little CD47 in the first hours.',
  '**Verdict:** Partly supported',
  '**Confidence:** Medium',
  '**Submit to OpenIslet?** Yes',
  '**In plain English:** The idea is reasonable but depends on levels nobody has measured.',
  '## What I checked',
  'The claim against the blueprint.',
  '## Evidence for',
  '- B2M is low in resting cells.',
  '## Evidence against',
  '- Inflammation raises B2M quickly.',
  '## Idea Graveyard check',
  'Close to GY-009, not in conflict.',
  '## Other ways it could fail',
  'The effect may be too small.',
  '## Cheapest way to settle it',
  'Measure CD47 on resting and inflamed cells.',
  '## AI tools used',
  'Another example model (Max Effort)',
].join('\n');
/** The file copied out of a chat as formatted text: the # and ** marks and the list dashes are gone. */
const rendered = (md) => md.split('\n').map((l) => l.replace(/^#{1,6}\s+/, '').replace(/\*\*/g, '').replace(/^- /, '')).join('\n');
const ok = { draft: goodDraft, review: goodReview, consent: true, name: '', orcid: '', x: '' };

test('ORCID iDs are checked by shape and by check digit', () => {
  assert.equal(orcidOk('0000-0002-1825-0097'), true); // the published example iD
  assert.equal(orcidOk('0000-0002-1694-233X'), true); // a check digit of X
  assert.equal(orcidOk('0000-0002-1825-0098'), false); // wrong check digit
  assert.equal(orcidOk('0000000218250097'), false); // no hyphens
  assert.equal(orcidOk(''), false);
  // A pasted address is cut back to the iD, and a lower-case check character is accepted (the Worker does the same).
  assert.equal(orcidOk('https://orcid.org/0000-0002-1825-0097'), true);
  assert.equal(orcidClean(' https://orcid.org/0000-0002-1694-233x '), '0000-0002-1694-233X');
});

test('X handles allow letters, digits and underscores up to 15, with or without the @', () => {
  for (const good of ['OpenIslet', '@OpenIslet', 'a_b_9']) assert.equal(xHandleOk(good), true, good);
  for (const bad of ['', '@', 'has space', 'way_too_long_for_a_handle', 'dots.not.allowed']) assert.equal(xHandleOk(bad), false, bad);
});

test('the verdict is read however an AI writes it', () => {
  const read = (line) => verdictOf(`# Review\n**Claim reviewed:** x\n${line}\n**Confidence:** Medium`);
  assert.equal(read('**Verdict:** Supported'), 'supported');
  assert.equal(read('**Verdict:** Partly supported'), 'partly supported');
  assert.equal(read('**Verdict:** Not supported'), 'not supported');
  assert.equal(read('**Verdict:** Cannot tell'), 'cannot tell');
  // bold, a full stop, a dash and a reason, a list dash, the colon outside the bold, the answer on the next line
  assert.equal(read('**Verdict:** **Supported**'), 'supported');
  assert.equal(read('**Verdict:** Supported.'), 'supported');
  assert.equal(read('**Verdict:** Supported - the claim holds'), 'supported');
  assert.equal(read('**Verdict:** Partly supported — mostly, with one gap'), 'partly supported');
  assert.equal(read('- **Verdict**: Partly supported'), 'partly supported');
  assert.equal(read('**Verdict:**\nSupported'), 'supported');
  assert.equal(verdictOf('**Verdict:** Supported\r\n'), 'supported');
  // "not supported" is never read as "supported"
  assert.equal(read('**Verdict:** **Not supported.**'), 'not supported');
});

test('a verdict line that has not been answered is not a verdict', () => {
  const read = (line) => verdictOf(`# Review\n${line}\n**Confidence:** Medium`);
  // the template's list of choices, left as it came
  assert.equal(read('**Verdict:** [Supported | Partly supported | Not supported | Cannot tell]'), null);
  assert.equal(read('**Verdict:** [Partly supported | Supported]'), null);
  assert.equal(read('**Verdict:** Supported | Not supported'), null);
  assert.equal(read('**Verdict:** [Supported]'), null); // square brackets mean "not filled in yet", as they do on the connector
  // empty, a word that only starts like a verdict, and no verdict line at all
  assert.equal(read('**Verdict:**'), null);
  assert.equal(read('**Verdict:** Supportedness is not a verdict'), null);
  assert.equal(verdictOf('no verdict here'), null);
  assert.equal(verdictOf('# Review\n**Claim reviewed:** x\nVerdict: Supported'), 'supported'); // not in bold: still the verdict line
});

test('the problem list tells the person how to fix the verdict line', () => {
  const unanswered = goodReview.replace('Partly supported', '[Supported | Partly supported | Not supported | Cannot tell]');
  const problems = quickCheck({ draft: goodDraft, review: unanswered, consent: true, name: '', orcid: '', x: '' });
  assert.equal(problems.length, 1);
  assert.equal(problems[0].field, 'review');
  assert.match(problems[0].text, /could not read the verdict/);
  assert.match(problems[0].text, /Verdict: Supported/);
  // a bolded, punctuated verdict is fine
  const bolded = goodReview.replace('Partly supported', '**Supported.**');
  assert.deepEqual(quickCheck({ draft: goodDraft, review: bolded, consent: true, name: '', orcid: '', x: '' }), []);
  // a review that says it fails is explained, and is not the same problem
  const failing = goodReview.replace('Partly supported', 'Not supported');
  const failed = quickCheck({ draft: goodDraft, review: failing, consent: true, name: '', orcid: '', x: '' });
  assert.match(failed[0].text, /Only IIPs whose review says Supported or Partly supported/);
});

test('good files with consent have nothing to fix', () => {
  assert.deepEqual(quickCheck(ok), []);
});

test('each common slip is named in plain English', () => {
  const fields = (v) => quickCheck({ ...ok, ...v }).map((p) => p.field);
  assert.deepEqual(fields({ draft: '' }), ['draft']);
  assert.deepEqual(fields({ review: '' }), ['review']);
  assert.deepEqual(fields({ consent: false }), ['consent']);
  assert.deepEqual(fields({ review: goodReview.replace('Partly supported', 'Not supported') }), ['review']);
  assert.deepEqual(fields({ review: goodReview.replace('**Claim reviewed:**', '**Claim:**') }), ['review']);
  assert.deepEqual(fields({ draft: 'just some words' }), ['draft']);
  assert.deepEqual(fields({ orcid: '0000-0002-1825-0098' }), ['orcid']);
  assert.deepEqual(fields({ x: 'has space' }), ['x']);
  assert.deepEqual(fields({ name: 'n'.repeat(81) }), ['name']);
  assert.deepEqual(fields({ draft: goodDraft + 'x'.repeat(60000) }), ['draft']);
});

test('the sign-in secret is long, different each time, and hashes to 64 hex characters', async () => {
  const a = newSecret();
  const b = newSecret();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.match(await sha256Hex(a), /^[0-9a-f]{64}$/);
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

// ---- the sign-in secret and the browser's storage (FRESH-WEB-B05, B06) ----

/** A stand-in for sessionStorage, so the helpers can be tried with storage that works, throws, or quietly forgets. */
function fakeStorage({ throws = false, forgets = false } = {}) {
  const data = new Map();
  return {
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => (forgets || !data.has(k) ? null : data.get(k)),
    setItem: (k, v) => {
      if (throws) throw new Error('QuotaExceededError');
      data.set(k, String(v));
    },
    removeItem: (k) => {
      data.delete(k);
    },
  };
}
function withStorage(storage, run) {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { value: storage, configurable: true, writable: true });
  try {
    return run(storage);
  } finally {
    if (had) Object.defineProperty(globalThis, 'sessionStorage', had);
    else delete globalThis.sessionStorage;
  }
}

test('the sign-in state is read from the GitHub address, and only if it has the shape the Worker issues', () => {
  const state = 'AbCdEfGhIjKlMnOpQrStUv';
  assert.equal(stateOf(`https://github.com/login/oauth/authorize?client_id=x&state=${state}&allow_signup=true`), state);
  assert.equal(stateOf('https://github.com/login/oauth/authorize?client_id=x'), null); // no state
  assert.equal(stateOf('https://github.com/login/oauth/authorize?state=short'), null); // wrong shape
  assert.equal(stateOf('https://github.com/login/oauth/authorize?state=has%20spaces%20and%20more%20text%20here'), null);
  assert.equal(stateOf('not an address'), null);
});

test('each sign-in keeps its secret under its own name', () => {
  assert.notEqual(bindingKey('AAAAAAAAAAAAAAAAAAAAAA'), bindingKey('BBBBBBBBBBBBBBBBBBBBBB'));
  assert.ok(bindingKey('AAAAAAAAAAAAAAAAAAAAAA').endsWith('AAAAAAAAAAAAAAAAAAAAAA'));
});

test('storage that works keeps a value, and the probe leaves nothing behind', () => {
  withStorage(fakeStorage(), (storage) => {
    assert.equal(store.works(), true);
    assert.equal(storage.length, 0);
    assert.equal(store.set('k', 'v'), true);
    assert.equal(store.get('k'), 'v');
  });
});

test('storage that refuses a write, or quietly forgets it, is reported so the person is not sent to GitHub for nothing', () => {
  withStorage(fakeStorage({ throws: true }), () => {
    assert.equal(store.works(), false);
    assert.equal(store.set('k', 'v'), false);
    assert.equal(store.get('k'), null);
  });
  withStorage(fakeStorage({ forgets: true }), () => {
    assert.equal(store.works(), false); // written without an error but not kept: the read-back catches it
    assert.equal(store.set('k', 'v'), false);
  });
});

test('clearing the kept sign-in secrets leaves everything else alone', () => {
  withStorage(fakeStorage(), () => {
    store.set(bindingKey('AAAAAAAAAAAAAAAAAAAAAA'), 'one');
    store.set(bindingKey('BBBBBBBBBBBBBBBBBBBBBB'), 'two');
    store.set(STAGED_KEY, 'staged');
    store.set('unrelated', 'x');
    store.clearBindings();
    assert.equal(store.get(bindingKey('AAAAAAAAAAAAAAAAAAAAAA')), null);
    assert.equal(store.get(bindingKey('BBBBBBBBBBBBBBBBBBBBBB')), null);
    assert.equal(store.get(STAGED_KEY), 'staged');
    assert.equal(store.get('unrelated'), 'x');
  });
});

test('the whole reply from the AI is read, not refused', () => {
  const step3 = `Here's your draft:\n\n\`\`\`markdown\n${goodDraft}\n\`\`\`\n\nFRESH-CHAT PROMPT\n\n\`\`\`\nYou are a blind reviewer. CLAIM TO TEST\nx\nHow to review:\n1. Restate the claim.\n\`\`\`\n\nAnything else?`;
  assert.deepEqual(draftProblems(step3), []);
  assert.equal(tidy(step3, 'draft').text, goodDraft);
  assert.deepEqual(reviewProblems(`Here is the review:\n\n\`\`\`\n${goodReview}\n\`\`\``), []);
});

test('a file copied as formatted text is read, and gets its marks back', () => {
  assert.deepEqual(draftProblems(rendered(goodDraft)), []);
  assert.deepEqual(reviewProblems(rendered(goodReview)), []);
  assert.equal(tidy(rendered(goodDraft), 'draft').rebuilt, true);
  assert.match(tidy(rendered(goodDraft), 'draft').text, /^# Too little CD47 at hour zero\?\n\*\*Type:\*\* Problem found/);
});

test('the fresh-chat prompt, or a file in the wrong box, is named for what it is', () => {
  const prompt = 'You are a blind reviewer for OpenIslet. [OPENISLET-REVIEW-v1]\n\nCLAIM TO TEST\nThe cells may carry too little CD47.\n\nHow to review:\n1. Restate the claim.\n**Verdict:** [Supported | Partly supported | Not supported | Cannot tell]';
  assert.equal(whatIsThis(prompt), 'review-prompt');
  assert.match(reviewProblems(prompt)[0].text, /prompt you paste into a brand-new chat/);
  assert.match(draftProblems(prompt)[0].text, /prompt for the fresh chat/);
  assert.equal(whatIsThis(goodReview), 'review');
  assert.match(draftProblems(goodReview)[0].text, /looks like your blind review, not your draft/);
  assert.match(reviewProblems(goodDraft)[0].text, /looks like your draft, not the blind review/);
});

test('a missing part is named, and a type outside the list is caught, as the Worker would', () => {
  const noClaim = goodDraft.replace(/\*\*Claim in one sentence:\*\*.*\n/, '');
  assert.match(draftProblems(noClaim)[0].text, /missing "Claim in one sentence"/);
  assert.match(draftProblems(goodDraft.replace('Problem found', 'A worry'))[0].text, /“Type” line should say one of/);
});

test('a file pasted twice, or two files in one box, gets one clear message, not a list of missing parts', () => {
  const draftTwice = draftProblems(`${goodDraft}\n\n${goodDraft}`);
  assert.equal(draftTwice.length, 1);
  assert.equal(draftTwice[0].field, 'draft');
  assert.match(draftTwice[0].text, /more than one file in this box/);
  assert.doesNotMatch(draftTwice[0].text, /missing/);
  const reviewTwice = reviewProblems(`${goodReview}\n\n${goodReview}`);
  assert.equal(reviewTwice.length, 1);
  assert.equal(reviewTwice[0].field, 'review');
  assert.match(reviewTwice[0].text, /more than one file in this box/);
  assert.doesNotMatch(reviewTwice[0].text, /missing/);
  // A single good file is not touched, and a file that is only missing parts still says which.
  assert.deepEqual(draftProblems(goodDraft), []);
  assert.deepEqual(reviewProblems(goodReview), []);
  assert.match(draftProblems(goodDraft.replace(/## Evidence[\s\S]*?(?=## What I propose)/, ''))[0].text, /missing/);
});

test('the size limit on the form is the Worker\'s own, and is measured on the file, not on the chat around it', async () => {
  const draftSource = await readFile(join(root, 'connector/src/core/draft.ts'), 'utf8');
  const workerMax = Number(/export const LIMITS = \{ min: \d+, max: (\d+) \}/.exec(draftSource)?.[1]);
  assert.equal(MAX_TEXT, workerMax);
  // Pad the "What I propose changing" section until the file is exactly the limit, then one over.
  const padded = (n) => goodDraft.replace('Measure CD47 at hour zero.', 'x'.repeat(n));
  const base = sizeOf(padded(1), 'draft') - 1;
  const atLimit = padded(MAX_TEXT - base);
  assert.equal(sizeOf(atLimit, 'draft'), MAX_TEXT);
  assert.ok(!draftProblems(atLimit).some((p) => /too long/.test(p.text)));
  const over = padded(MAX_TEXT - base + 1);
  assert.match(draftProblems(over)[0].text, /too long \(30,001 characters\)\. The limit is 30,000/);
  // A file just under the limit inside a long chatty reply is fine: only the file counts, as at the Worker.
  const chatty = `Here is your file:\n\n\`\`\`markdown\n${atLimit}\n\`\`\`\n\n${'Hope this helps! '.repeat(400)}`;
  assert.ok(chatty.length > MAX_TEXT + 5000);
  assert.ok(!draftProblems(chatty).some((p) => /too long/.test(p.text)));
});
