// Small text helpers shared by the tools: comparing sentences, trimming long text, and writing lists.

const STOP = new Set(
  (
    'a about above after again all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its just may me might more most my no nor not of off on once only or other our out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your ' +
    'study studies paper papers result results show shows shown showed find found finding findings'
  ).split(' '),
);

/** Lower-case, one kind of space, and compatibility characters folded, so two spellings of one sentence compare equal. */
export function normalise(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[‘’‛′]/g, "'").replace(/[“”„″]/g, '"').replace(/[‐‑‒–—−]/g, '-').replace(/\s+/g, ' ').trim();
}

export function words(text: string): string[] {
  return (normalise(text).match(/[a-z0-9][a-z0-9-]*/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w));
}

/** How alike two pieces of text are, from 0 (nothing shared) to 1 (the same words). */
export function similarity(a: string, b: string): number {
  const count = (list: string[]) => {
    const m = new Map<string, number>();
    for (const w of list) m.set(w, (m.get(w) ?? 0) + 1);
    return m;
  };
  const ca = count(words(a));
  const cb = count(words(b));
  if (!ca.size || !cb.size) return 0;
  let dot = 0;
  for (const [w, n] of ca) dot += n * (cb.get(w) ?? 0);
  const norm = (m: Map<string, number>) => Math.sqrt([...m.values()].reduce((s, n) => s + n * n, 0));
  return dot / (norm(ca) * norm(cb));
}

export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** "a, b and c" */
export function andList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;
}

export function longDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
}

/** Keeps an answer inside a size limit, and says so when it cuts. */
export function limitLength(text: string, max: number): { text: string; cut: boolean } {
  if (text.length <= max) return { text, cut: false };
  const head = text.slice(0, max);
  const lastBreak = Math.max(head.lastIndexOf('\n\n'), head.lastIndexOf('\n'));
  return { text: `${head.slice(0, lastBreak > max * 0.6 ? lastBreak : max).trimEnd()}\n\n[Cut here to keep the answer short. Ask for a narrower part to see the rest.]`, cut: true };
}

export function tidy(code: string): string {
  return code.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}
