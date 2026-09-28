import { describe, expect, it } from 'vitest';
import { karachi } from '@society/engine';
import { GLOSSARY } from './glossary';
import { generalTitlesOf, roundNote } from './goal';
import { TITLE_SHAPES, noteShapeOf, shapeOf, titleOf } from './shape';
import { NOTE_BUDGET, noteText } from './teach';
import { ROUNDS } from './test-games';
import { visibleLength } from './words';

/** Every hand spec the ruleset deals: the opening goulash, East's honour hands, South, the West goulash, North. */
const DEALT = Object.values(ROUNDS).map((p) => karachi.handSpec(p));

describe("a hand's footnote", () => {
  it('fits under a line for every hand the ruleset deals', () => {
    for (const spec of DEALT) {
      for (const title of new Set(spec.patterns.map(titleOf))) {
        const note = noteText({ label: title, text: noteShapeOf(title, spec.patterns) });
        expect(visibleLength(note), note).toBeLessThanOrEqual(NOTE_BUDGET);
        expect(noteShapeOf(title, spec.patterns), title).not.toBe('');
      }
    }
  });

  it('has a line of its own for exactly the titles whose hands differ', () => {
    const differing = new Set<string>();
    for (const spec of DEALT) {
      for (const title of new Set(spec.patterns.map(titleOf))) {
        const shapes = new Set(spec.patterns.filter((p) => titleOf(p) === title).map((p) => shapeOf(p.id, spec.patterns)));
        if (shapes.size > 1) differing.add(title);
      }
    }
    expect([...differing].sort()).toEqual(Object.keys(TITLE_SHAPES).sort());
  });

  it('reads the same made from one hand as from the whole round, so an example card and the bubble agree', () => {
    for (const spec of DEALT) {
      for (const p of spec.patterns) expect(noteShapeOf(titleOf(p), [p]), p.id).toBe(noteShapeOf(titleOf(p), spec.patterns));
    }
  });

  it('says it plainly: never "through", and no colon, which the footnote puts after the name', () => {
    for (const spec of DEALT) {
      for (const p of spec.patterns) {
        for (const shape of [shapeOf(p.id, spec.patterns), noteShapeOf(titleOf(p), spec.patterns)]) {
          expect(shape, p.id).not.toMatch(/\bthrough\b|:/);
        }
      }
    }
  });
});

describe("the round's and the flowers' footnotes", () => {
  it('fit under a line', () => {
    for (const kind of ['goulash', 'honour', 'noHonour', 'big']) {
      const round = roundNote(kind);
      expect(round, kind).not.toBeNull();
      expect(visibleLength(noteText(round!)), kind).toBeLessThanOrEqual(NOTE_BUDGET);
    }
    expect(visibleLength(noteText({ label: 'flowers', text: GLOSSARY.bonus.short }))).toBeLessThanOrEqual(NOTE_BUDGET);
  });

  it('say nothing for a kind of hand they have no words for', () => {
    expect(roundNote('toString')).toBeNull();
    expect(roundNote('riichi')).toBeNull();
  });

  it("name each round's everyday hands", () => {
    expect(DEALT.map((spec) => [spec.kind, generalTitlesOf(spec)])).toEqual([
      ['goulash', ['Goulash']],
      ['honour', ['Chow + 5 Honours', 'Pung + 5 Honours']],
      ['noHonour', ['Any Damn Hand']],
      ['goulash', ['Goulash']],
      ['big', []],
    ]);
  });
});
