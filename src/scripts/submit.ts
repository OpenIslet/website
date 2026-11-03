// Browser-side helpers for the submission form (/submit and /submit/finish). The contract with the Worker is docs/connector/QUEUE-API.md.
//
// The draft and the review are read with the connector's own code (connector/src/core/template.ts), so this page and the Worker agree
// about every file: the AI's whole reply, the file copied as formatted text, and the template's own Markdown are all read the same way.
import { TEMPLATE, cleanPaste, looksLike, parseDoc, templateGaps, unfence, verdictOf as readVerdict, type Cleaned, type Kind } from '../../connector/src/core/template';
//
// quickCheck is a courtesy: it spots the common slips before anything is sent. The Worker runs the real checks (the same ones as the
// connector's check_draft tool) and its answer is the one that counts.

/** Where this tab keeps the secret for one sign-in. The name carries the sign-in's `state`, so two attempts can never mix their secrets. */
export const BINDING_PREFIX = 'openislet.submit.binding.';
export const bindingKey = (state: string): string => `${BINDING_PREFIX}${state}`;
export const STAGED_KEY = 'openislet.submit.staged';
/** Word left by a sign-in that finished in another tab, so the form that started it does not fill itself in again. */
export const DONE_PREFIX = 'openislet.submit.done.';
export const doneKey = (state: string): string => `${DONE_PREFIX}${state}`;
/** Word the finish page leaves in its own tab, so the form does not come back with files already posted (the Back button). */
export const POSTED_KEY = 'openislet.submit.posted';
/** What was typed into the form in this tab, kept so a reload, or a phone putting the tab to sleep, loses nothing. */
export const SAVED_KEY = 'openislet.submit.saved';
/** How long a sign-in is kept for another tab: as long as a sign-in link lasts, and no longer. */
export const LINGER_MS = 15 * 60 * 1000;
/** The Worker's own limit for each file (LIMITS.max in connector/src/core/draft.ts; tests/submit-form.test.mjs checks they agree). */
export const MAX_TEXT = 30000;

/** How long the Worker counts a file to be: the file inside what was pasted, read the way its own checks read it. */
export const sizeOf = (raw: string, kind: Kind): number => unfence(cleanPaste(raw, kind).text).length;

/** The sign-in `state` inside the GitHub address the Worker hands back, or null when it is missing or not the shape we issue. */
export function stateOf(authorizeUrl: string): string | null {
  try {
    const state = new URL(authorizeUrl).searchParams.get('state');
    return state && /^[A-Za-z0-9_-]{16,128}$/.test(state) ? state : null;
  } catch {
    return null;
  }
}

/** Shown when the browser will not keep the small note this tab needs to finish the sign-in safely. */
export const STORAGE_BLOCKED =
  'Your browser is not letting this page keep the small note it needs to finish the GitHub sign-in safely. This usually means strict private browsing or blocked site data. Please use a normal window, or allow site data for openislet.org, then try again.';

export interface Problem {
  /** `none` is for a problem that belongs to no single box. */
  field: 'draft' | 'review' | 'consent' | 'name' | 'orcid' | 'x' | 'none';
  text: string;
}

export interface FormValues {
  draft: string;
  review: string;
  consent: boolean;
  name: string;
  orcid: string;
  x: string;
}

/** The bare ORCID iD from what someone typed: a pasted https://orcid.org/… address is cut back to the iD, and the check character is upper case. */
export const orcidClean = (value: string): string => value.trim().replace(/^https?:\/\/orcid\.org\//i, '').toUpperCase();

/** An ORCID iD is four groups of four, the last character a check digit (ISO 7064 mod 11-2). Checks the shape and the digit. */
export function orcidOk(value: string): boolean {
  const v = orcidClean(value);
  if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(v)) return false;
  const digits = v.replace(/-/g, '');
  let total = 0;
  for (const ch of digits.slice(0, 15)) total = (total + Number(ch)) * 2;
  const check = (12 - (total % 11)) % 11;
  return digits[15] === (check === 10 ? 'X' : String(check));
}

/** An X (Twitter) handle: 1 to 15 letters, digits or underscores, with or without the @. */
export function xHandleOk(value: string): boolean {
  return /^@?[A-Za-z0-9_]{1,15}$/.test(value.trim());
}

