// What people actually paste: the AI's whole reply, the file copied as formatted text, headings at another level, a verdict not in
// bold, the fresh-chat prompt instead of the review, the two files in each other's boxes. The form and the connector read all of these
// with the same code (src/core/template.ts), so they never disagree.
import { describe, expect, it } from 'vitest';
import { TEMPLATE, cleanPaste, looksLike, parseDoc, templateGaps, verdictOf } from '../src/core/template';
import { bundle } from './helpers';
import { defaultConfig } from '../src/core/answer';
import { runChecks } from '../src/core/draft';
import { makeDraft, makeReview, shownQuote } from './fixtures';
import { reviewTemplate } from '../../src/data/prompts';

const f = shownQuote();
const draft = makeDraft({ evidence: [`${f.cite}, PMID ${f.pmid}, "${f.quote}"`] });
const review = makeReview();
const freshPrompt = reviewTemplate.replace('[CLAIM]', 'The B2M promoter may give too little CD47 on resting beta cells in the first hours after transplant.');

/** The file copied out of a chat as formatted text: the # and ** marks and the list dashes are gone. */
const rendered = (md: string) =>
  md
    .split('\n')
    .map((l) => l.replace(/^#{1,6}\s+/, '').replace(/\*\*/g, '').replace(/^- /, ''))
    .join('\n');

const ready = async (d: string, r: string) => (await runChecks(bundle(), defaultConfig, { draft: d, review: r, consent: true })).ready;
const gaps = (text: string, kind: 'draft' | 'review') => templateGaps(parseDoc(cleanPaste(text, kind).text), TEMPLATE[kind], kind);

describe('the template the form and the connector share', () => {
  it('is the same as the structure the bundle derives from the prompts', async () => {
    const structure = await bundle().structure();
    for (const kind of ['draft', 'review'] as const) {
      expect(TEMPLATE[kind].fields.map((x) => x.name)).toEqual(structure[kind].fields.map((x: { name: string }) => x.name));
      expect(TEMPLATE[kind].headings).toEqual(structure[kind].headings);
    }
    expect(TEMPLATE.draft.fields[0].options).toEqual(structure.draft.fields[0].options);
  });
});

describe('a clean file', () => {
  it('is left exactly as it is, and cleaning twice changes nothing', () => {
    for (const [text, kind] of [[draft, 'draft'], [review, 'review']] as const) {
      const once = cleanPaste(text, kind);
      expect(once.changed).toBe(false);
      expect(once.text).toBe(text);
      expect(cleanPaste(once.text, kind).text).toBe(once.text);
    }
  });
});

describe('the AI’s whole reply', () => {
  const step3 = `Here's your Islet Improvement Proposal. I've saved it as openislet-iip-cd47.md.\n\n\`\`\`markdown\n${draft}\n\`\`\`\n\n**FRESH-CHAT PROMPT**\n\n\`\`\`\n${freshPrompt}\n\`\`\`\n\nWould you like me to tighten anything?`;
  const step4 = `I've reviewed the claim. Here it is:\n\n\`\`\`markdown\n${review}\n\`\`\`\n\nLet me know if you'd like more detail.`;

  it('in the draft box keeps just the draft, not the longer fresh-chat prompt', async () => {
    const c = cleanPaste(step3, 'draft');
    expect(c.text).toBe(draft);
    expect(c.picked).toBe(true);
    expect(await ready(step3, review)).toBe(true);
  });
  it('counts as a draft, although it also holds the reviewer prompt', () => {
    expect(looksLike(step3)).toBe('draft');
  });
  it('in the review box keeps just the review', async () => {
    expect(cleanPaste(step4, 'review').text).toBe(review);
    expect(await ready(draft, step4)).toBe(true);
  });
  it('without code blocks drops the words before and after the file', () => {
    const c = cleanPaste(`Sure! Here is the draft:\n\n${draft}\n\nWould you like me to change the title?`, 'draft');
    expect(c.text).toBe(draft);
    expect(c.trimmed).toBe(true);
  });
  it('keeps a person’s own last lines when there was nothing before the file', () => {
    expect(cleanPaste(`${draft}\n\nA note I added myself.`, 'draft').text).toContain('A note I added myself.');
  });
  it('handles ~~~ and four-backtick fences and Windows line ends', async () => {
    expect(cleanPaste(`~~~markdown\r\n${draft.replace(/\n/g, '\r\n')}\r\n~~~`, 'draft').text).toBe(draft);
    expect(cleanPaste(`\`\`\`\`markdown\n${draft}\n\`\`\`\``, 'draft').text).toBe(draft);
  });
});

describe('the file copied as formatted text', () => {
  it('gets its marks back, word for word, and passes', async () => {
    const d = cleanPaste(rendered(draft), 'draft');
    const r = cleanPaste(rendered(review), 'review');
    expect(d.rebuilt).toBe(true);
    expect(gaps(rendered(draft), 'draft')).toEqual([]);
    expect(gaps(rendered(review), 'review')).toEqual([]);
    expect(d.text).toContain('**Claim in one sentence:** The B2M promoter');
    expect(d.text).toContain('## Evidence');
    expect(r.text.startsWith('# Review: ')).toBe(true);
    expect(verdictOf(parseDoc(r.text).fields.get('verdict'))).toBe('Partly supported');
    expect(await ready(rendered(draft), rendered(review))).toBe(true);
  });
});

describe('the ways AIs write the template', () => {
  it('### headings, bold headings and a colon after the bold label', async () => {
    const d = draft.replace(/^## (.*)$/gm, '### $1').replace('**Type:**', '**Type**:');
    expect(await ready(d, review)).toBe(true);
    expect(await ready(draft.replace(/^## (.*)$/gm, '**$1**'), review)).toBe(true);
  });
  it('a verdict that is not in bold, or bold only on the answer', async () => {
    expect(await ready(draft, review.replace('**Verdict:** Partly supported', 'Verdict: Partly supported'))).toBe(true);
    expect(await ready(draft, review.replace('**Verdict:** Partly supported', 'Verdict: **Partly supported**'))).toBe(true);
    expect(await ready(draft, review.replace('**Verdict:** Partly supported', '- **Verdict:**\nPartly supported'))).toBe(true);
  });
  it('never reads "Typed…" or "In plain English, …" as a labelled line', () => {
    const c = cleanPaste(`${draft}\nIn plain English, this changes nothing.`, 'draft');
    expect(c.text.endsWith('In plain English, this changes nothing.')).toBe(true);
  });
  it('still refuses a review that does not support the IIP, however it is written', async () => {
    expect(await ready(draft, rendered(review.replace('Partly supported', 'Not supported')))).toBe(false);
  });
  it('still refuses an incomplete draft, and names what is missing', () => {
    const missing = gaps(rendered(makeDraft({ omit: ['claim'] })), 'draft');
    expect(missing).toContain('"Claim in one sentence"');
  });
});

describe('telling what a paste is', () => {
  it('knows a draft, a review, and the reviewer prompt for the fresh chat', () => {
    expect(looksLike(draft)).toBe('draft');
    expect(looksLike(rendered(draft))).toBe('draft');
    expect(looksLike(review)).toBe('review');
    expect(looksLike(rendered(review))).toBe('review');
    expect(looksLike(freshPrompt)).toBe('review-prompt');
    expect(looksLike('Hello, can you help me?')).toBe('unknown');
  });
  it('reads the review out of a whole fresh chat (the prompt, then the AI’s review)', () => {
    const chat = `${freshPrompt}\n\n${review}`;
    expect(looksLike(chat)).toBe('review');
    expect(cleanPaste(chat, 'review').text).toBe(review);
  });
});

describe('a key or password pasted outside the file', () => {
  it('still stops the submission, although the file itself is clean', async () => {
    const r = await runChecks(bundle(), defaultConfig, { draft: `ghp_${'a'.repeat(36)}\n\n\`\`\`\n${draft}\n\`\`\``, review, consent: true });
    expect(r.door.find((d) => d.id === 'no_secrets')?.status).toBe('fail');
  });
});
