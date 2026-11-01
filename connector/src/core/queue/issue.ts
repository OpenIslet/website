// Builds the public GitHub issue for an IIP (Islet Improvement Proposal), and the bot's first comment.
//
// Everything a contributor sends is untrusted data. Before it goes into the issue:
//   - invisible and direction-changing characters are removed (they can hide text or make it read in another order),
//   - "@name" is defanged with a zero-width space, so nobody is notified because a draft mentions them,
//   - anything that looks like our hidden marker is removed, so a draft cannot pose as a bot-made marker,
//   - the tags that open and close the <details> blocks are escaped, so a draft cannot close them early.
// The one real @mention is the verified GitHub login of the person who signed in.
import { clip } from '../text';
import { hmacHex, sha256Hex } from './crypto';
import type { Contributor, Via } from './types';
import type { DraftReport } from '../draft';
import { checkTables } from '../draft';

export const ZWSP = '\u200b';
/** GitHub rejects an issue body longer than 65,536 characters; stay clear of the edge. */
export const BODY_LIMIT = 64_000;
export const TITLE_PREFIX = '[IIP] ';
export const TITLE_MAX = 120;
export const CHECKS_HEADING = '## Automatic checks';
export const MARKER_NAME = 'openislet:submission';

// ---------------------------------------------------------------------------------------------------------------
// Cleaning contributor text
// ---------------------------------------------------------------------------------------------------------------

/** Control characters, zero-width and direction-changing characters, and Unicode "tag" characters. Tabs and newlines stay. */
export function stripInvisible(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u2028\u2029]/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u061c\u200b\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g, '')
    .replace(/[\u{E0000}-\u{E007F}]/gu, '');
}

/** "@name" becomes "@" + a zero-width space + "name": it still reads the same but notifies nobody. An "@" written as an HTML
 *  entity (&#64;, &#x40;, &commat;) is treated the same way, since GitHub decodes it before it looks for mentions. */