/** The verdict word on the review's "Verdict:" line, lower case, or null if the line is missing or has not been filled in. */
export function verdictOf(review: string): string | null {
  const v = readVerdict(parseDoc(cleanPaste(review, 'review').text).fields.get('verdict'));
  return v ? v.toLowerCase() : null;
}

/** What a paste looks like: a draft, a review, the reviewer prompt meant for the fresh chat, or none of these. */
export const whatIsThis = (raw: string) => looksLike(raw);

/** The file inside what was pasted (the AI's whole reply, or the file copied as formatted text), in the template's Markdown. */
export const tidy = (raw: string, kind: Kind): Cleaned => cleanPaste(raw, kind);

/** "a, b and c" */
const listed = (items: string[]): string => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/** What a file is missing, in plain words: the same list the connector's basic rules use. */
function missingParts(text: string, kind: Kind): string[] {
  return templateGaps(parseDoc(cleanPaste(text, kind).text), TEMPLATE[kind], kind).map((g) =>
    g.startsWith('the title line') ? 'a title at the top' : g.replace(/^duplicate (field|section): (.*)$/, '“$2” twice'),
  );
}

/** True when the box holds the file twice, or two files: their headings and lines come out more than once. */
const pastedTwice = (text: string, kind: Kind): boolean =>
  templateGaps(parseDoc(cleanPaste(text, kind).text), TEMPLATE[kind], kind).some((g) => g.startsWith('duplicate ') || g === 'multiple title lines');

/** What is wrong with the draft on its own. An empty box is a problem too: it has not been added yet. */
export function draftProblems(raw: string): Problem[] {
  const out: Problem[] = [];
  const draft = raw.trim();
  if (!draft) return [{ field: 'draft', text: 'Paste your draft, or upload the file your AI made in step 3 (openislet-iip-….md).' }];
  const draftSize = sizeOf(draft, 'draft');
  if (draftSize > MAX_TEXT) return [{ field: 'draft', text: `The draft is too long (${draftSize.toLocaleString('en-GB')} characters). The limit is ${MAX_TEXT.toLocaleString('en-GB')}. One IIP should be one claim.` }];
  const kind = looksLike(draft);
  if (kind === 'review') return [...out, { field: 'draft', text: 'This looks like your blind review, not your draft. The draft is the file your AI wrote in step 3. Put the review in box 2.' }];
  if (kind === 'review-prompt') return [...out, { field: 'draft', text: 'This is the prompt for the fresh chat in step 4, not your draft. The draft is the file your AI wrote in step 3.' }];
  if (pastedTwice(draft, 'draft')) return [...out, { field: 'draft', text: 'There is more than one file in this box, or the same file twice. Clear the box and paste just the draft, once.' }];
  const missing = missingParts(draft, 'draft');
  if (missing.length >= 6) out.push({ field: 'draft', text: 'This does not look like a draft yet. Paste the file your AI wrote in step 3: it starts with a title and has a “Claim in one sentence” line.' });
  else if (missing.length) out.push({ field: 'draft', text: `Your draft is missing ${listed(missing)}. Ask your AI to fill these in using the template from step 3 (it should write “Not known” for anything it does not know).` });
  else {
    const type = parseDoc(cleanPaste(draft, 'draft').text).fields.get('type') ?? '';
    const options = TEMPLATE.draft.fields[0].options ?? [];
    if (!options.some((o) => type.trim().toLowerCase().replace(/[*_]/g, '').startsWith(o.toLowerCase())))
      out.push({ field: 'draft', text: `The “Type” line should say one of: ${listed(options)}.` });
  }
  return out;
}

