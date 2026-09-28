/**
 * Which name a hand is announced under, and which the analyser leads with.
 *
 * Each round lists its patterns most specific first: the reducer announces the first
 * match, and the analyser breaks ties by the same order, so a finished hand leads with
 * the name it will be announced under. While a hand is still being built, the round's
 * general hand leads when a named one is only as close (the owner's decision).
 */
import { describe, expect, it } from 'vitest';
import { analyseHand, karachi, matchPatterns, type HandInput, type HandSpec, type MatchCtx, type TileKind, type Wind } from '../src/index';
import { KARACHI_FIXTURES, tiles } from './karachi-fixtures';

const WINDS: readonly Wind[] = ['E', 'S', 'W', 'N'];

const specFor = (roundWind: Wind, handInRound: number): HandSpec => {
  const roundIndex = WINDS.indexOf(roundWind);
  return karachi.handSpec({ roundWind, roundIndex, handInRound, handIndex: roundIndex * karachi.handsPerRound + handInRound });
};
/** Every spec the ruleset deals: the opening goulash, East's honour hand, South, West and North. */
const DEALT: readonly [string, HandSpec][] = [
  ['East hand 1', specFor('E', 0)],
  ['East hand 2', specFor('E', 1)],
  ['South', specFor('S', 0)],
  ['West', specFor('W', 0)],
  ['North', specFor('N', 0)],
];
const ROUND: Readonly<Record<'E' | 'S' | 'N', HandSpec>> = { E: specFor('E', 1), S: specFor('S', 0), N: specFor('N', 0) };

/** Engine notation: "s1 p2 m3 WE DR". */
const kinds = (text: string): TileKind[] => text.split(' ') as TileKind[];
const concealed = (t: readonly TileKind[]): HandInput => ({ concealed: [...t], melds: [] });

/** The name the reducer would announce: the first match in spec order. */
function announced(spec: HandSpec, t: readonly TileKind[], ctx: MatchCtx): string | undefined {
  return matchPatterns(spec.patterns, concealed(t), ctx, karachi.guards)[0]?.pattern.id;
}
/** The analyser's leading candidate, as the tutor and the bots read it. */
function leader(spec: HandSpec, t: readonly TileKind[], ctx: MatchCtx): { id: string | undefined; away: number | undefined } {
  const top = analyseHand(concealed(t), spec.patterns, ctx, karachi.guards, { claims: karachi.claims }).candidates[0];
  return { id: top?.patternId, away: top?.away };
}

interface Tie {
  readonly hand: string;
  readonly round: 'E' | 'S' | 'N';
  /** the id the reducer announces (a finished hand) or the analyser leads with (one being built) */
  readonly id: string;
  /** 0 for a finished hand */
  readonly away: number;
  readonly why: string;
}

/** The hands where the order decides the answer (every row gave a different answer before, except the last, which stays put). */
const TIES: readonly Tie[] = [
  {
    hand: 's1 s2 s3 p1 p2 p3 m1 m2 DW DW DW DG WE WS',
    round: 'E',
    id: 'karachi.east.chows.each.pungPair',
    away: 2,
    why: 'being built, Apple Blossom only as close: the general hand leads',
  },
  { hand: 's1 s2 s3 p1 p2 p3 m1 m2 m3 DW DW DW DG DG', round: 'E', id: 'karachi.east.appleBlossom', away: 0, why: 'finished: the named hand, not Chow + 5 Honours' },
  {
    hand: 's1 s2 s3 p1 p2 p3 m1 m2 m3 WE WE WE DR DR',
    round: 'E',
    id: 'karachi.east.hoveringAngel',
    away: 0,
    why: "the guide's Chow + 5 Honours example is also a Hovering Angel",
  },
  { hand: 's1 s1 s2 s2 s3 s3 p4 p4 p5 p5 p6 p6 m7 m7', round: 'S', id: 'karachi.south.dirtyPairs', away: 0, why: 'finished: Dirty Pairs, not Any Damn Hand' },
  { hand: 's1 s1 s1 p1 p1 p1 m1 m1 m1 WE WE WE WS WS', round: 'N', id: 'karachi.north.numbersPungs.pungPair', away: 0, why: 'listed before All Honour Hand, which also fits' },
  { hand: 'WE WE WE WS WS WS WW WW WW WN WN WN DR DR', round: 'N', id: 'karachi.north.fourBlessings', away: 0, why: 'listed before All Honour Hand, which also fits' },
  { hand: 'DG DG DG s2 s2 s2 s3 s3 s3 s4 s4 s4 s6 s6', round: 'N', id: 'karachi.north.imperialJade', away: 0, why: 'every Imperial Jade is also a Green Jade' },
  { hand: 'DR DG DW s3 s3 s3 p5 p5 p5 m7 m7 s4 WE WN', round: 'E', id: 'karachi.east.dragonfly', away: 2, why: 'strictly nearer, so the order never comes into it' },
];

