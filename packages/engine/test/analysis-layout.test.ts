import { describe, expect, it } from 'vitest';
import { ALL_TILE_KINDS, analyseHand, createRng, isBonusTile, karachi, matchPattern, sortTiles, type GameProgress, type TileKind } from '../src/index';

/**
 * The lay-out each candidate carries is what the table draws as the player's
 * nearest winning hand, so it has to agree with everything else the analysis
 * says: the tiles it marks held are the ones the plan protects, the tiles it
 * marks needed number exactly `away`, and filled in it is a real win.
 */
const ROUNDS: GameProgress[] = [
  { roundWind: 'E', roundIndex: 0, handInRound: 0, handIndex: 0 },
  { roundWind: 'E', roundIndex: 0, handInRound: 1, handIndex: 1 },
  { roundWind: 'S', roundIndex: 1, handInRound: 0, handIndex: 4 },
  { roundWind: 'W', roundIndex: 2, handInRound: 0, handIndex: 8 },
  { roundWind: 'N', roundIndex: 3, handInRound: 0, handIndex: 12 },
];

const SUITS_AND_HONOURS = ALL_TILE_KINDS.filter((k) => !isBonusTile(k));

function randomHand(seed: string, size: number): TileKind[] {
  const rng = createRng(seed);
  const wall = SUITS_AND_HONOURS.flatMap((k) => [k, k, k, k]);
  const hand: TileKind[] = [];
  for (let i = 0; i < size; i++) hand.push(wall.splice(rng.int(wall.length), 1)[0]!);
  return sortTiles(hand);
}

describe('the nearest lay-out', () => {
  for (const progress of ROUNDS) {
    it(`agrees with the analysis in ${progress.roundWind} hand ${progress.handInRound + 1}`, () => {
      const spec = karachi.handSpec(progress);
      const ctx = { seatWind: 'S' as const, roundWind: progress.roundWind };
      let checked = 0;
      for (let i = 0; i < 40; i++) {
        const concealed = randomHand(`layout-${progress.roundWind}-${progress.handInRound}-${i}`, 13 + (i % 2));
        const analysis = analyseHand({ concealed, melds: [] }, spec.patterns, ctx, karachi.guards, { claims: karachi.claims, limit: 3 });
        for (const c of analysis.candidates) {
          if (!c.layout || c.approximate) continue;
          const tiles = c.layout.flatMap((g) => g.tiles);
          expect(sortTiles(tiles.filter((t) => t.held).map((t) => t.kind))).toEqual(sortTiles([...c.usingConcealed]));
          expect(tiles.filter((t) => !t.held).length, `${c.patternId} for ${concealed.join(' ')}`).toBe(c.away);
          expect(c.layout.every((g) => g.tiles.length > 0)).toBe(true);
          // An open group has nothing held; a group with something held is never open.
          for (const g of c.layout) if (g.tiles.some((t) => t.held)) expect(g.open).toBe(false);
          // Filled in, it's a winning hand of that very pattern.
          const pattern = spec.patterns.find((p) => p.id === c.patternId)!;
          expect(matchPattern(pattern, { concealed: tiles.map((t) => t.kind), melds: [] }, ctx, karachi.guards).length, `${c.patternId} filled in`).toBeGreaterThan(0);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(20);
    });
  }

  it('is deterministic', () => {
    const concealed = randomHand('layout-same', 13);
    const spec = karachi.handSpec(ROUNDS[1]!);
    const run = () =>
      analyseHand({ concealed, melds: [] }, spec.patterns, { seatWind: 'S', roundWind: 'E' }, karachi.guards, { claims: karachi.claims }).candidates.map((c) => c.layout);
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});
