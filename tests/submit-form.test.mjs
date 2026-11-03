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
const { MAX_TEXT, sizeOf, orcidOk, orcidClean, xHandleOk, verdictOf, quickCheck, draftProblems, reviewProblems, whatIsThis, tidy, sha256Hex, newSecret, stateOf, bindingKey, store, STAGED_KEY, shared, doneKey, postedElsewhere, LINGER_MS, SAVED_KEY, POSTED_KEY, remember, remembered, forgetIfPosted, splitFiles, keptOrcidProof, clearOrcidBindings, orcidAuthorizeOk, orcidBindingKey, ORCID_PROOF_KEY, FORM_STAGED_KEY } = await load();

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
function withStorage(storage, run, name = 'sessionStorage') {
  const had = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { value: storage, configurable: true, writable: true });
  try {
    return run(storage);
  } finally {
    if (had) Object.defineProperty(globalThis, name, had);
    else delete globalThis[name];
  }
}
/** This tab's storage and the browser's shared storage, both fresh. */
const withBoth = (run, local = fakeStorage()) => withStorage(fakeStorage(), (tab) => withStorage(local, (browser) => run(tab, browser), 'localStorage'));

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

// ---- Another tab, a reload, two files in one box (3 November 2026). Neutral sample files: these tests are about the form only.
const plainDraft = [
  '# Steps in the other order',
  '**Type:** Improvement',
  '**Claim in one sentence:** Step two should come before step one.',
  '**In plain English:** Doing the steps the other way round saves a day.',
  '**Affects test:** 1, because it changes the order',
  '**Affects design:** Design A',
  '## Evidence',
  '- Example paper, PMID 12345678, "An example quote."',
  '## What I propose changing',
  'Swap steps one and two.',
  '## How this could be wrong',
  'Step one may need step two first.',
  '## Cheapest way to check it',
  'Time both orders once.',
  '## AI tools used',
  'Example model (High Effort)',
].join('\n');
const plainReview = [
  '# Review: Steps in the other order',
  '**Claim reviewed:** Swapping the two steps saves a day.',
  '**Verdict:** Partly supported',
  '**Confidence:** Medium',
  '**Submit to OpenIslet?** Yes',
  '**In plain English:** The swap probably helps, but nobody has timed it.',
  '## What I checked',
  'The claim against the blueprint.',
  '## Evidence for',
  '- The example paper says so.',
  '## Evidence against',
  '- Nothing found.',
  '## Idea Graveyard check',
  'No rule nearby.',
  '## Other ways it could fail',
  'The saving may be smaller.',
  '## Cheapest way to settle it',
  'Time both orders once.',
  '## AI tools used',
  'Another example model (Max Effort)',
].join('\n');
const S1 = 'AAAAAAAAAAAAAAAAAAAAAA';
const S2 = 'BBBBBBBBBBBBBBBBBBBBBB';

test('a sign-in kept for another tab comes back until it expires, then is gone', () => {
  withBoth((tab, browser) => {
    const now = 1_000_000;
    assert.equal(shared.set(bindingKey(S1), { secret: 'one', staged: 'files' }, now), true);
    assert.deepEqual(shared.get(bindingKey(S1), now + LINGER_MS - 1), { secret: 'one', staged: 'files' });
    assert.equal(shared.get(bindingKey(S1), now + LINGER_MS), 'expired');
    assert.equal(browser.length, 0);
    assert.equal(shared.get(bindingKey(S1), now + LINGER_MS), null);
    assert.equal(LINGER_MS, 15 * 60 * 1000); // as long as a sign-in link lasts
  });
});

test('a kept sign-in from a clock moved back, or damaged, is not used', () => {
  withBoth((tab, browser) => {
    const now = 1_000_000;
    shared.set(bindingKey(S1), { secret: 'one' }, now + 2 * LINGER_MS);
    assert.equal(shared.get(bindingKey(S1), now), 'expired');
    browser.setItem(bindingKey(S2), 'not json');
    assert.equal(shared.get(bindingKey(S2), now), null);
    browser.setItem(bindingKey(S2), JSON.stringify({ secret: 'two' }));
    assert.equal(shared.get(bindingKey(S2), now), null);
    browser.setItem(bindingKey(S2), JSON.stringify({ secret: 7, until: now + 1000 }));
    assert.deepEqual(shared.get(bindingKey(S2), now), {});
    assert.equal(browser.length, 1);
  });
});

test('a browser that will not keep the shared copy just goes without it', () => {
  withBoth(
    () => {
      assert.equal(shared.set(bindingKey(S1), { secret: 'one' }), false);
      assert.equal(shared.get(bindingKey(S1)), null);
      shared.sweep();
    },
    fakeStorage({ throws: true }),
  );
});

test('the sweep removes only expired sign-in entries', () => {
  withBoth((tab, browser) => {
    const now = 1_000_000;
    shared.set(bindingKey(S1), { secret: 'old' }, now - LINGER_MS);
    shared.set(doneKey(S1), {}, now - LINGER_MS);
    shared.set(bindingKey(S2), { secret: 'new' }, now);
    browser.setItem('unrelated', 'x');
    shared.sweep(now + 1);
    assert.deepEqual([...Array(browser.length).keys()].map((i) => browser.key(i)).sort(), [bindingKey(S2), 'unrelated'].sort());
  });
});

