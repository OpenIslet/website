// The optional contributor fields: a name, an ORCID iD (with its check digit) and an X handle.
import { describe, expect, it } from 'vitest';
import { NAME_MAX, isValidOrcid, normaliseContributor, orcidCheckDigit } from '../src/core/queue/contributor';

describe('ORCID check digit (ISO 7064 mod 11-2)', () => {
  it.each(['0000-0002-1825-0097', '0000-0002-1694-233X', '0000-0001-5109-3700', '0000-0003-1415-9269'])('accepts the real iD %s', (id) => {
    expect(isValidOrcid(id)).toBe(true);
  });

  it('works out the check character, including X for ten', () => {
    expect(orcidCheckDigit('000000021825009')).toBe('7');
    expect(orcidCheckDigit('000000021694233')).toBe('X');
  });

  it.each(['0000-0002-1825-0098', '0000-0002-1694-2330', '0000-0001-5109-3701'])('rejects %s, whose last character does not match', (id) => {
    expect(isValidOrcid(id)).toBe(false);
  });

  it.each(['0000-0002-1825-009', '0000000218250097', '0000-0002-1825-00977', 'abcd-0002-1825-0097', '0000-0002-1825-009x ', ''])('rejects the wrong shape %j', (id) => {
    expect(isValidOrcid(id)).toBe(false);
  });
});

describe('normaliseContributor', () => {
  it('leaves out anything not given', () => {
    for (const none of [undefined, null, {}, { name: '', orcid: '  ', x: '' }, { name: null, orcid: null, x: null }]) {
      expect(normaliseContributor(none), JSON.stringify(none)).toEqual({ ok: true, value: {} });
    }
  });

  it('keeps good values, tidied', () => {
    const r = normaliseContributor({ name: '  Ada   Lovelace\n', orcid: ' 0000-0002-1694-233x ', x: '@ada_l' });
    expect(r).toEqual({ ok: true, value: { name: 'Ada Lovelace', orcid: '0000-0002-1694-233X', x: 'ada_l' } });
  });

  it('accepts an ORCID written as a web address, and stores the bare iD', () => {
    for (const form of ['https://orcid.org/0000-0002-1825-0097', 'http://www.orcid.org/0000-0002-1825-0097', 'orcid.org/0000-0002-1825-0097']) {
      expect(normaliseContributor({ orcid: form }), form).toEqual({ ok: true, value: { orcid: '0000-0002-1825-0097' } });
    }
  });

  it('refuses an ORCID with the wrong shape, naming the field', () => {
    const r = normaliseContributor({ orcid: '0000-0002-1825' });
    expect(r).toMatchObject({ ok: false, field: 'orcid' });
    expect((r as { message: string }).message).toContain('0000-0002-1825-0097');
  });

  it('refuses an ORCID whose check digit is wrong, and says why', () => {
    const r = normaliseContributor({ orcid: '0000-0002-1825-0098' });
    expect(r).toMatchObject({ ok: false, field: 'orcid' });
    expect((r as { message: string }).message).toContain('check-digit');
  });

  it.each(['a', 'A_b_9', 'x'.repeat(15), '@x'.concat('y'.repeat(14))])('accepts the X handle %s', (x) => {
    const r = normaliseContributor({ x });
    expect(r.ok).toBe(true);
    expect((r as { value: { x: string } }).value.x).toBe(x.replace(/^@/, ''));
  });

  it.each(['x'.repeat(16), 'with space', 'dash-ed', 'dot.ted', '@@twice', '@', 'café', 'https://x.com/jack'])('refuses the X handle %j', (x) => {
    const r = normaliseContributor({ x });
    if (x === '@') {
      // Only an @ is the same as nothing typed after it.
      expect(r).toMatchObject({ ok: false, field: 'x' });
      return;
    }
    expect(r).toMatchObject({ ok: false, field: 'x' });
  });

  it('counts the name in characters, not bytes, and allows exactly 80', () => {
    expect(normaliseContributor({ name: '\u{1F9EC}'.repeat(NAME_MAX) }).ok).toBe(true);
    expect(normaliseContributor({ name: 'a'.repeat(NAME_MAX) }).ok).toBe(true);
    expect(normaliseContributor({ name: 'a'.repeat(NAME_MAX + 1) })).toMatchObject({ ok: false, field: 'name' });
  });

  it('removes line breaks and control characters from the name', () => {
    const r = normaliseContributor({ name: 'Ada\r\nLovelace\u0000\u202e' });
    expect(r).toEqual({ ok: true, value: { name: 'Ada Lovelace' } });
  });

  it('names the field when a value is not text, or the whole thing is not an object', () => {
    expect(normaliseContributor({ name: 5 })).toMatchObject({ ok: false, field: 'name' });
    expect(normaliseContributor({ orcid: {} })).toMatchObject({ ok: false, field: 'orcid' });
    expect(normaliseContributor({ x: ['a'] })).toMatchObject({ ok: false, field: 'x' });
    expect(normaliseContributor('Ada')).toMatchObject({ ok: false, field: 'contributor' });
    expect(normaliseContributor(['Ada'])).toMatchObject({ ok: false, field: 'contributor' });
  });

  it('ignores fields it does not know', () => {
    expect(normaliseContributor({ name: 'Ada', email: 'ada@example.org', github: 'someone-else' })).toEqual({ ok: true, value: { name: 'Ada' } });
  });
});
