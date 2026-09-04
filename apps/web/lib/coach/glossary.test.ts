import { describe, expect, it } from 'vitest';
import { GLOSSARY, TERMS, annotate, termsIn } from './glossary';

describe('glossary', () => {
  it('tags the words the coach actually uses', () => {
    const runs = annotate('Pung it — that leaves you 2 away from Goulash. A run never comes off the table here.');
    expect(runs.filter((r) => r.term).map((r) => [r.text, r.term])).toEqual([
      ['Pung', 'pung'],
      ['Goulash', 'goulash'],
      ['run', 'chow'],
    ]);
    // The text survives intact.
    expect(runs.map((r) => r.text).join('')).toBe('Pung it — that leaves you 2 away from Goulash. A run never comes off the table here.');
  });

  it('prefers the longer phrase and does not fire inside words', () => {
    expect(termsIn('Honour pungs need two of: a dragon pung, the round wind, your own wind.')).toEqual(['honours', 'pung', 'dragons', 'roundWind', 'seatWind']);
    expect(termsIn('Wall out, nobody home.')).toEqual(['draw']);
    expect(termsIn('the walls of the room')).toEqual([]);
    expect(termsIn('a running total')).toEqual([]);
  });

  it('every term has a label, both glosses and at least one alias', () => {
    for (const t of TERMS) {
      const e = GLOSSARY[t];
      expect(e.label.length).toBeGreaterThan(0);
      expect(e.short.length).toBeGreaterThan(0);
      expect(e.long.length).toBeGreaterThan(e.short.length);
      expect(e.aliases.length).toBeGreaterThan(0);
    }
  });
});