/** What is wrong with the review on its own, including a verdict that is not Supported or Partly supported. */
export function reviewProblems(raw: string): Problem[] {
  const out: Problem[] = [];
  const review = raw.trim();
  if (!review) return [{ field: 'review', text: 'Paste your blind review, or upload the file from step 4 (openislet-review-….md).' }];
  const reviewSize = sizeOf(review, 'review');
  if (reviewSize > MAX_TEXT) return [{ field: 'review', text: `The review is too long (${reviewSize.toLocaleString('en-GB')} characters). The limit is ${MAX_TEXT.toLocaleString('en-GB')}.` }];
  const kind = looksLike(review);
  if (kind === 'review-prompt')
    return [...out, { field: 'review', text: 'This is the prompt you paste into a brand-new chat, not the review itself. Paste it into a new chat, and paste the answer that chat gives you here: that answer is the review.' }];
  if (kind === 'draft') return [...out, { field: 'review', text: 'This looks like your draft, not the blind review. Put it in box 1, and paste the review from your fresh chat (step 4) here.' }];
  if (pastedTwice(review, 'review')) return [...out, { field: 'review', text: 'There is more than one file in this box, or the same file twice. Clear the box and paste just the blind review, once.' }];
  const verdict = verdictOf(review);
  const missing = missingParts(review, 'review').filter((m) => m !== '“Verdict”' && m !== '"Verdict"');
  if (missing.length >= 6 && !verdict) return [...out, { field: 'review', text: 'This does not look like a blind review yet. Paste the answer from your fresh chat in step 4: it starts with “Review:” and has a “Verdict” line.' }];
  if (!verdict) out.push({ field: 'review', text: 'We could not read the verdict. Its line should say “Verdict: Supported” or “Verdict: Partly supported”, not the list of choices.' });
  else if (verdict !== 'supported' && verdict !== 'partly supported')
    out.push({ field: 'review', text: `The review’s verdict is “${verdict.charAt(0).toUpperCase()}${verdict.slice(1)}”. Only IIPs whose review says Supported or Partly supported can be submitted.` });
  if (missing.length) out.push({ field: 'review', text: `Your review is missing ${listed(missing)}. Run the blind review again in a fresh chat with the message from step 4.` });
  return out;
}

/** The draft's title (its first "# " heading), so the page can say what it read. */
export function draftTitle(raw: string): string | null {
  const t = parseDoc(cleanPaste(raw, 'draft').text).title;
  return t ? t.trim().slice(0, 100) : null;
}

/** Everything a person should fix before pressing the button, in plain English. An empty list means "nothing obvious". */
export function quickCheck(v: FormValues): Problem[] {
  const out: Problem[] = [...draftProblems(v.draft), ...reviewProblems(v.review)];

  if (v.name.trim().length > 80) out.push({ field: 'name', text: 'The display name is too long. Use 80 characters or fewer.' });
  if (v.orcid.trim() && !orcidOk(v.orcid)) out.push({ field: 'orcid', text: 'That ORCID iD does not look right. It has the form 0000-0002-1825-0097. Leave it empty if you would rather not add one.' });
  if (v.x.trim() && !xHandleOk(v.x)) out.push({ field: 'x', text: 'That X handle does not look right. Use up to 15 letters, numbers or underscores. Leave it empty if you would rather not add one.' });
  if (!v.consent) out.push({ field: 'consent', text: 'Tick the box to agree that your IIP and its review are published openly under CC BY 4.0.' });
  return out;
}

/** Lower-case hex SHA-256 of a string. */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A random secret, 32 bytes, as base64url. It stays in this browser (see `shared`); only its hash goes to the server first. */
export function newSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface ApiResult {
  ok: boolean;
  status: number;
  data: Record<string, unknown>;
}

