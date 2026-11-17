// Turns the small inline markup used by `pageCopy` in src/data/future.ts into safe HTML. Everything else is escaped.
//   **bold**   *italic*   [[label|href]]   {nobr|text}   {mono|text}
// A link's address may hold the tokens {startHref} and {contactHref}; the caller says what they stand for.
// Only strings from `pageCopy` go through here. The item lists are plain text and are never parsed.

const unescape = (s: string): string => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const escape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Only site paths and https addresses become links; anything else stays as plain words. */
const safeHref = (href: string): string | null => (/^(\/|https:\/\/)/.test(href) ? href : null);

export type Tokens = Record<string, string>;

export function rich(text: string, tokens: Tokens = {}): string {
  let out = escape(unescape(text));
  out = out.replace(/\{mono\|([^{}]+)\}/g, '<span class="mono">$1</span>');
  out = out.replace(/\{nobr\|([^{}]+)\}/g, '<span class="nobr">$1</span>');
  out = out.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_m, label: string, href: string) => {
    const filled = href.trim().replace(/\{(\w+)\}/g, (_t, name: string) => tokens[name] ?? '');
    const ok = safeHref(filled);
    return ok ? `<a href="${ok}">${label}</a>` : label;
  });
  out = out.replace(/\*\*((?:(?!\*\*).)+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*\s][^*]*)\*/g, '<em>$1</em>');
  return out;
}

/** The same text with the markup taken out, for labels, titles and alt text. */
export function plain(text: string): string {
  return unescape(text)
    .replace(/\{(?:mono|nobr)\|([^{}]+)\}/g, '$1')
    .replace(/\[\[([^\]|]+)\|[^\]]+\]\]/g, '$1')
    .replace(/\*\*((?:(?!\*\*).)+)\*\*/g, '$1')
    .replace(/\*([^*\s][^*]*)\*/g, '$1');
}

/** Fills a sentence stored as parts, with `null` where a value goes. */
export function fill(parts: readonly (string | null)[], values: readonly (string | number)[]): string {
  let i = 0;
  return parts.map((p) => (p === null ? String(values[i++] ?? '') : p)).join('');
}