export function defangMentions(text: string): string {
  return text.replace(/(?:@|&#0*64;|&#x0*40;|&commat;)(?=[A-Za-z0-9_])/gi, `@${ZWSP}`);
}

/** "&#118;" and the like are shown as written. GitHub would decode them, and "@&#118;ictim" or "owner/repo&#35;12" would turn into
 *  a mention or a reference after every other rule here had passed them. Ordinary "&" (AT&T, R&D) is left alone. Runs first, before
 *  anything below adds codes of its own. */
export function neutraliseEntities(text: string): string {
  return text.replace(/&(?=#\d{1,8};|#x[0-9a-f]{1,8};|[a-z][a-z0-9]{1,31};)/gi, '&amp;');
}

/** "owner/repo#12" and links to GitHub issues or pull requests would put "mentioned this issue" on someone else's repository.
 *  A zero-width space keeps them readable but inert. */
export function defangCrossReferences(text: string): string {
  return text
    .replace(/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(?=\d)/g, `$1#${ZWSP}`)
    .replace(/https?:\/\/(?:www\.)?github\.com\/[^\s/]+\/[^\s/]+\/(?:issues|pull|discussions)\//gi, (m) => m.replace('://', `://${ZWSP}`));
}

/** An HTML comment the draft opens and never closes would hide everything after it, the blind review included; an unclosed code
 *  fence would turn it into code. So "<!--" is shown as text, and a fence left open is closed at the end of the block. */
export function closeOpenings(text: string): string {
  const shown = text.replace(/<!--/g, '&lt;!--');
  let open: string | null = null;
  for (const line of shown.split('\n')) {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!m) continue;
    const [, fence, rest] = m;
    // As GitHub reads it: after a backtick fence, the rest of the line cannot hold a backtick, or it is not a fence at all.
    if (!open) {
      if (!(fence[0] === '`' && rest.includes('`'))) open = fence;
    } else if (fence[0] === open[0] && fence.length >= open.length && rest.trim() === '') open = null;
  }
  return open ? `${shown}\n${open}` : shown;
}

/** Anything shaped like our marker is taken out, wherever it is and however it is spaced. */
export function removeMarkers(text: string): string {
  return text.replace(/<!--\s*openislet:submission/gi, '[removed: text that looked like an OpenIslet marker]').replace(/openislet:submission/gi, 'openislet-submission');
}

/** Stops a draft from opening or closing the <details> and <summary> blocks that hold it. */
export function neutraliseDetails(text: string): string {
  return text.replace(/<(\s*\/?\s*)(details|summary)\b/gi, '&lt;$1$2');
}

/** A whole file (the draft or the review), ready to sit inside a <details> block. */
export function cleanBlock(text: string): string {
  return closeOpenings(defangCrossReferences(defangMentions(neutraliseDetails(removeMarkers(neutraliseEntities(stripInvisible(text))))))).trim();
}

/**
 * One short line of contributor text, shown as typed: Markdown characters are escaped, and a web address is broken with a
 * zero-width space so it does not turn into a link (a name or a tool list is not the place for one).
 */
export function cleanInline(text: string, max = 200): string {
  const flat = defangCrossReferences(defangMentions(removeMarkers(stripInvisible(text))))
    .replace(/\s+/g, ' ')
    .replace(/\b(https?:\/\/|www\.)/gi, (m) => `${m}${ZWSP}`)
    .trim();
  return clip(flat.replace(/[\\`*_[\]<>&|~]/g, (c) => `\\${c}`), max);
}

/** The issue title: plain text, no Markdown escapes. */
export function cleanTitle(text: string | null): string {
  const flat = defangCrossReferences(defangMentions(removeMarkers(stripInvisible(text ?? '')))).replace(/\s+/g, ' ').trim() || 'Untitled IIP';
  return clip(`${TITLE_PREFIX}${flat}`, TITLE_MAX);
}

/** A table cell: one line, no raw HTML, and no mention or reference, since the checks quote the contributor's words. (The table
 *  writer escapes the pipes.) */
export function cleanCell(text: string): string {
  return defangCrossReferences(defangMentions(removeMarkers(neutraliseEntities(stripInvisible(text)))))
    .replace(/\s+/g, ' ')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .trim();
}

/** JSON that is safe to place inside an HTML comment: no "<", ">" or "&" can appear, so "-->" can never occur. */
export function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** The public id of a submission: IIP- and the GitHub issue number padded to four digits, so IIP-0042 is issue 42. */
export const recordId = (issueNumber: number): string => `IIP-${String(issueNumber).padStart(4, '0')}`;

// ---------------------------------------------------------------------------------------------------------------
// The hidden marker
// ---------------------------------------------------------------------------------------------------------------

/** The fields the signature covers, in this order. A later job re-signs `JSON.stringify` of these to check `sig`. */
export interface MarkerFields {
  v: 1;
  idempotency_key: string | null;
  claim: string | null;
  pmids: string[];
  via: Via;
  /**
   * SHA-256 (hex) of all the issue text above the marker: the name of the person who signed in, the draft, the review and the rest.
   * It is inside the signature, so a marker copied onto other text, or an issue edited after it was posted, stops verifying.
   */
  body_sha256: string;
}

export const markerFields = (f: { idempotencyKey: string | null; claim: string | null; pmids: string[]; via: Via }, bodySha256: string): MarkerFields => ({
  v: 1,
  idempotency_key: f.idempotencyKey ? clip(stripInvisible(f.idempotencyKey), 100) : null,
  claim: f.claim ? clip(stripInvisible(f.claim), 300) : null,
  pmids: [...new Set(f.pmids)].slice(0, 40),
  via: f.via,
  body_sha256: bodySha256,
});

/** The issue text as it is fingerprinted: line endings made plain and the end trimmed, so a harmless change by an editor cannot break it. */
export const canonicalBody = (text: string): string => text.replace(/\r\n?/g, '\n').trimEnd();

/** The fingerprint of the text above the marker. scripts/verify-marker.mjs works it out the same way from the issue it is given. */
export const bodyDigest = (text: string): Promise<string> => sha256Hex(canonicalBody(text));

export async function signMarker(fields: MarkerFields, signingKey: string): Promise<string> {
  return hmacHex(signingKey, JSON.stringify(fields));
}

export function markerLine(fields: MarkerFields, sig: string): string {
  return `<!-- ${MARKER_NAME} ${safeJson({ ...fields, sig })} -->`;
}

// ---------------------------------------------------------------------------------------------------------------
// The issue
// ---------------------------------------------------------------------------------------------------------------

export interface IssueContent {
  login: string;
  via: Via;
  contributor: Contributor;
  /** What the contributor says they used; empty when they did not say. */
  aiTools: { draft: string; review: string };
  writtenAgainst: string;
  draft: string;
  review: string;
  claim: string | null;
  pmids: string[];
  idempotencyKey: string | null;
  /** The wet-lab readouts that passed their checks, if the IIP came with any. */
  wetlab?: Record<string, unknown> | null;
}

/** The line about the contributor's own words. Every part is plain text they typed. */
export function statedLine(c: Contributor): string | null {
  const parts: string[] = [];
  if (c.name) parts.push(`name ${cleanInline(c.name, 160)}`);
  if (c.orcid) parts.push(`ORCID [${c.orcid}](https://orcid.org/${c.orcid})`);
  // Not "@handle": that would mention a GitHub user who happens to share the name.
  if (c.x) parts.push(`X [x.com/${c.x}](https://x.com/${c.x})`);
  return parts.length ? `Stated by the contributor, not verified: ${parts.join(', ')}` : null;
}

function wetlabBlock(wetlab: Record<string, unknown>): string[] {
  return [
    '<details>',
    '<summary>Wet-lab readouts (self-reported; they passed the endpoint checks)</summary>',
    '',
    '```json',
    neutraliseDetails(JSON.stringify(wetlab, null, 2)),
    '```',
    '',
    '</details>',
  ];
}

/** Everything in the issue above the hidden marker. */
export function issueText(i: IssueContent): string {
  const stated = statedLine(i.contributor);
  const lines = [
    `Submitted by @${i.login} (verified through GitHub)`,
    '',
    ...(stated ? [stated, ''] : []),
    `AI tools (self-reported): draft = ${i.aiTools.draft ? cleanInline(i.aiTools.draft) : 'not stated'}, review = ${i.aiTools.review ? cleanInline(i.aiTools.review) : 'not stated'}`,
    '',
    `Written against: ${cleanInline(i.writtenAgainst, 120)}`,
    '',
    'Consent: published openly under CC BY 4.0',
    '',
    '<details open>',
    '<summary>Draft</summary>',
    '',
    cleanBlock(i.draft),
    '',
    '</details>',
    '',
    '<details>',
    '<summary>Blind review</summary>',
    '',
    cleanBlock(i.review),
    '',
    '</details>',
    '',
    ...(i.wetlab ? [...wetlabBlock(i.wetlab), ''] : []),
  ];
  return lines.join('\n');
}

/** The whole body: the text, then the signed marker on its own last line. */
export async function buildIssueBody(i: IssueContent, signingKey: string): Promise<string> {
  const text = issueText(i);
  const fields = markerFields(i, await bodyDigest(text));
  return `${text}\n${markerLine(fields, await signMarker(fields, signingKey))}`;
}

/** How long the body would be, without signing (the digest and the signature have fixed lengths). Used to refuse an IIP that cannot fit. */
export function estimateBodyLength(i: Omit<IssueContent, 'login'>): number {
  const content = { ...i, login: 'x'.repeat(39) };
  const placeholder = '0'.repeat(64);
  return issueText(content).length + 1 + markerLine(markerFields(content, placeholder), placeholder).length;
}

/** The labels on the new issue: what check_draft reports, plus the queue label. GitHub creates labels that do not exist yet. */
export function issueLabels(report: Pick<DraftReport, 'labels'>): string[] {
  return [...new Set([...report.labels, 'status:queued'])].filter((l) => l.length > 0 && l.length <= 50);
}

/** The bot's first comment: the same two tables check_draft shows, under a fixed heading. */
export function checksComment(report: Pick<DraftReport, 'door' | 'checks'>): string {
  const tables = checkTables(report, cleanCell);
  return [
    CHECKS_HEADING,
    '',
    'Software ran these checks the moment the Islet Improvement Proposal (IIP) was sent. They look at the format, the Idea Graveyard rules, and whether quotes match the studies OpenIslet already holds. They do not look papers up on PubMed or judge the science: a person does that in the weekend review, with the rest of the week\'s IIPs, and posts the decision on this issue. These checks are advice for that person, not a decision.',
    '',
    '### The basic rules',
    '',
    tables.door.trimEnd(),
    '',
    '### The other checks',
    '',
    tables.checks.trimEnd(),
    '',
  ].join('\n');
}
