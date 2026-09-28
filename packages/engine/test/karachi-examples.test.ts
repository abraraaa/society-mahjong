/**
 * Every hand the ruleset deals has a worked example, and each one is what it says it is:
 * a complete hand of its pattern, announced under that pattern's name (or its alias's),
 * which the analyser leads with and can lay out in full.
 *
 * The ids come from the dealt specs, not the example table, so a pattern added without
 * an example fails here.
 */
import { describe, expect, it } from 'vitest';
import {
  analyseHand,
  guideTiles,
  karachi,
  KARACHI_ALIASES,
  KARACHI_EXAMPLE_TEXT,
  KARACHI_EXAMPLES,
  matchPatterns,
  type HandInput,
  type HandSpec,
  type MatchCtx,
  type Pattern,
  type TileKind,
  type Wind,
} from '../src/index';

const WINDS: readonly Wind[] = ['E', 'S', 'W', 'N'];

interface Dealt {
  readonly label: string;
  readonly roundWind: Wind;
  readonly spec: HandSpec;
}
const dealt = (label: string, roundWind: Wind, handInRound: number): Dealt => {
  const roundIndex = WINDS.indexOf(roundWind);
  return { label, roundWind, spec: karachi.handSpec({ roundWind, roundIndex, handInRound, handIndex: roundIndex * karachi.handsPerRound + handInRound }) };
};
/** Every spec the ruleset deals: the opening goulash, East's honour hand, South, West and North. */
const DEALT: readonly Dealt[] = [dealt('East hand 1', 'E', 0), dealt('East hand 2', 'E', 1), dealt('South', 'S', 0), dealt('West', 'W', 0), dealt('North', 'N', 0)];
const DEALT_IDS = new Set(DEALT.flatMap((d) => d.spec.patterns.map((p) => p.id)));

const examples = karachi.examples ?? {};
const aliases = karachi.aliases ?? {};

const concealed = (t: readonly TileKind[]): HandInput => ({ concealed: [...t], melds: [] });
/** Everything about a pattern that decides which hands it takes. */
const shapeOf = (p: Pattern) => ({ components: JSON.stringify(p.components), distinct: p.distinct, maxSuits: p.maxSuits, exposure: p.exposure, guard: p.guard });

describe('Karachi examples', () => {
  it("are the ruleset's own", () => {
    expect(karachi.examples).toBe(KARACHI_EXAMPLES);
    expect(karachi.aliases).toBe(KARACHI_ALIASES);
  });

  for (const { label, roundWind, spec } of DEALT) {
    for (const p of spec.patterns) {
      it(`${label}: ${p.id}`, () => {
        const example = examples[p.id];
        expect(example, `${p.id} has no example`).toBeDefined();
        const tiles = example!;
        expect(tiles).toHaveLength(14);
        // A hand someone could hold: no more than four of any tile.
        const copies = new Map<TileKind, number>();
        for (const k of tiles) copies.set(k, (copies.get(k) ?? 0) + 1);
        expect(Math.max(...copies.values())).toBeLessThanOrEqual(4);

        const alias = aliases[p.id];
        if (alias !== undefined) {
          // An alias may only stand for a pattern that takes exactly the same hands, so it can't hide a real mismatch.
          const named = spec.patterns.find((q) => q.id === alias);
          expect(named, `${alias} isn't dealt with ${p.id}`).toBeDefined();
          expect(shapeOf(p)).toEqual(shapeOf(named!));
        }

        const hand = concealed(tiles);
        for (const seatWind of WINDS) {
          const ctx: MatchCtx = { seatWind, roundWind };
          const at = `${p.id}, seat wind ${seatWind}`;
          expect(matchPatterns([p], hand, ctx, karachi.guards), at).not.toHaveLength(0);

          const first = matchPatterns(spec.patterns, hand, ctx, karachi.guards)[0]?.pattern.id;
          expect(first, at).toBe(alias ?? p.id);

          const lead = analyseHand(hand, spec.patterns, ctx, karachi.guards, { claims: karachi.claims }).candidates[0];
          expect({ id: lead?.patternId, away: lead?.away }, at).toEqual({ id: first, away: 0 });

          // Laid out against its own pattern alone: every tile held, no empty set, and exactly the example's tiles.
          const layout = analyseHand(hand, [p], ctx, karachi.guards, { claims: karachi.claims }).candidates[0]?.layout;
          expect(layout, at).toBeTruthy();
          const allHeld = layout!.every((g) => g.tiles.length > 0 && g.tiles.every((t) => t.held));
          expect(allHeld, at).toBe(true);
          expect(layout!.flatMap((g) => g.tiles.map((t) => t.kind)).sort(), at).toEqual([...tiles].sort());
        }
      });
    }
  }

  it('has no example for a hand the ruleset never deals', () => {
    expect(Object.keys(KARACHI_EXAMPLE_TEXT).filter((id) => !DEALT_IDS.has(id))).toEqual([]);
    expect(Object.keys(examples).filter((id) => !DEALT_IDS.has(id))).toEqual([]);
  });

  it('builds each example from its text', () => {
    expect(Object.keys(KARACHI_EXAMPLES)).toEqual(Object.keys(KARACHI_EXAMPLE_TEXT));
    for (const [id, text] of Object.entries(KARACHI_EXAMPLE_TEXT)) expect(KARACHI_EXAMPLES[id], id).toEqual(guideTiles(text));
  });

  it('only aliases a dealt hand to another dealt hand, one step', () => {
    for (const [from, to] of Object.entries(KARACHI_ALIASES)) {
      expect(DEALT_IDS.has(from), from).toBe(true);
      expect(DEALT_IDS.has(to), to).toBe(true);
      expect(to).not.toBe(from);
      expect(KARACHI_ALIASES[to], `${to} is itself an alias`).toBeUndefined();
    }
  });
});

describe('guideTiles', () => {
  it('reads guide notation, ignoring the bars between groups', () => {
    expect(guideTiles('1b | 9d E Wh')).toEqual(['s1', 'p9', 'WE', 'DW']);
    expect(guideTiles('  S W N | R G  9c ')).toEqual(['WS', 'WW', 'WN', 'DR', 'DG', 'm9']);
    expect(guideTiles('')).toEqual([]);
  });

  it("throws on a token it doesn't know", () => {
    for (const bad of ['0b', '10b', '1x', 'b1', 'SW', 'e', 'Wh2', 'F1', 's1']) expect(() => guideTiles(`1b ${bad}`), bad).toThrow(`bad tile ${bad}`);
  });
});
