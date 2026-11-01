// The known weak spots and open questions, so nobody repeats work that is already on the list.
import { type Answer, md } from './answer';
import type { Bundle } from './bundle';
import { similarity } from './text';
import type { OpenQuestion } from './types';

export interface QuestionFilter {
  test?: string;
  design?: 'A' | 'B' | 'X';
  query?: string;
}

export async function openQuestions(bundle: Bundle, filter: QuestionFilter): Promise<Answer> {
  const all = await bundle.openQuestions();
  let list: OpenQuestion[] = all.filter((q) => q.status === 'open');
  if (filter.test) list = list.filter((q) => q.tests.includes(filter.test as string));
  if (filter.design) list = list.filter((q) => q.designs.includes(filter.design as string));
  if (filter.query?.trim()) {
    const text = filter.query;
    list = list
      .map((q) => ({ q, score: similarity(text, `${q.title} ${q.plain} ${q.detail}`) }))
      .filter((x) => x.score > 0.05)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.q);
  }
  const scope = [filter.test ? `Test ${filter.test}` : null, filter.design ? `Design ${filter.design}` : null, filter.query ? `"${filter.query}"` : null].filter(Boolean).join(', ');
  const summary = list.length
    ? `There ${list.length === 1 ? 'is 1 open question' : `are ${list.length} open questions`}${scope ? ` about ${scope}` : ''}. These are the known weak spots, so you can check whether your idea is already on the list.`
    : `No open question matches${scope ? ` ${scope}` : ''}. That does not mean there are none: it only means none is on the list yet.`;
  const body =
    md.h(1, 'Open questions') +
    '\n' +
    (list.length
      ? list
          .map((q) =>
            [
              md.h(2, `${q.id} · ${q.title}`),
              q.plain,
              '',
              `*In more detail:* ${q.detail}`,
              '',
              `*How it could be settled:* ${q.settle}`,
              '',
              `*Affects:* ${q.tests.map((t) => `Test ${t}`).join(', ')}; ${q.designs.map((d) => `Design ${d}`).join(' and ')}.${q.rules.length ? ` Related Idea Graveyard rules: ${q.rules.join(', ')}.` : ''}`,
              q.pmids.length ? `*Papers:* ${q.pmids.map((p) => `[${p}](https://pubmed.ncbi.nlm.nih.gov/${p}/)`).join(', ')}` : '',
              '',
            ]
              .filter((l, i, a) => l !== '' || a[i - 1] !== '')
              .join('\n'),
          )
          .join('\n')
      : 'Nothing listed.\n');
  return {
    summary,
    body,
    data: { total_open: all.filter((q) => q.status === 'open').length, shown: list.length, questions: list },
    notes: ['If your Islet Improvement Proposal (IIP) answers one of these, say which one in your draft.'],
  };
}