describe('Karachi announcement order', () => {
  for (const t of TIES) {
    it(`${t.hand} in ${t.round}: ${t.id} (${t.why})`, () => {
      for (const seatWind of WINDS) {
        const ctx: MatchCtx = { seatWind, roundWind: t.round };
        const spec = ROUND[t.round];
        expect(leader(spec, kinds(t.hand), ctx)).toEqual({ id: t.id, away: t.away });
        expect(announced(spec, kinds(t.hand), ctx)).toBe(t.away === 0 ? t.id : undefined);
      }
    });
  }

  it("announces every catalogue fixture under its own name, except the guide's Chow + 5 Honours example", () => {
    const otherwise: Record<string, string | undefined> = {};
    for (const f of KARACHI_FIXTURES) {
      // Hand 2 of the fixture's round, as the catalogue test deals it.
      const spec = specFor(f.round, 1);
      const ctx: MatchCtx = { seatWind: 'S', roundWind: f.round };
      const id = announced(spec, tiles(f.hand), ctx);
      expect(leader(spec, tiles(f.hand), ctx)).toEqual({ id, away: 0 });
      if (id !== f.id) otherwise[f.id] = id;
    }
    // The one exemption the owner accepted. A second one appearing here is a real change in what gets announced.
    expect(otherwise).toEqual({ 'karachi.east.chows.each.pungPair': 'karachi.east.hoveringAngel' });
  });

  // The hands that were announced, or led, under another entry before the order was fixed.
  const NAMED: readonly [string, 'E' | 'N', string][] = [
    ['karachi.east.appleBlossom', 'E', '1b 2b 3b 1d 2d 3d 1c 2c 3c Wh Wh Wh G G'],
    ['karachi.east.appleBlossom.chows', 'E', '4b 5b 6b 2d 3d 4d 6c 7c 8c Wh Wh Wh G G'],
    ['karachi.east.hoveringAngel', 'E', '4b 5b 6b 2d 3d 4d 1c 2c 3c N N N R R'],
    ['karachi.east.windyWonders', 'E', '1b 2b 3b 1d 2d 3d 1c 2c 3c E E E S S'],
    ['karachi.east.windyChows', 'E', '4b 5b 6b 2d 3d 4d 6c 7c 8c E S W N W'],
    ['karachi.east.windyfly', 'E', '1b 1b 1b 4d 4d 4d 7c 7c 7c E S W N S'],
    ['karachi.north.imperialJade', 'N', 'G G G 2b 2b 2b 3b 3b 3b 4b 4b 4b 6b 6b'],
    ['karachi.north.fourBlessings', 'N', 'E E E S S S W W W N N N R R'],
  ];
  for (const [id, round, hand] of NAMED) {
    it(`announces and leads with ${id}`, () => {
      const ctx: MatchCtx = { seatWind: 'S', roundWind: round };
      expect(announced(ROUND[round], tiles(hand), ctx)).toBe(id);
      expect(leader(ROUND[round], tiles(hand), ctx)).toEqual({ id, away: 0 });
    });
  }

  // Chow + 5 Honours and Pung + 5 Honours, one set per suit with the four winds, are exactly Windy Chows and Windyfly.
  const ALIASES: readonly [string, string, string][] = [
    ['karachi.east.chows.each.news', 'karachi.east.windyChows', '4b 5b 6b 2d 3d 4d 6c 7c 8c E S W N W'],
    ['karachi.east.pungs.each.news', 'karachi.east.windyfly', '2b 2b 2b 5d 5d 5d 8c 8c 8c E S W N S'],
  ];
  for (const [general, named, hand] of ALIASES) {
    it(`announces a ${general} hand as ${named}`, () => {
      const ctx: MatchCtx = { seatWind: 'S', roundWind: 'E' };
      const pattern = ROUND.E.patterns.find((p) => p.id === general)!;
      expect(matchPatterns([pattern], concealed(tiles(hand)), ctx, karachi.guards)).not.toHaveLength(0);
      expect(announced(ROUND.E, tiles(hand), ctx)).toBe(named);
      expect(leader(ROUND.E, tiles(hand), ctx)).toEqual({ id: named, away: 0 });
    });
  }
});

describe('Karachi display titles', () => {
  it('shows Lilly of the Valley without "(Monty ver)", keeping its id and name', () => {
    const lilly = ROUND.N.patterns.find((p) => p.id === 'karachi.north.lillyOfTheValley')!;
    expect(lilly.localName).toBe('Lilly of the Valley');
    expect(lilly.name).toBe('Lilly of the Valley (Monty ver)');
  });

  it('gives no two patterns in one round the same title, apart from the families meant to share one', () => {
    const shared: Record<string, Record<string, number>> = {};
    for (const [label, spec] of DEALT) {
      const counts: Record<string, number> = {};
      for (const p of spec.patterns) {
        const title = p.localName ?? p.name;
        counts[title] = (counts[title] ?? 0) + 1;
      }
      shared[label] = Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 1));
    }
    expect(shared).toEqual({
      'East hand 1': {},
      'East hand 2': { 'Chow + 5 Honours': 4, 'Pung + 5 Honours': 4, 'Apple Blossom': 2 },
      South: {},
      West: {},
      North: { 'Numbers Pungs': 2 },
    });
  });
});
