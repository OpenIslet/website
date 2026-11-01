// The optional "about the contributor" fields: a display name, an ORCID iD and an X handle.
// They are plain text the contributor types in. They are shown as "stated by the contributor", never as verified.
import type { Contributor } from './types';

export const NAME_MAX = 80;

export type ContributorField = 'name' | 'orcid' | 'x' | 'contributor';
export type ContributorResult = { ok: true; value: Contributor } | { ok: false; field: ContributorField; message: string };

/**
 * The ISO 7064 mod 11-2 check character of an ORCID iD, from its first fifteen digits.
 * (The last character of a valid iD is this digit, or X for ten.)
 */
export function orcidCheckDigit(first15: string): string {
  let total = 0;
  for (const ch of first15) total = (total + Number(ch)) * 2;
  const result = (12 - (total % 11)) % 11;
  return result === 10 ? 'X' : String(result);
}

/** True for 0000-0000-0000-000X written with hyphens, whose last character passes the check. */
export function isValidOrcid(id: string): boolean {
  const m = /^(\d{4})-(\d{4})-(\d{4})-(\d{3}[\dX])$/.exec(id);
  if (!m) return false;
  const digits = `${m[1]}${m[2]}${m[3]}${m[4]}`;
  return orcidCheckDigit(digits.slice(0, 15)) === digits[15];
}

/** Control characters and line breaks out, runs of spaces to one, ends trimmed. */
function tidyLine(text: string): string {
  return text.replace(/[\u0000-\u001F\u007F-\u009F\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2069\ufeff]/gu, ' ').replace(/\s+/g, ' ').trim();
}

const ORCID_URL = /^(?:https?:\/\/)?(?:www\.)?orcid\.org\//i;

/** Checks the three optional fields. Empty fields are simply left out. The first problem found names the field. */
export function normaliseContributor(input: unknown): ContributorResult {
  if (input === undefined || input === null) return { ok: true, value: {} };
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, field: 'contributor', message: 'The contributor details should be a name, an ORCID iD and an X handle, all optional.' };
  }
  const raw = input as Record<string, unknown>;
  const out: Contributor = {};
  for (const field of ['name', 'orcid', 'x'] as const) {
    const value = raw[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string') return { ok: false, field, message: `The ${field === 'x' ? 'X handle' : field === 'orcid' ? 'ORCID iD' : 'display name'} should be text.` };
  }

  if (typeof raw.name === 'string') {
    const name = tidyLine(raw.name);
    if ([...name].length > NAME_MAX) return { ok: false, field: 'name', message: `The display name is too long. Please use ${NAME_MAX} characters or fewer.` };
    if (name) out.name = name;
  }

  if (typeof raw.orcid === 'string' && raw.orcid.trim()) {
    const id = raw.orcid.trim().replace(ORCID_URL, '').toUpperCase();
    if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(id)) {
      return { ok: false, field: 'orcid', message: 'The ORCID iD should look like 0000-0002-1825-0097 (four groups of four characters).' };
    }
    if (!isValidOrcid(id)) {
      return { ok: false, field: 'orcid', message: 'That ORCID iD does not pass its check-digit test, so it has probably been mistyped. It should look like 0000-0002-1825-0097.' };
    }
    out.orcid = id;
  }

  if (typeof raw.x === 'string' && raw.x.trim()) {
    const handle = raw.x.trim().replace(/^@/, '');
    if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
      return { ok: false, field: 'x', message: 'The X handle can use only letters, numbers and underscores, up to 15 characters (for example openislet).' };
    }
    out.x = handle;
  }
  return { ok: true, value: out };
}
