// Small pieces of wording shared by the tools, so a finding reads the same wherever it appears.
import type { Direction } from './types';
import { clip } from './text';

export const resultWords: Record<Direction, string> = {
  protective: 'improved the outcome',
  deleterious: 'impaired the outcome',
  neutral: 'no clear difference',
};

export interface Renderable {
  what_was_changed: string;
  direction: Direction;
  tests: string[];
  area: string;
  quote: string | null;
}

/** One finding as one line: what was changed, what happened, which test, and the exact sentence where it may be shown. */
export function findingLine(f: Renderable): string {
  const tests = f.tests.length ? ` · Test ${f.tests.join(', ')}` : '';
  const tail = f.quote ? ` “${f.quote}”` : ' (The paper\'s wording is withheld: see the paper on PubMed.)';
  return `*${clip(f.what_was_changed, 150)}* → **${resultWords[f.direction]}**${tests} · ${f.area}.${tail}`;
}
