// The labels an IIP gets on GitHub, and above all the design labels: A, B, X, "Both" and "All three".
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/answer';
import { designLabels, designsNamed, runChecks } from '../src/core/draft';
import { issueLabels } from '../src/core/queue/issue';
import { makeDraft, makeReview, shownQuote } from './fixtures';
import { bundle } from './helpers';

const f = shownQuote();
const evidence = [`${f.cite}, PMID ${f.pmid}, "${f.quote}"`];
const check = (design: string | null) =>
  runChecks(bundle(), defaultConfig, { draft: makeDraft({ evidence, ...(design === null ? { omit: ['design'] } : { design }) }), review: makeReview(), consent: true });
const designOf = (labels: string[]) => labels.filter((l) => l.startsWith('design:'));

describe('the design labels', () => {
  it.each<[string, string[], string | null]>([
    ['Design A', ['design:a'], 'Design A'],
    ['Design B', ['design:b'], 'Design B'],
    ['Design X', ['design:x'], 'Design X'],
    ['design x', ['design:x'], 'Design X'],
    ['Design X, because it is the challenger', ['design:x'], 'Design X'],
    ['Design X (Islet-X)', ['design:x'], 'Design X'],
    ['All three', ['design:all-three'], 'All three'],
    ['all three designs', ['design:all-three'], 'All three'],
    ['Both', ['design:both'], 'Both'],
    ['Neither', ['design:neither'], 'Neither'],
    ['None', ['design:neither'], 'Neither'],
    ['Two of them: Design A and Design X', ['design:a', 'design:x'], 'Design A and Design X'],
    ['Design A and Design B', ['design:both'], 'Both'],
    ['Designs A and B', ['design:both'], 'Both'],
    ['Design A, Design B and Design X', ['design:all-three'], 'All three'],
    ['Design A, B and X', ['design:all-three'], 'All three'],
    ['Design A and Design X', ['design:a', 'design:x'], 'Design A and Design X'],
    ['Design B / Design X', ['design:b', 'design:x'], 'Design B and Design X'],
    ['Design B and a new promoter', ['design:b'], 'Design B'],
    ['Design A or B', ['design:both'], 'Both'],
  ])('reads "%s" as %j', async (written, labels, wording) => {
    const r = await check(written);
    expect(designOf(r.labels), written).toEqual(labels);
    expect(r.design).toBe(wording);
    expect(issueLabels(r)).toEqual(expect.arrayContaining(labels));
  });

  it('gives no design label when the line is missing, left as the template placeholder, or names no design', async () => {
    for (const written of [null, '[Design A | Design B | Design X | All three | Both | Neither]', '[Design A | Design B | Design X | Two of them (say which) | All three | None]', 'Design Z', 'not sure']) {
      const r = await check(written);
      expect(designOf(r.labels), String(written)).toEqual([]);
    }
  });

  it('reads the wording on its own, without a bundle', () => {
    expect(designsNamed('Design X')).toEqual({ letters: ['x'], neither: false });
    expect(designsNamed('Neither A nor B').neither).toBe(true);
    expect(designLabels(undefined)).toEqual({ labels: [], text: null });
    expect(designLabels('Design A, Design B, Design X').labels).toEqual(['design:all-three']);
  });

  it('keeps the other labels as they were', async () => {
    const r = await check('Design X');
    expect(r.labels).toEqual(expect.arrayContaining(['submission', 'type:problem-found', 'test:3', 'design:x']));
    expect(r.labels[0]).toBe('submission');
    const queue = issueLabels(r);
    expect(queue).toContain('status:queued');
    expect(queue.filter((l) => l === 'status:queued')).toHaveLength(1);
  });
});

// The form accepts a Type line written with emphasis marks (**Improvement**), so the Worker must read it the same way.
const checkType = (type: string) => runChecks(bundle(), defaultConfig, { draft: makeDraft({ evidence, type }), review: makeReview(), consent: true });
const typeDoor = (r: Awaited<ReturnType<typeof checkType>>) => r.door.find((d) => d.id === 'draft_type');

describe('the type line, with or without emphasis marks', () => {
  it.each(['Improvement', '**Improvement**', '*Improvement*', '_Improvement_', '__Improvement__', '**Improvement**, because it is better', 'Improvement.'])('reads "%s" as an improvement', async (written) => {
    const r = await checkType(written);
    expect(typeDoor(r), written).toBeUndefined();
    expect(r.labels, written).toContain('type:improvement');
  });

  it.each([
    ['**Problem found**', 'type:problem-found'],
    ['_Missing evidence_', 'type:missing-evidence'],
  ])('reads "%s" as well', async (written, label) => {
    const r = await checkType(written);
    expect(typeDoor(r), written).toBeUndefined();
    expect(r.labels, written).toContain(label);
  });

  it('still refuses a value that is not one of the choices, with or without marks', async () => {
    for (const written of ['Something else', '**Something else**', '`Improvement`']) {
      const r = await checkType(written);
      expect(typeDoor(r)?.status, written).toBe('fail');
    }
  });
});

