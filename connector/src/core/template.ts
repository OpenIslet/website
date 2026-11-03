// Reading a draft or a blind review the way people actually paste them. Shared by the connector (check_draft, submit_proposal and
// the queue) and the website's submission form (src/scripts/submit.ts), so the form never says "looks right" about a file the
// server would refuse, and the other way round.
//
// People copy what their AI gave them. That is often the whole reply ("Here's your draft:", the file in a code block, a second code
// block with the prompt for the fresh chat, "Would you like me to…"), or the file copied as formatted text, which loses the # and **
// marks. cleanPaste finds the file in all of that and gives it back in the template's own Markdown, so the checks, the saved copy and
// the public issue all see the same tidy file. It adds marks and drops chatter around the file; it never changes the words inside it.
//
// Everything here is linear in the length of the text (no backtracking patterns), because check_draft is open to anyone.
import { clip, normalise } from './text';

export type Kind = 'draft' | 'review';

export interface FieldSpec {
  name: string;
  options?: string[] | null;
}
export interface TemplateSpec {
  fields: FieldSpec[];
  headings: string[];
}

/**
 * The lines and sections each template asks for, as the prompts in src/data/prompts.ts write them. The connector's bundle derives
 * the same lists from those prompts (prompts/structure.json); a test keeps the two equal.
 */
export const TEMPLATE: Record<Kind, TemplateSpec> = {
  draft: {
    fields: [
      { name: 'Type', options: ['Problem found', 'Improvement', 'Missing evidence'] },
      { name: 'Claim in one sentence' },
      { name: 'In plain English' },
      { name: 'Affects test' },
      { name: 'Affects design' },
    ],
    headings: ['Evidence', 'What I propose changing', 'How this could be wrong', 'Cheapest way to check it', 'AI tools used'],
  },
  review: {
    fields: [
      { name: 'Claim reviewed' },
      { name: 'Verdict', options: ['Supported', 'Partly supported', 'Not supported', 'Cannot tell'] },
      { name: 'Confidence', options: ['Low', 'Medium', 'High'] },
      { name: 'Submit to OpenIslet?' },
      { name: 'In plain English' },
    ],
    headings: ['What I checked', 'Evidence for', 'Evidence against', 'Idea Graveyard check', 'Other ways it could fail', 'Cheapest way to settle it', 'AI tools used'],
  },
};

