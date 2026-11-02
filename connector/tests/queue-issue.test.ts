// The public issue: what goes in it, and what is done to a contributor's text before it does.
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/answer';
import { runChecks } from '../src/core/draft';
import { hmacHex } from '../src/core/queue/crypto';
import {
  BODY_LIMIT,
  CHECKS_HEADING,
  MARKER_NAME,
  TITLE_MAX,
  ZWSP,
  buildIssueBody,
  checksComment,
  cleanBlock,
  cleanInline,
  cleanTitle,
  defangMentions,
  estimateBodyLength,
  issueLabels,
  neutraliseDetails,
  recordId,
  removeMarkers,
  safeJson,
  stripInvisible, defangCrossReferences, closeOpenings,
} from '../src/core/queue/issue';
import { makeDraft, makeReview, shownQuote } from './fixtures';
import { bundle } from './helpers';
import { SIGNING_KEY } from './queue-fakes';

const KEY = SIGNING_KEY;
const base = {
  login: 'octo-cat',
  via: 'web_form' as const,
  contributor: {},
  aiTools: { draft: 'Example model (High Effort)', review: 'Other model (Max Effort)' },
  writtenAgainst: 'islet-1-draft (blueprint release v0.9.0)',
  draft: '# A title\n\nSome words.',
  review: '# Review: A title\n\n**Verdict:** Supported',
  claim: 'One sentence.',
  pmids: ['12345678'],
  idempotencyKey: null,
};

/** Reads the marker the way a later job would: the last line, parsed, with its signature checked. */
async function readMarker(body: string, key = KEY) {
  const last = body.trimEnd().split('\n').pop()!;
  const m = new RegExp(`^<!-- ${MARKER_NAME} (\\{.*\\}) -->$`).exec(last);
  if (!m) return null;
  const { sig, ...rest } = JSON.parse(m[1]);
  return { fields: rest, sig, valid: sig === (await hmacHex(key, JSON.stringify(rest))) };
}