test('starting a new sign-in removes this tab\'s old ones from the shared copy too, and no other tab\'s', () => {
  withBoth(() => {
    store.set(bindingKey(S1), 'one');
    shared.set(bindingKey(S1), { secret: 'one' });
    shared.set(bindingKey(S2), { secret: 'another tab' });
    store.clearBindings();
    assert.equal(shared.get(bindingKey(S1)), null);
    assert.deepEqual(shared.get(bindingKey(S2)), { secret: 'another tab' });
  });
});

test('a sign-in finished in another tab is noticed by the tab that started it, and only by that tab', () => {
  withBoth(() => {
    store.set(bindingKey(S1), 'one');
    assert.equal(postedElsewhere(), false);
    shared.set(doneKey(S2), {});
    assert.equal(postedElsewhere(), false);
    shared.set(doneKey(S1), {});
    assert.equal(postedElsewhere(), true);
  });
});

test('the form\'s text is kept in this tab, never the tick, and an empty form keeps nothing', () => {
  withBoth((tab, browser) => {
    const v = { draft: 'd', review: 'r', name: 'n', orcid: '', x: '', aiDraft: 'a', aiReview: '', consent: true };
    remember(v);
    assert.equal(browser.length, 0);
    assert.doesNotMatch(tab.getItem(SAVED_KEY), /consent/);
    assert.deepEqual(remembered(), { draft: 'd', review: 'r', name: 'n', orcid: '', x: '', aiDraft: 'a', aiReview: '' });
    remember({ draft: ' ', review: '', name: '', orcid: '', x: '', aiDraft: '', aiReview: '' });
    assert.equal(tab.getItem(SAVED_KEY), null);
    assert.equal(remembered(), null);
    tab.setItem(SAVED_KEY, '{damaged');
    assert.equal(remembered(), null);
    tab.setItem(SAVED_KEY, JSON.stringify({ draft: 5, review: 'r' }));
    assert.deepEqual(remembered(), { draft: '', review: 'r', name: '', orcid: '', x: '', aiDraft: '', aiReview: '' });
  });
});

test('a draft and a review in one box are split, in either order and however they were pasted', () => {
  const both = { draft: plainDraft, review: plainReview };
  assert.deepEqual(splitFiles(`${plainDraft}\n\n${plainReview}`), both);
  assert.deepEqual(splitFiles(`${plainReview}\n\n${plainDraft}`), both);
  assert.deepEqual(splitFiles(`${plainDraft}\r\n\r\n${plainReview}`.replace(/\n/g, '\r\n')), both);
  const chat = `Here is the draft:\n\n\`\`\`markdown\n${plainDraft}\n\`\`\`\n\nAnd the review:\n\n\`\`\`markdown\n${plainReview}\n\`\`\`\n\nAnything else?`;
  assert.deepEqual(splitFiles(chat), both);
  const copied = splitFiles(`${rendered(plainDraft)}\n\n${rendered(plainReview)}`);
  assert.ok(copied);
  assert.equal(whatIsThis(copied.draft), 'draft');
  assert.equal(whatIsThis(copied.review), 'review');
  assert.deepEqual(draftProblems(copied.draft), []);
  assert.deepEqual(reviewProblems(copied.review), []);
});

test('one file, or the same file twice, is never split', () => {
  for (const text of [plainDraft, plainReview, `${plainDraft}\n\n${plainDraft}`, `${plainReview}\n\n${plainReview}`, '', 'Just some words.\n# A heading\nMore words.'])
    assert.equal(splitFiles(text), null, text.slice(0, 40));
});

test('files already posted, from this tab or another, are forgotten, and nothing else is', () => {
  withBoth(() => {
    remember({ draft: 'd', review: 'r', name: '', orcid: '', x: '', aiDraft: '', aiReview: '' });
    store.set(bindingKey(S1), 'one');
    assert.equal(forgetIfPosted(), false);
    assert.ok(remembered());
    shared.set(doneKey(S1), {});
    assert.equal(forgetIfPosted(), true);
    assert.equal(remembered(), null);
    assert.equal(store.get(bindingKey(S1)), null);
    assert.equal(forgetIfPosted(), false);
    remember({ draft: 'new', review: '', name: '', orcid: '', x: '', aiDraft: '', aiReview: '' });
    store.set(POSTED_KEY, '1');
    assert.equal(forgetIfPosted(), true);
    assert.equal(remembered(), null);
    assert.equal(store.get(POSTED_KEY), null);
  });
});

test('a title quoted further down a code block is not a place to split', () => {
  const quoted = plainDraft.replace('Swap steps one and two.', `Swap steps one and two, as this example shows:\n\n\`\`\`\nAn example of a review:\n${plainReview}\n\`\`\``);
  assert.equal(splitFiles(quoted), null);
  assert.deepEqual(splitFiles(`${plainDraft}\n\n\`\`\`\n\n${plainReview}\n\`\`\``), { draft: plainDraft, review: plainReview });
});