export const keyOf = (s: string): string => s.toLowerCase().replace(/[*_`:?]/g, '').replace(/\s+/g, ' ').trim();

/** A value still in the template's square brackets ("[Short title]") has not been filled in. */
export const placeholder = (v: string | undefined): boolean => !v || !v.trim() || /^\[[^\]]*\]$/.test(v.trim());

// Lines longer than this are cut before they are read, so a hostile file cannot tie up the server.
const MAX_LINE = 2000;

// ---------------------------------------------------------------------------------------------------------------
// Code blocks
// ---------------------------------------------------------------------------------------------------------------

interface Block {
  body: string;
}

/** The fenced code blocks in a text (``` or ~~~, three or more, closed by the same mark at least as long). An unclosed block runs to the end. */
function fencedBlocks(lines: string[]): Block[] {
  const out: Block[] = [];
  let open: { ch: string; len: number } | null = null;
  let buf: string[] = [];
  for (const line of lines) {
    const t = line.trimStart();
    const lead = line.length - t.length;
    const ch = t[0];
    let run = 0;
    if (lead <= 3 && (ch === '`' || ch === '~')) while (t[run] === ch) run++;
    if (!open) {
      if (run >= 3) {
        open = { ch, len: run };
        buf = [];
      }
      continue;
    }
    if (run >= open.len && ch === open.ch && t.slice(run).trim() === '') {
      out.push({ body: buf.join('\n') });
      open = null;
      continue;
    }
    buf.push(line);
  }
  if (open && buf.length) out.push({ body: buf.join('\n') });
  return out;
}

/** The old rule, kept for texts that hold one code block and little else: take what is inside it. */
export function unfence(src: string): string {
  const text = src.replace(/\r\n?/g, '\n').trim();
  const blocks = fencedBlocks(text.split('\n')).map((b) => b.body);
  if (!blocks.length) return text;
  const biggest = blocks.reduce((a, b) => (b.length > a.length ? b : a));
  return biggest.length >= text.length * 0.5 ? biggest.trim() : text;
}

// ---------------------------------------------------------------------------------------------------------------
// Recognising the template's lines however they were written
// ---------------------------------------------------------------------------------------------------------------

/** A line without its list mark ("- ", "* ", "• "), and without bold marks round its start. */
function bare(line: string): string {
  let s = line.slice(0, MAX_LINE).trim();
  if (/^[-*+•]\s/.test(s)) s = s.slice(2).trimStart();
  return s;
}

/** If the line is one of the template's labelled lines ("**Type:** x", "Type: x", "- **Type**: x", "Verdict: **x**"), its name and value. */
export function fieldLine(line: string, spec: TemplateSpec): { name: string; value: string } | null {
  const s = bare(line);
  const plain = s.replace(/^\*\*/, '');
  const lower = plain.toLowerCase();
  for (const f of spec.fields) {
    const label = f.name.replace(/\?$/, '').toLowerCase();
    if (!lower.startsWith(label)) continue;
    let rest = plain.slice(label.length);
    // after the label: optional "?", optional closing "**", then ":" (or the "?" itself for "Submit to OpenIslet?")
    let asked = false;
    if (rest.startsWith('?')) {
      asked = true;
      rest = rest.slice(1);
    }
    rest = rest.replace(/^\*\*/, '');
    if (rest.startsWith(':')) rest = rest.slice(1);
    else if (!(asked && f.name.endsWith('?'))) continue;
    rest = rest.replace(/^\s*\*\*(?=\s|$)/, '');
    return { name: f.name, value: rest.trim() };
  }
  return null;
}

/** If the line is one of the template's section headings, at any level, in bold, or as plain text, its proper name. */
export function headingLine(line: string, spec: TemplateSpec): string | null {
  let s = line.slice(0, MAX_LINE).trim();
  while (s.startsWith('#')) s = s.slice(1);
  s = s.trim().replace(/^\*\*/, '').replace(/\*\*$/, '').replace(/:$/, '').trim();
  if (!s || s.length > 60) return null;
  const k = keyOf(s);
  return spec.headings.find((h) => keyOf(h) === k) ?? null;
}

/** How many of the template's own lines and sections a text holds: how much it looks like a draft, or like a review. */
function score(text: string, spec: TemplateSpec): number {
  const seen = new Set<string>();
  for (const line of text.split('\n')) {
    const f = fieldLine(line, spec);
    if (f && !placeholder(f.value)) seen.add(`f:${f.name}`);
    const h = headingLine(line, spec);
    if (h) seen.add(`h:${h}`);
  }
  return seen.size;
}

/** The reviewer prompt itself (what goes into the fresh chat), as opposed to the review it produces. */
export function isReviewPrompt(text: string): boolean {
  const n = normalise(text.slice(0, 60000));
  return n.includes('claim to test') && n.includes('how to review');
}

// ---------------------------------------------------------------------------------------------------------------
// Finding the file in what was pasted, and putting its marks back
// ---------------------------------------------------------------------------------------------------------------

export interface Cleaned {
  text: string;
  /** False when the paste was already the file, written the way the template asks. */
  changed: boolean;
  /** What was done: picked one code block out of several, trimmed words around the file, put back missing # and ** marks. */
  picked: boolean;
  trimmed: boolean;
  rebuilt: boolean;
}

/** The file inside a paste: the right code block, or the text from the file's title on, without the AI's words around it. */
function findDocument(text: string, kind: Kind): { doc: string; picked: boolean; trimmed: boolean } {
  const spec = TEMPLATE[kind];
  const lines = text.split('\n');
  const blocks = fencedBlocks(lines);
  if (blocks.length) {
    let best: { body: string; s: number } | null = null;
    for (const b of blocks) {
      if (isReviewPrompt(b.body)) continue;
      const s = score(b.body, spec);
      if (!best || s > best.s) best = { body: b.body, s };
    }
    if (best && best.s >= 3) return { doc: best.body.trim(), picked: true, trimmed: false };
    const old = unfence(text);
    if (old !== text) return { doc: old, picked: true, trimmed: false };
  }

  // No usable code block. Start at the file's first filled-in line (skipping the template's own lines, which a pasted prompt
  // would hold), taking the title just above it; stop after the file's last section.
  let first = -1;
  for (let i = 0; i < lines.length; i++) {
    const f = fieldLine(lines[i], spec);
    if (!f) continue;
    const value = f.value || (lines[i + 1] ?? '').trim();
    if (!placeholder(value)) {
      first = i;
      break;
    }
  }
  if (first < 0) return { doc: text, picked: false, trimmed: false };
  let start = first;
  for (let i = first - 1; i >= 0 && i >= first - 3; i--) {
    const t = lines[i].trim();
    if (!t) continue;
    if (!fieldLine(lines[i], spec) && !headingLine(lines[i], spec)) start = i;
    break;
  }
  // The file ends with its last section: in a whole reply (the AI's words came before the file), a blank line after the "AI tools
  // used" section and words that are not part of the template are the AI talking again ("Would you like me to…").
  let end = lines.length;
  const lastHeading = spec.headings[spec.headings.length - 1];
  const wordsBefore = lines.slice(0, start).some((l) => l.trim());
  for (let i = start; wordsBefore && i < lines.length; i++) {
    if (headingLine(lines[i], spec) !== lastHeading) continue;
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    while (j < lines.length && lines[j].trim()) j++;
    const after = lines.slice(j).join('\n');
    if (after.trim() && score(after, spec) === 0) end = j;
    break;
  }
  const trimmed = lines.slice(0, start).some((l) => l.trim()) || end < lines.length;
  return { doc: lines.slice(start, end).join('\n').trim(), picked: false, trimmed };
}

/** The file with the template's marks: a "# " title, "**Name:**" lines and "## " sections. Words are left as they are. */
function restoreMarks(doc: string, kind: Kind): { text: string; rebuilt: boolean } {
  const spec = TEMPLATE[kind];
  const lines = doc.split('\n');
  const hasTitle = lines.some((l) => /^#\s+\S/.test(l));
  const out: string[] = [];
  let inSections = false;
  let seenField = false;
  let titled = hasTitle;
  for (const line of lines) {
    const h = headingLine(line, spec);
    if (h && !/^#\s/.test(line.trim())) {
      out.push(`## ${h}`);
      inSections = true;
      continue;
    }
    if (!inSections) {
      const f = fieldLine(line, spec);
      if (f) {
        out.push(`**${f.name}${f.name.endsWith('?') ? '' : ':'}**${f.value ? ` ${f.value}` : ''}`);
        seenField = true;
        continue;
      }
      // Only a line above the first labelled line can be the title, never a second line of a labelled value.
      if (!titled && !seenField && line.trim()) {
        out.push(`# ${line.trim().replace(/^#+\s*/, '').replace(/^\*\*(.*)\*\*$/, '$1').trim()}`);
        titled = true;
        continue;
      }
    }
    out.push(line);
  }
  const text = out.join('\n').trim();
  return { text, rebuilt: text !== doc.trim() };
}

/** What a person pasted as a draft (or a review), turned into the file itself, in the template's Markdown. */
export function cleanPaste(raw: string, kind: Kind): Cleaned {
  const text = (raw ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
  if (!text) return { text: '', changed: false, picked: false, trimmed: false, rebuilt: false };
  const found = findDocument(text, kind);
  const restored = restoreMarks(found.doc, kind);
  return { text: restored.text, changed: restored.text !== text, picked: found.picked, trimmed: found.trimmed, rebuilt: restored.rebuilt };
}

/** What a paste looks like: a draft, a review, the reviewer prompt for the fresh chat, or none of these. */
export function looksLike(raw: string): Kind | 'review-prompt' | 'unknown' {
  const text = (raw ?? '').replace(/\r\n?/g, '\n');
  if (!text.trim()) return 'unknown';
  const d = score(cleanPaste(text, 'draft').text, TEMPLATE.draft);
  const reviewText = cleanPaste(text, 'review').text;
  const r = score(reviewText, TEMPLATE.review);
  const verdict = verdictOf(parseDoc(reviewText).fields.get('verdict'));
  // A filled-in review, then a draft (a whole step-3 reply holds the draft and the reviewer prompt: it is the draft), and only
  // then the reviewer prompt on its own. The prompt's own template lines are headings with empty fields, so they never make a review.
  if (verdict && r >= 4 && r > d) return 'review';
  if (d >= 4 && d >= r) return 'draft';
  if (isReviewPrompt(text)) return 'review-prompt';
  if (r >= 4 && r > d) return 'review';
  return 'unknown';
}

// ---------------------------------------------------------------------------------------------------------------
// Reading the file
// ---------------------------------------------------------------------------------------------------------------

export interface Parsed {
  title: string | null;
  parseIssues: string[];
  fields: Map<string, string>;
  sections: Map<string, string>;
}

/** "**Type:** Problem found" or "- **Type**: Problem found", read by position. */
function fieldOf(line: string): { label: string; rest: string } | null {
  let s = line.trimStart();
  if (s.startsWith('- ') || s.startsWith('* ') || s.startsWith('+ ')) s = s.slice(2).trimStart();
  if (!s.startsWith('**')) return null;
  const close = s.indexOf('**', 3);
  if (close < 0) return null;
  const label = s.slice(2, close).trim();
  if (!label) return null;
  let rest = s.slice(close + 2).trimStart();
  if (rest.startsWith(':')) rest = rest.slice(1).trimStart();
  return { label, rest };
}

/** "## Evidence" gives "Evidence". A third # is not a second-level heading. */
function headingOf(line: string, level: 1 | 2): string | null {
  const marks = '#'.repeat(level);
  if (!line.startsWith(marks) || line[level] === '#' || !/\s/.test(line[level] ?? '')) return null;
  let text = line.slice(level).trim();
  while (text.endsWith('#')) text = text.slice(0, -1).trimEnd();
  return text || null;
}

/** The title, the labelled lines and the sections of a file written in the template's Markdown. */
export function parseDoc(raw: string): Parsed {
  const inputLines = unfence(raw).split('\n');
  const parseIssues: string[] = inputLines.some((l) => l.length > MAX_LINE) ? ['a line exceeds the parser limit'] : [];
  const lines = inputLines.map((l) => l.slice(0, MAX_LINE));
  const fields = new Map<string, string>();
  const sections = new Map<string, string>();
  let title: string | null = null;
  let section: string | null = null;
  let buffer: string[] = [];
  const flush = () => {
    if (section !== null) {
      if (sections.has(section)) parseIssues.push(`duplicate section: ${clip(section, 60)}`);
      else sections.set(section, buffer.join('\n').trim());
    }
    buffer = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h2 = headingOf(line, 2);
    if (h2 !== null) {
      flush();
      section = keyOf(h2);
      continue;
    }
    const h1 = headingOf(line, 1);
    if (h1 !== null) {
      flush();
      section = null;
      if (title === null) title = h1;
      else parseIssues.push('multiple title lines');
      continue;
    }
    const field = section === null ? fieldOf(line) : null;
    if (field) {
      const label = keyOf(field.label);
      let value = field.rest;
      if (!value) {
        const next = lines[i + 1]?.trim() ?? '';
        if (next && !next.startsWith('#') && !next.startsWith('**')) value = next;
      }
      if (fields.has(label)) parseIssues.push(`duplicate field: ${clip(label, 60)}`);
      else fields.set(label, value);
      continue;
    }
    if (section !== null) buffer.push(line);
  }
  flush();
  return { title, fields, sections, parseIssues };
}

/**
 * What a file is missing against its template, in words a person can act on: the title line, any labelled line left empty or as
 * the template's placeholder, and any section that is missing or empty. The connector's basic rules and the form use this one list.
 */
export function templateGaps(parsed: Parsed, spec: TemplateSpec, kind: Kind): string[] {
  const out: string[] = [...parsed.parseIssues];
  if (parsed.title === null) out.push(`the title line ("# ${kind === 'draft' ? 'Your short title' : 'Review: your short title'}")`);
  for (const f of spec.fields) if (placeholder(parsed.fields.get(keyOf(f.name)))) out.push(`"${f.name.replace(/\?$/, '')}"`);
  for (const h of spec.headings) if (!(parsed.sections.get(keyOf(h)) ?? '').trim() || placeholder(parsed.sections.get(keyOf(h)))) out.push(`the "${h}" section`);
  return out;
}

/**
 * The verdict a review gives, read from the text after "Verdict:". An AI may bold it, end it with a full stop or follow it with a dash
 * and a reason, and all of those are the verdict. A line still holding the template's list of choices ("Supported | Partly supported | ...")
 * has not been filled in, and a word that only starts like a verdict ("Supportedness") is not one.
 */
export function verdictOf(value: string | undefined): string | null {
  if (!value || value.includes('|')) return null;
  const v = normalise(value).replace(/[*_`()]/g, '').replace(/^[\s:]+/, '').trim();
  for (const label of ['not supported', 'partly supported', 'cannot tell', 'supported']) if (v === label || new RegExp(`^${label}[\\s.,:;!—–-]`).test(v)) return label.replace(/^./, (c) => c.toUpperCase());
  return null;
}

/** What claimToTest says when a line is too long to read whole (see MAX_LINE): the part would be cut short, so it is not sent. */
export const LINE_TOO_LONG = `every line under ${MAX_LINE.toLocaleString('en-GB')} characters (one is longer, so it would be cut short)`;

/** The three parts of a draft that go to the reviewer: the claim, the evidence and the proposed change, copied word for word. */
export function claimToTest(rawDraft: string): { ok: true; text: string } | { ok: false; missing: string[] } {
  const d = parseDoc(cleanPaste(rawDraft, 'draft').text);
  // parseDoc cuts lines longer than MAX_LINE, which would send the reviewer part of a quote as if it were all of it.
  if (d.parseIssues.includes('a line exceeds the parser limit')) return { ok: false, missing: [LINE_TOO_LONG] };
  const parts: [string, string | undefined][] = [
    ['Claim in one sentence', d.fields.get(keyOf('Claim in one sentence'))],
    ['Evidence', d.sections.get(keyOf('Evidence'))],
    ['What I propose changing', d.sections.get(keyOf('What I propose changing'))],
  ];
  const missing = parts.filter(([, v]) => placeholder(v)).map(([name]) => name);
  if (missing.length) return { ok: false, missing };
  const [claim, evidence, proposal] = parts.map(([, v]) => (v ?? '').trim());
  return { ok: true, text: `${claim}\n\nEvidence:\n${evidence}\n\nWhat I propose changing:\n${proposal}` };
}

/** The prompt for the fresh chat: the public reviewer template with those three parts in its [CLAIM] slot. */
export function reviewPromptFor(template: string, rawDraft: string): { ok: true; text: string } | { ok: false; missing: string[] } {
  if (!template.includes('[CLAIM]')) throw new Error('the reviewer template has no [CLAIM] slot');
  const c = claimToTest(rawDraft);
  return c.ok ? { ok: true, text: template.replace('[CLAIM]', () => c.text) } : c;
}