describe('cleaning contributor text', () => {
  it('takes out invisible and direction-changing characters, and tag characters', () => {
    const sneaky = ['a', String.fromCharCode(0x200b), 'b', String.fromCharCode(0x202e), 'c', String.fromCharCode(0xfeff), 'd', String.fromCharCode(0), 'e', String.fromCodePoint(0xe0041), 'f'].join('');
    expect(stripInvisible(sneaky)).toBe('abcdef');
    expect(stripInvisible('line one\r\nline two\tTabbed')).toBe('line one\nline two\tTabbed');
  });

  it('defangs @mentions with a zero-width space and leaves other text alone', () => {
    expect(defangMentions('thanks @octocat and @org/team, mail a@b.org, 5 @ 6')).toBe(`thanks @${ZWSP}octocat and @${ZWSP}org/team, mail a@${ZWSP}b.org, 5 @ 6`);
    expect(defangMentions('see #123 and PR #4')).toBe('see #123 and PR #4');
  });

  it('defangs an @ written as an HTML entity too', () => {
    for (const at of ['&#64;', '&#064;', '&#x40;', '&#X40;', '&commat;']) expect(defangMentions(`hi ${at}octocat`)).toBe(`hi @${ZWSP}octocat`);
  });

  it('breaks cross-references to other repositories but keeps them readable', () => {
    expect(defangCrossReferences('see torvalds/linux#12 and #4')).toBe(`see torvalds/linux#${ZWSP}12 and #4`);
    expect(defangCrossReferences('https://github.com/a/b/issues/7')).toBe(`https://${ZWSP}github.com/a/b/issues/7`);
    expect(defangCrossReferences('https://github.com/a/b and https://pubmed.ncbi.nlm.nih.gov/123/')).toBe('https://github.com/a/b and https://pubmed.ncbi.nlm.nih.gov/123/');
  });

  it('shows "<!--" as text and closes a code fence the draft left open, so nothing after it is hidden', () => {
    expect(closeOpenings('text\n<!--\nmore')).toBe('text\n&lt;!--\nmore');
    expect(closeOpenings('a\n```js\ncode')).toBe('a\n```js\ncode\n```');
    expect(closeOpenings('a\n````\n```\nstill code')).toBe('a\n````\n```\nstill code\n````');
    expect(closeOpenings('a\n```\ncode\n```\nb')).toBe('a\n```\ncode\n```\nb');
    expect(cleanBlock('# Draft\n<!-- hide the review')).not.toContain('<!--');
    // A backtick in the rest of the line means GitHub does not read it as a fence, so nothing is added that would open one.
    expect(closeOpenings('a\n``` invalid`info\nA short snippet.')).toBe('a\n``` invalid`info\nA short snippet.');
    expect(closeOpenings('a\n~~~ tilde`s are fine\ncode')).toBe('a\n~~~ tilde`s are fine\ncode\n~~~');
  });

  it('shows HTML character codes as written, so they cannot spell a mention or a reference after the checks', () => {
    for (const sneaky of ['@&#118;ictim', '&#64;&#118;ictim-two', 'owner/repo&#35;123', '[reference](https://github&#46;com/owner/repo/issues/123)']) {
      const out = cleanBlock(sneaky);
      expect(out, sneaky).not.toMatch(/&(?:#\d+|#x[0-9a-f]+|[a-z]+);(?<!&amp;)/i);
      expect(out, sneaky).toContain('&amp;');
    }
    expect(cleanBlock('AT&T and R&D, 5 & 6')).toBe('AT&T and R&D, 5 & 6');
    expect(cleanBlock('a <details> b')).toContain('&lt;details'); // the cleaner's own codes still work
  });

  it('removes anything shaped like our marker, however it is spaced or cased', () => {
    for (const fake of ['<!-- openislet:submission {"v":1}', '<!--openislet:submission {"v":1}', '<!--\n   OpenIslet:Submission {"v":1}', '<!-- OPENISLET:SUBMISSION']) {
      const cleaned = removeMarkers(`before ${fake} after`);
      expect(cleaned.toLowerCase(), fake).not.toContain('openislet:submission');
      expect(cleaned).toContain('removed');
    }
    expect(removeMarkers('the token openislet:submission alone')).not.toContain('openislet:submission');
  });

  it('escapes the tags that open and close the details blocks', () => {
    const text = 'x </details> y </DETAILS > z < /details> <details open> <summary>s</summary> </ summary>';
    const cleaned = neutraliseDetails(text);
    expect(cleaned).not.toMatch(/<\s*\/?\s*(details|summary)/i);
    expect(cleaned).toContain('&lt;/details>');
  });

  it('cleanInline shows Markdown characters as typed and keeps to one line', () => {
    // (A web address gets a zero-width space after "://", so it does not become a link.)
    expect(cleanInline('Model *X* [link](http://e.org) <b>bold</b> | pipe\nnew line')).toBe(`Model \\*X\\* \\[link\\](http://${ZWSP}e.org) \\<b\\>bold\\</b\\> \\| pipe new line`);
    expect(cleanInline('x'.repeat(500), 50).length).toBeLessThanOrEqual(50);
  });

  it('cleanTitle adds the prefix, defangs mentions and stops at 120 characters', () => {
    expect(cleanTitle('Too little CD47 at hour zero?')).toBe('[IIP] Too little CD47 at hour zero?');
    expect(cleanTitle('Thanks @octocat')).toBe(`[IIP] Thanks @${ZWSP}octocat`);
    expect(cleanTitle('word '.repeat(60)).length).toBeLessThanOrEqual(TITLE_MAX);
    expect(cleanTitle(null)).toBe('[IIP] Untitled IIP');
  });

  it('safeJson never lets a ">" or "<" or "&" through, and reads back the same', () => {
    const value = { claim: 'a --> b <script>alert(1)</script> & c', n: String.fromCharCode(0x2028) };
    const text = safeJson(value);
    expect(text).not.toMatch(/[<>&]/);
    expect(text).not.toContain('-->');
    expect(JSON.parse(text)).toEqual(value);
  });

  it('writes record ids with four digits at least', () => {
    expect(recordId(7)).toBe('IIP-0007');
    expect(recordId(42)).toBe('IIP-0042');
    expect(recordId(12345)).toBe('IIP-12345');
  });
});

describe('the issue body', () => {
  it('has the lines in the order the contract gives, the draft open, the review closed, and the marker last', async () => {
    const body = await buildIssueBody({ ...base, contributor: { name: 'Ada Lovelace', orcid: '0000-0002-1825-0097', x: 'ada_l' }, idempotencyKey: 'key-1' }, KEY);
    const at = (s: string) => {
      const i = body.indexOf(s);
      expect(i, s).toBeGreaterThanOrEqual(0);
      return i;
    };
    const order = [
      at('Submitted by @octo-cat (verified through GitHub)'),
      at('Stated by the contributor, not verified: name Ada Lovelace, ORCID [0000-0002-1825-0097](https://orcid.org/0000-0002-1825-0097), X [x.com/ada_l](https://x.com/ada_l)'),
      at('AI tools (self-reported): draft = Example model (High Effort), review = Other model (Max Effort)'),
      at('Written against: islet-1-draft (blueprint release v0.9.0)'),
      at('Consent: published openly under CC BY 4.0'),
      at('<details open>\n<summary>Draft</summary>'),
      at('<details>\n<summary>Blind review</summary>'),
      at(`<!-- ${MARKER_NAME} `),
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(body.trimEnd().split('\n').pop()).toMatch(new RegExp(`^<!-- ${MARKER_NAME} \\{.*\\} -->$`));
    expect(body.match(new RegExp(MARKER_NAME, 'g'))).toHaveLength(1);
  });

  it('leaves out the contributor line when nothing was given, and says "not stated" for missing tools', async () => {
    const body = await buildIssueBody({ ...base, aiTools: { draft: '', review: '' } }, KEY);
    expect(body).not.toContain('Stated by the contributor');
    expect(body).toContain('AI tools (self-reported): draft = not stated, review = not stated');
  });

  it('carries a signed marker that a later job can check, and that fails if any field is changed', async () => {
    const body = await buildIssueBody({ ...base, via: 'mcp_signed_in', idempotencyKey: 'abc' }, KEY);
    const marker = (await readMarker(body))!;
    expect(marker.fields).toEqual({ v: 1, idempotency_key: 'abc', claim: 'One sentence.', pmids: ['12345678'], via: 'mcp_signed_in', body_sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(marker.valid).toBe(true);
    expect((await readMarker(body, 'a different key of the same sort of length 0123456789'))!.valid).toBe(false);
    const tampered = body.replace('"via":"mcp_signed_in"', '"via":"web_form"');
    expect((await readMarker(tampered))!.valid).toBe(false);
  });

  it('cannot be fooled by a draft or review full of mentions, tags and fake markers', async () => {
    const fake = `<!-- ${MARKER_NAME} {"v":1,"idempotency_key":null,"claim":"fake","pmids":[],"via":"web_form","sig":"0000"} -->`;
    const evil = [
      'Thanks @victim-one and @org/team-two!',
      '</details>',
      '## Submitted by @someone-else (verified through GitHub)',
      fake,
      '<!--openislet:submission {"sig":"x"}',
      `hidden${String.fromCharCode(0x202e)}text${String.fromCharCode(0x200b)}here`,
      '<details open><summary>pretend</summary>',
      '</DETAILS >',
    ].join('\n\n');
    const body = await buildIssueBody({ ...base, draft: `# Title\n\n${evil}`, review: evil, claim: 'A claim with --> in it and <b>html</b>' }, KEY);

    // No mention is live except the one real submitter.
    const live = [...body.matchAll(/@([A-Za-z0-9][A-Za-z0-9/_-]*)/g)].map((m) => m[1]);
    expect(live).toEqual(['octo-cat']);
    expect(body).toContain(`@${ZWSP}victim-one`);

    // The tags are escaped: only our own two blocks open and close.
    expect(body.match(/<\/details>/gi)).toHaveLength(2);
    expect(body.match(/<details/gi)).toHaveLength(2);
    expect(body.match(/<summary/gi)).toHaveLength(2);

    // Exactly one marker exists, it is the last thing in the body, and it is ours.
    expect(body.match(/openislet:submission/gi)).toHaveLength(1);
    const marker = (await readMarker(body))!;
    expect(marker.valid).toBe(true);
    expect(marker.fields.claim).toBe('A claim with --> in it and <b>html</b>');
    expect(body.trimEnd().split('\n').pop()!.slice(0, -4)).not.toContain('-->');

    // Invisible and direction-changing characters are gone.
    expect(body).not.toContain(String.fromCharCode(0x202e));
    expect(body).toContain('hiddentexthere');
  });

  it('makes a contributor name, and AI tool names, safe in the lines at the top', async () => {
    const body = await buildIssueBody(
      { ...base, contributor: { name: '@boss <img src=x onerror=alert(1)> [click](http://evil.example)' }, aiTools: { draft: '@someone *bold* </details>', review: '' } },
      KEY,
    );
    const top = body.split('<details open>')[0];
    // Every "<" is escaped with a backslash, so it shows as a letter and opens no tag.
    expect(top).not.toMatch(/(^|[^\\])</);
    expect(top).not.toContain('](http://evil.example)');
    expect(top).not.toMatch(/https?:\/\/[A-Za-z]/);
    expect(top).toContain(`@${ZWSP}boss`);
    expect([...top.matchAll(/@([A-Za-z0-9_-]+)/g)].map((m) => m[1])).toEqual(['octo-cat']);
  });

  it('shows an X handle as a link, never as a mention', async () => {
    const body = await buildIssueBody({ ...base, contributor: { x: 'jack' } }, KEY);
    expect(body).toContain('X [x.com/jack](https://x.com/jack)');
    expect(body).not.toContain('@jack');
  });

  it('adds the wet-lab readouts as a closed block, before the marker', async () => {
    const body = await buildIssueBody({ ...base, wetlab: { batch_id: 'B-1', obs_cd47_fold: 7.8 } }, KEY);
    expect(body).toContain('Wet-lab readouts');
    expect(body.indexOf('"obs_cd47_fold": 7.8')).toBeLessThan(body.indexOf(`<!-- ${MARKER_NAME}`));
  });

  it('can say how long the body will be before anyone signs in', async () => {
    const { login, ...content } = base;
    void login;
    const estimate = estimateBodyLength(content);
    const real = (await buildIssueBody({ ...base, login: 'x'.repeat(39) }, KEY)).length;
    expect(estimate).toBe(real);
    expect(estimateBodyLength({ ...content, draft: 'a '.repeat(BODY_LIMIT) })).toBeGreaterThan(BODY_LIMIT);
  });
});

describe('labels and the first comment', () => {
  const f = shownQuote();
  const draft = makeDraft({ evidence: [`${f.cite}, PMID ${f.pmid}, "${f.quote}"`], design: 'Design X' });
  const input = { draft, review: makeReview(), consent: true };

  it('labels the issue with what check_draft reports, plus status:queued, once each', async () => {
    const report = await runChecks(bundle(), defaultConfig, input);
    const labels = issueLabels(report);
    expect(labels).toEqual(expect.arrayContaining(['submission', 'status:queued', 'type:problem-found', 'test:3', 'design:x']));
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.every((l) => l.length <= 50)).toBe(true);
  });

  it('starts the checks comment with the fixed heading and shows both tables', async () => {
    const report = await runChecks(bundle(), defaultConfig, input);
    const comment = checksComment(report);
    expect(comment.split('\n')[0]).toBe(CHECKS_HEADING);
    expect(CHECKS_HEADING).toBe('## Automatic checks');
    expect(comment).toContain('### The basic rules');
    expect(comment).toContain('### The other checks');
    for (const row of [...report.door, ...report.checks]) expect(comment).toContain(row.name);
    expect(comment).toMatch(/a person does that in the weekend review/i);
    expect(comment).toMatch(/the moment the Islet Improvement Proposal \(IIP\) was sent/);
    expect(comment).toMatch(/with the rest of the week's IIPs/);
    expect(comment).not.toMatch(/finding/i);
    expect(comment).toMatch(/format, the Idea Graveyard rules, and whether quotes match the studies OpenIslet already holds/);
    expect(comment).toMatch(/do not look papers up on PubMed/);
    expect(comment).not.toMatch(/AI review|spam/i);
  });

  it('defangs contributor words that the check results quote', async () => {
    const report = await runChecks(bundle(), defaultConfig, input);
    report.checks.push({ id: 'x', name: 'Quoted <b>name</b>', status: 'amber', detail: 'It says @victim and <img src=x onerror=1> | and a pipe' });
    const comment = checksComment(report);
    expect(comment).not.toContain('@victim');
    expect(comment).not.toContain('<img');
    expect(comment).not.toContain('<b>');
    expect(comment).toContain('&lt;img');
  });

  it('breaks references and character codes in the check comment too, like the version a contributor says they used', async () => {
    const report = await runChecks(bundle(), defaultConfig, input);
    report.checks.push({ id: 'y', name: 'Version', status: 'amber', detail: 'Written against https://github.com/owner/repo/issues/123, see owner/repo#9 and @&#118;ictim' });
    const comment = checksComment(report);
    expect(comment).not.toContain('https://github.com/owner/repo/issues/123');
    expect(comment).toContain(`owner/repo#${ZWSP}9`);
    expect(comment).toContain('@&amp;#118;ictim');
  });

  it('breaks references in a name and in the title', () => {
    expect(cleanInline('owner/repo#123')).toContain(`#${ZWSP}123`);
    expect(cleanTitle('Fix for owner/repo#123')).toContain(`#${ZWSP}123`);
  });

  it('cleanBlock keeps ordinary Markdown as it is', () => {
    const md = '# Heading\n\n- item one\n- item two with `code` and a [link](https://doi.org/10.1/x)\n\n> a quote\n';
    expect(cleanBlock(md)).toBe(md.trim());
  });
});

describe('cleaning stays quick on very long runs, and gives the same text as before', () => {
  // The two patterns as they were before they were made linear (audit item L3, 2 November 2026).
  const oldDetails = (t: string) => t.replace(/<(\s*\/?\s*)(details|summary)\b/gi, '&lt;$1$2');
  const oldCross = (t: string) => t.replace(/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(?=\d)/g, `$1#${ZWSP}`);

  const samples = [
    '', 'plain text', '<details>', '</details>', '< details >', '</ summary>', '<  /  details', '<DETAILS open>', 'a <summary>b</summary> c',
    '<detailsx>', '<details', 'x<details>y', '<\n/\tsummary', 'see torvalds/linux#12 and #4', 'a/b#1', 'a/b#', 'a.b-c_d/e.f-g_h#99',
    'x y/z#1 w/v#2', '/#1', 'a/#1', '#12', 'owner/repo#12abc', '1/2#3', 'aaa/bbb/ccc#4', 'a//b#5', '-/-#6',
  ];

  it('gives the same text as before for ordinary input', () => {
    for (const s of samples) {
      expect(neutraliseDetails(s), s).toBe(oldDetails(s));
      expect(defangCrossReferences(s), s).toBe(oldCross(s));
    }
  });

  it('gives the same text as before for a few hundred made-up strings', () => {
    // A fixed pseudo-random sequence, so a failure can be reproduced.
    let seed = 20261102;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pieces = ['<', '/', ' ', '\n', 'details', 'summary', 'DETAILS', 'a', 'b', '1', '#', '.', '-', '_', '&', '@'];
    let compared = 0;
    for (let i = 0; i < 400; i++) {
      let s = '';
      for (let n = 1 + Math.floor(next() * 30); n > 0; n--) s += pieces[Math.floor(next() * pieces.length)];
      expect(defangCrossReferences(s), JSON.stringify(s)).toBe(oldCross(s));
      // The new pattern also escapes "<//details" (two slashes), which the old one left alone and which does nothing in GitHub anyway.
      if (!/\/[\s/]*\//.test(s)) {
        expect(neutraliseDetails(s), JSON.stringify(s)).toBe(oldDetails(s));
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(200);
  });

  it('escapes a doubled slash too, which is harmless', () => {
    expect(neutraliseDetails('<//details>')).toBe('&lt;//details>');
  });

  it('does not slow down on a very long run of spaces or name characters', () => {
    const spaces = `<${' '.repeat(30_000)}x`;
    const name = 'a'.repeat(30_000);
    const started = performance.now();
    neutraliseDetails(spaces);
    defangCrossReferences(name);
    cleanBlock(spaces + name);
    // Each of these took a third of a second or more before; now a few milliseconds. The limit leaves room for a slow machine.
    expect(performance.now() - started).toBeLessThan(250);
  });
});
