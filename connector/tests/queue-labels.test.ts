// The labels an IIP gets on GitHub, and above all the design labels: A, B, X, "Both", "All three" and a roadmap stage.
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
    // A roadmap IIP names a stage after the blueprint (Stage 0) instead of a design.
    ['A roadmap stage: Stage 4', ['design:roadmap'], 'Roadmap stage 4'],
    ['Roadmap stage 2', ['design:roadmap'], 'Roadmap stage 2'],
    ['Stage 5', ['design:roadmap'], 'Roadmap stage 5'],
    ['**Stage** 4', ['design:roadmap'], 'Roadmap stage 4'],
    ['Roadmap · Stage 2', ['design:roadmap'], 'Roadmap stage 2'],
    ['Roadmap, Stages 2-3', ['design:roadmap'], 'Roadmap stages 2 and 3'],
    ['A roadmap stage: both Stage 2 and Stage 3', ['design:roadmap'], 'Roadmap stages 2 and 3'],
    ['A new roadmap stage', ['design:roadmap'], 'Roadmap (a new stage)'],
    ['Roadmap · New stage', ['design:roadmap'], 'Roadmap (a new stage)'],
    ['Roadmap, a new stage between Stage 3 and Stage 4', ['design:roadmap'], 'Roadmap (a new stage)'],
    ['Roadmap', ['design:roadmap'], 'Roadmap'],
    ['The roadmap', ['design:roadmap'], 'Roadmap'],
    ['Neither design; Roadmap stage 3', ['design:roadmap'], 'Roadmap stage 3'],
    ['Design A and Roadmap stage 3', ['design:a', 'design:roadmap'], 'Design A and roadmap stage 3'],
    // Next to a design, a stage without the word "roadmap" is not a roadmap stage.
    ['Design X (a new edit) and Stage 1', ['design:x'], 'Design X'],
    ['Design B (Stage 6 cells)', ['design:b'], 'Design B'],
    ['Design B with a new stage-specific promoter', ['design:b'], 'Design B'],
    ['Design A only; the roadmap is unaffected', ['design:a'], 'Design A'],
  ])('reads "%s" as %j', async (written, labels, wording) => {
    const r = await check(written);
    expect(designOf(r.labels), written).toEqual(labels);
    expect(r.design).toBe(wording);
    expect(issueLabels(r)).toEqual(expect.arrayContaining(labels));
  });

  it('gives no design label when the line is missing, left as the template placeholder, or names no design', async () => {
    for (const written of [null, '[Design A | Design B | Design X | All three | Both | Neither]', '[Design A | Design B | Design X | Two of them (say which) | All three | None]', '[Design A | Design B | Design X | Two of them (say which) | All three | A roadmap stage (say which)]', 'Design Z', 'not sure', 'Stage 0', 'A roadmap stage (say which)']) {
      const r = await check(written);
      expect(designOf(r.labels), String(written)).toEqual([]);
    }
  });

  it('reads the wording on its own, without a bundle', () => {
    expect(designsNamed('Design X')).toEqual({ letters: ['x'], neither: false });
    expect(designsNamed('Neither A nor B').neither).toBe(true);
    expect(designLabels(undefined)).toEqual({ labels: [], text: null });
    expect(designLabels('Design A, Design B, Design X').labels).toEqual(['design:all-three']);
    expect(designLabels('Roadmap stage 4')).toEqual({ labels: ['design:roadmap'], text: 'Roadmap stage 4' });
    expect(designsNamed('Roadmap stage 4')).toEqual({ letters: [], neither: false });
    expect(designsNamed('Roadmap')).toEqual({ letters: [], neither: false });
  });

  it('passes the design check for a roadmap IIP, and never reads a stage number as a test', async () => {
    const r = await runChecks(bundle(), defaultConfig, {
      draft: makeDraft({ evidence, test: 'None (a roadmap IIP); it changes Stage 4 and Stages 2 to 3', design: 'A roadmap stage: Stage 4' }),
      review: makeReview(),
      consent: true,
    });
    expect(r.checks.find((c) => c.id === 'design')?.status).toBe('pass');
    expect(r.labels).toContain('design:roadmap');
    expect(r.labels.filter((l) => l.startsWith('test:'))).toEqual([]);
    const testsOf = async (test: string, design = 'Design A') =>
      (await runChecks(bundle(), defaultConfig, { draft: makeDraft({ evidence, test, design }), review: makeReview(), consent: true })).labels.filter((l) => l.startsWith('test:'));
    for (const test of ['Roadmap, Stage 4', 'Roadmap, 4', 'Roadmap (Stage 2 and 3)', 'Stages 2, 3, and 4', 'Stages 2\u20143', 'Stages 2 through 4']) {
      expect(await testsOf(test, 'Roadmap'), test).toEqual([]);
    }
    const r2 = await runChecks(bundle(), defaultConfig, { draft: makeDraft({ evidence, test: 'None (a roadmap IIP)', design: 'Roadmap' }), review: makeReview(), consent: true });
    expect(r2.checks.find((c) => c.id === 'design')?.detail).toBe('It says it affects Roadmap.');
    // A bare test number still counts when the roadmap is only mentioned in the reason.
    expect(await testsOf('Test 3, and roadmap stage 5')).toEqual(['test:3']);
    expect(await testsOf("3, because the roadmap's Stage 1 work would expose it")).toEqual(['test:3']);
    expect(await testsOf('2A (and Stage 1 of the roadmap)')).toEqual(['test:2a']);
    expect(await testsOf('Roadmap stage 2; tests 2A/2B', 'Roadmap')).toEqual(['test:2a', 'test:2b']);
    expect(await testsOf('3 and 4')).toEqual(['test:3', 'test:4']);
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

