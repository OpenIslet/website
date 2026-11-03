// The Idea Graveyard suggestions for an idea in words: every rule is still found from its own wording, and words that say nothing
// about any rule (filler and bare numbers) find nothing. Before this, "a" matched every rule word starting with a.
import { describe, expect, it } from 'vitest';
import { suggestFromIdea } from '../src/core/graveyard';
import { bundle } from './helpers';

describe('Idea Graveyard suggestions', () => {
  it('finds every rule from its own title and from its own idea text', async () => {
    const b = bundle();
    const rules = await b.rules();
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) {
      expect((await suggestFromIdea(b, r.title)).suggestions.map((s) => s.id), `${r.id} by title`).toContain(r.id);
      expect((await suggestFromIdea(b, r.idea)).suggestions.map((s) => s.id), `${r.id} by idea`).toContain(r.id);
    }
  });

  it('finds nothing from filler words and numbers alone', async () => {
    const r = await suggestFromIdea(bundle(), 'a 180 at about 000 after 220 an always the assume 0 against 15 at 56 and 60');
    expect(r.suggestions).toEqual([]);
  });
});