// ---- "Verify my ORCID iD" (3 November 2026). The Worker checks the proof itself; these only decide what the form shows and follows.
test('a kept ORCID proof counts only while it is well formed and has time left', () => {
  withBoth((tab) => {
    const now = Date.UTC(2026, 10, 3, 12, 0, 0);
    const good = { orcid: '0000-0002-1825-0097', proof: 'payload.signature', expires_at: new Date(now + 60_000).toISOString() };
    tab.setItem(ORCID_PROOF_KEY, JSON.stringify(good));
    assert.deepEqual(keptOrcidProof(now), good);
    assert.equal(keptOrcidProof(now + 60_000), null);
    assert.equal(tab.getItem(ORCID_PROOF_KEY), null, 'an expired proof is removed');
    for (const bad of [{ ...good, orcid: '0000-0002-1825-0098' }, { ...good, proof: '' }, { ...good, expires_at: 'soon' }, 'not json']) {
      tab.setItem(ORCID_PROOF_KEY, typeof bad === 'string' ? bad : JSON.stringify(bad));
      assert.equal(keptOrcidProof(now), null);
    }
  });
});

test('once the files are posted, the ORCID proof goes with them', () => {
  withBoth((tab) => {
    tab.setItem(ORCID_PROOF_KEY, JSON.stringify({ orcid: '0000-0002-1825-0097', proof: 'p.s', expires_at: new Date(Date.now() + 60_000).toISOString() }));
    tab.setItem(POSTED_KEY, '1');
    assert.equal(forgetIfPosted(), true);
    assert.equal(tab.getItem(ORCID_PROOF_KEY), null);
  });
});

test('starting a new ORCID check clears only this tab\'s earlier ORCID checks', () => {
  withBoth((tab) => {
    tab.setItem(orcidBindingKey('AAAAAAAAAAAAAAAAAAAAAA'), 'one');
    tab.setItem(bindingKey('AAAAAAAAAAAAAAAAAAAAAA'), 'github');
    tab.setItem('unrelated', 'x');
    clearOrcidBindings();
    assert.equal(tab.getItem(orcidBindingKey('AAAAAAAAAAAAAAAAAAAAAA')), null);
    assert.equal(tab.getItem(bindingKey('AAAAAAAAAAAAAAAAAAAAAA')), 'github');
    assert.equal(tab.getItem('unrelated'), 'x');
  });
});

test('the form follows only ORCID\'s own sign-in page, or the local stand-in when it talks to a local Worker', () => {
  const live = 'https://mcp.openislet.org';
  assert.equal(orcidAuthorizeOk('https://orcid.org/oauth/authorize?client_id=APP-X&state=s', live), true);
  // ORCID's practice site never for the live site: anyone can make a practice account in a minute.
  assert.equal(orcidAuthorizeOk('https://sandbox.orcid.org/oauth/authorize?client_id=APP-X', live), false);
  assert.equal(orcidAuthorizeOk('https://sandbox.orcid.org/oauth/authorize?client_id=APP-X', 'http://127.0.0.1:8787'), true);
  for (const url of ['https://orcid.org.example.com/oauth/authorize?x', 'http://orcid.org/oauth/authorize?x', 'https://example.com/oauth/authorize?x', 'https://orcid.org/signin?x', 'javascript:alert(1)', 'http://127.0.0.1:8788/oauth/authorize?x', 42])
    assert.equal(orcidAuthorizeOk(url, live), false, String(url));
  assert.equal(orcidAuthorizeOk('http://127.0.0.1:8788/oauth/authorize?x', 'http://127.0.0.1:8787'), true);
  assert.equal(orcidAuthorizeOk('http://127.0.0.1:8788/elsewhere?x', 'http://127.0.0.1:8787'), false);
});

test('the saved files the form works from are forgotten with its text: emptied, or posted', () => {
  withBoth((tab) => {
    remember({ draft: 'd', review: '', name: '', orcid: '', x: '', aiDraft: '', aiReview: '' });
    tab.setItem(FORM_STAGED_KEY, 'AAAAAAAAAAAAAAAAAAAAAA');
    remember({ draft: '', review: '', name: '', orcid: '', x: '', aiDraft: '', aiReview: '' });
    assert.equal(tab.getItem(FORM_STAGED_KEY), null);
    tab.setItem(FORM_STAGED_KEY, 'AAAAAAAAAAAAAAAAAAAAAA');
    tab.setItem(POSTED_KEY, '1');
    forgetIfPosted();
    assert.equal(tab.getItem(FORM_STAGED_KEY), null);
  });
});

test('a line too long to be read whole is named, for the draft and for the review', () => {
  const long = `- Example paper, PMID 12345678, "${'a long quote '.repeat(170)}"`;
  const d = draftProblems(plainDraft.replace('- Example paper, PMID 12345678, "An example quote."', long));
  assert.match(d[0].text, /longer than 2,000 characters/);
  const r = reviewProblems(plainReview.replace('- The example paper says so.', long));
  assert.match(r[0].text, /longer than 2,000 characters/);
});