/** Sends JSON to the Worker (or reads JSON with a GET) and never throws: a network failure comes back as status 0. */
export async function callApi(api: string, path: string, body?: unknown): Promise<ApiResult> {
  try {
    const response = await fetch(`${api}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data: Record<string, unknown> = {};
    try {
      const parsed: unknown = await response.json();
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, status: response.status, data: { error: 'bad_response' } };
      }
      data = parsed as Record<string, unknown>;
      if (response.ok && path === '/api/complete' && data.submitted === true) {
        const issue = data.issue;
        if (issue === null || typeof issue !== 'object' || Array.isArray(issue)) {
          return { ok: false, status: response.status, data: { error: 'bad_response' } };
        }
        const fields = issue as Record<string, unknown>;
        if (typeof fields.url !== 'string' || !fields.url
            || (fields.number !== undefined && (typeof fields.number !== 'number'
              || !Number.isSafeInteger(fields.number) || fields.number <= 0))) {
          return { ok: false, status: response.status, data: { error: 'bad_response' } };
        }
      }
    } catch {
      return { ok: false, status: response.status, data: { error: 'bad_response' } };
    }
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: 'network', message: 'Could not reach the OpenIslet server. Check your connection and try again in a moment.' } };
  }
}

/** One plain-English sentence for an API error, using the Worker's own message when it sends one. */
export function explain(result: ApiResult): string {
  const message = typeof result.data.message === 'string' ? result.data.message : '';
  if (message) return message;
  switch (result.data.error) {
    case 'queue_not_open':
      return 'Submissions are not open yet. Keep your files, and try again when they open.';
    case 'queue_not_configured':
      return 'The submission system is not set up yet. Please try again later.';
    case 'rate_limited':
      return 'Too many tries in a short time. Please wait a while and try again.';
    default:
      return result.status === 0 ? 'Could not reach the OpenIslet server. Check your connection and try again in a moment.' : `Something went wrong (code ${result.status}). Please try again.`;
  }
}

/** Safe storage: the form still works if the browser blocks it, and says so before it sends anyone to GitHub. */
export const store = {
  get(key: string): string | null {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  /** Saves a value and reads it back. False when the browser would not keep it (strict private browsing, blocked site data, or full). */
  set(key: string, value: string): boolean {
    try {
      sessionStorage.setItem(key, value);
      return sessionStorage.getItem(key) === value;
    } catch {
      return false;
    }
  },
  remove(key: string): void {
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* private browsing */
    }
  },
  /** Can this tab keep a note for the few minutes the GitHub sign-in takes? */
  works(): boolean {
    const probe = 'openislet.submit.probe';
    try {
      sessionStorage.setItem(probe, '1');
      const kept = sessionStorage.getItem(probe) === '1';
      sessionStorage.removeItem(probe);
      return kept;
    } catch {
      return false;
    }
  },
  /** Removes every sign-in secret this tab kept, and their copies for other tabs, so an abandoned attempt leaves nothing behind. */
  clearBindings(): void {
    for (const key of store.bindings()) {
      store.remove(key);
      shared.remove(key);
    }
  },
  /** The names of the sign-in secrets this tab kept. */
  bindings(): string[] {
    try {
      return Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.key(i)).filter((k): k is string => !!k?.startsWith(BINDING_PREFIX));
    } catch {
      return [];
    }
  },
};

/**
 * The browser's shared storage, for the one case this tab's own cannot cover: GitHub (or its phone app) sending people back to a
 * new tab of the same browser. It holds only a sign-in's secret, under the sign-in's own `state`, and word that a sign-in finished:
 * never the files or the id that reads them. A secret is removed when it is used, when the sign-in is cancelled, and when the
 * person is back on the form; past LINGER_MS it is useless (the sign-in has expired) and the form pages sweep it out. Another
 * browser has none of it, so a sign-in link sent by someone else still cannot post files the person never saw.
 */
export const shared = {
  /** Keeps the values until LINGER_MS from now. False when the browser would not keep them. */
  set(key: string, values: Record<string, string>, now = Date.now()): boolean {
    try {
      const text = JSON.stringify({ ...values, until: now + LINGER_MS });
      localStorage.setItem(key, text);
      return localStorage.getItem(key) === text;
    } catch {
      return false;
    }
  },
  /** The values, `expired` when they were kept too long ago (they are removed then), or null. */
  get(key: string, now = Date.now()): Record<string, string> | 'expired' | null {
    let text: string | null = null;
    try {
      text = localStorage.getItem(key);
    } catch {
      return null;
    }
    if (text === null) return null;
    let kept: unknown = null;
    try {
      kept = JSON.parse(text);
    } catch {
      /* not ours, or damaged: removed below */
    }
    const until = kept !== null && typeof kept === 'object' ? (kept as { until?: unknown }).until : undefined;
    // A time further ahead than an entry is ever kept means a clock was moved back: treat it as expired too.
    if (typeof until !== 'number' || until <= now || until - now > LINGER_MS) {
      shared.remove(key);
      return typeof until === 'number' ? 'expired' : null;
    }
    const values: Record<string, string> = {};
    for (const [k, v] of Object.entries(kept as Record<string, unknown>)) if (typeof v === 'string') values[k] = v;
    return values;
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      /* private browsing */
    }
  },
  /** Removes every sign-in entry that has expired. Both form pages run it when they load. */
  sweep(now = Date.now()): void {
    let keys: string[] = [];
    try {
      keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((k): k is string => !!k && (k.startsWith(BINDING_PREFIX) || k.startsWith(DONE_PREFIX)));
    } catch {
      /* private browsing */
    }
    for (const key of keys) shared.get(key, now);
  },
};

/** True when a sign-in this tab started was finished in another tab, so its files are already public. */
export function postedElsewhere(now = Date.now()): boolean {
  return store.bindings().some((key) => {
    const done = shared.get(doneKey(key.slice(BINDING_PREFIX.length)), now);
    return !!done && done !== 'expired';
  });
}

/**
 * When the text kept in this tab has been posted (the finish page in this tab, or in another one, said so), forgets it and the
 * sign-in, and says so, so neither the form nor Start here brings posted files back.
 */
export function forgetIfPosted(): boolean {
  if (!store.get(POSTED_KEY) && !postedElsewhere()) return false;
  for (const key of [POSTED_KEY, SAVED_KEY, STAGED_KEY]) store.remove(key);
  store.clearBindings();
  return true;
}

/** The form's own text, as kept in this tab. Never the tick: that is agreement to publish the files as they are when it is given. */
export interface Saved {
  draft: string;
  review: string;
  name: string;
  orcid: string;
  x: string;
  aiDraft: string;
  aiReview: string;
}
const SAVED_FIELDS = ['draft', 'review', 'name', 'orcid', 'x', 'aiDraft', 'aiReview'] as const;

/** Keeps the form's text in this tab. sessionStorage goes when the tab is closed, which is right for work not yet published. */
export function remember(v: Saved): void {
  const kept = Object.fromEntries(SAVED_FIELDS.map((k) => [k, typeof v[k] === 'string' ? v[k] : '']));
  if (SAVED_FIELDS.every((k) => !kept[k].trim())) store.remove(SAVED_KEY);
  else store.set(SAVED_KEY, JSON.stringify(kept));
}

/** What `remember` kept in this tab, or null. */
export function remembered(): Saved | null {
  try {
    const kept: unknown = JSON.parse(store.get(SAVED_KEY) ?? 'null');
    if (kept === null || typeof kept !== 'object') return null;
    const out = Object.fromEntries(SAVED_FIELDS.map((k) => [k, typeof (kept as Record<string, unknown>)[k] === 'string' ? (kept as Record<string, string>)[k] : '']));
    return SAVED_FIELDS.some((k) => out[k].trim()) ? (out as unknown as Saved) : null;
  } catch {
    return null;
  }
}

/**
 * A draft and a review pasted into one box, in either order: the two files, cut apart at a title line, or null. Each side has to
 * read as its own kind of file, so a single file is never cut.
 */
export function splitFiles(raw: string): { draft: string; review: string } | null {
  const text = (raw ?? '').replace(/\r\n?/g, '\n');
  if (text.length > 4 * MAX_TEXT) return null;
  const lines = text.split('\n');
  let tries = 0;
  // The code block each line is in (as in template.ts: ``` or ~~~, closed by the same mark at least as long), and where it opened.
  let fence: { ch: string; len: number; at: number } | null = null;
  for (let i = 0; i < lines.length && tries < 20; i++) {
    const t = lines[i].trimStart();
    const run = lines[i].length - t.length <= 3 && (t[0] === '`' || t[0] === '~') ? t.length - t.replace(/^(`+|~+)/, '').length : 0;
    if (fence && run >= fence.len && t[0] === fence.ch && !t.slice(run).trim()) {
      fence = null;
      continue;
    }
    if (!fence && run >= 3) {
      fence = { ch: t[0], len: run, at: i };
      continue;
    }
    // a "# " title, or the review's title copied as formatted text ("Review: …")
    if (i === 0 || (!/^ {0,3}# /.test(lines[i]) && !/^(\*\*)?Review:/.test(lines[i].trim()))) continue;
    // Inside a code block, only a title that starts the block counts, and the cut goes above the block's opening line, so each
    // side keeps its block whole. A title further down a block is something quoted inside a file.
    let cut = i;
    if (fence) {
      if (lines.slice(fence.at + 1, i).some((l) => l.trim())) continue;
      cut = fence.at;
    }
    if (cut === 0) continue;
    tries++;
    const a = lines.slice(0, cut).join('\n');
    const b = lines.slice(cut).join('\n');
    const ka = looksLike(a);
    const kb = looksLike(b);
    if (ka === 'draft' && kb === 'review') return { draft: cleanPaste(a, 'draft').text, review: cleanPaste(b, 'review').text };
    if (ka === 'review' && kb === 'draft') return { draft: cleanPaste(b, 'draft').text, review: cleanPaste(a, 'review').text };
  }
  return null;
}
