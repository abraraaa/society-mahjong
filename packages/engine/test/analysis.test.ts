import { describe, expect, it } from 'vitest';
import {
  analyseHand,
  coverPattern,
  countOf,
  isHonourTile,
  isWindTile,
  karachi,
  matchPattern,
  standardPattern,
  type HandInput,
  type MatchCtx,
  type Pattern,
  type PatternCandidate,
  type TileKind,
} from '../src/index';

const hand = (concealed: TileKind[], melds: HandInput['melds'] = []): HandInput => ({ concealed, melds });
const ctxFor = (roundWind: MatchCtx['roundWind']): MatchCtx => ({ seatWind: 'E', roundWind });

/** The patterns Karachi allows in a given round, past the opening goulash. */
const roundPatterns = (roundWind: MatchCtx['roundWind']): readonly Pattern[] =>
  karachi.handSpec({ roundWind, roundIndex: 0, handInRound: 1, handIndex: 1 }).patterns;

const analyse = (tiles: TileKind[], roundWind: MatchCtx['roundWind'], melds: HandInput['melds'] = []) =>
  analyseHand(hand(tiles, melds), roundPatterns(roundWind), ctxFor(roundWind), karachi.guards);

const find = (candidates: readonly PatternCandidate[], id: string): PatternCandidate => {
  const found = candidates.find((c) => c.patternId === id);
  expect(found, `no candidate ${id}`).toBeDefined();
  return found!;
};

/** Windy Chows: one chow per suit plus NEWS with a wind paired. */
const WINDY_CHOWS: TileKind[] = ['m1', 'm2', 'm3', 'p4', 'p5', 'p6', 's7', 's8', 's9', 'WE', 'WS', 'WW', 'WN', 'WN'];
/** Sind Club Hand: a fixed thirteen plus a second 1 characters. */
const SIND_CLUB: TileKind[] = ['DR', 'DG', 'DW', 'WE', 'WS', 'WW', 'WN', 's2', 's5', 'p5', 'm8', 'm7', 'm1', 'm1'];

describe('coverPattern', () => {
  it('covers every tile of a hand that already matches', () => {
    const std = standardPattern(4);
    const h = hand(['m1', 'm2', 'm3', 'p5', 'p5', 'p5', 's7', 's8', 's9', 'WE', 'WE', 'WE', 'DR', 'DR']);
    const cover = coverPattern(std, h, ctxFor('E'));
    expect(cover.covered).toBe(14);
    expect(cover.size).toBe(14);
    expect(cover.solutions[0]!.missing).toHaveLength(0);
  });

  it('names the tile a waiting hand is short of', () => {
    const std = standardPattern(4);
    const cover = coverPattern(std, hand(['m1', 'm2', 'm3', 'p5', 'p5', 'p5', 's7', 's8', 's9', 'WE', 'WE', 'WE', 'DR']), ctxFor('E'));
    expect(cover.covered).toBe(13);
    const missing = new Set(cover.solutions.flatMap((s) => s.missing));
    expect(missing.has('DR')).toBe(true);
  });

  it('counts a kong meld at its real length', () => {
    const cover = coverPattern(
      standardPattern(4),
      hand(['m1', 'm2', 'm3', 's7', 's8', 's9', 'DR', 'DR', 'p1', 'p2', 'p3'], [
        { type: 'kong', tiles: ['WE', 'WE', 'WE', 'WE'], concealed: true },
      ]),
      ctxFor('E'),
    );
    expect(cover.size).toBe(15);
    expect(cover.covered).toBe(15);
  });

  it('rules out a concealed-only pattern once a meld is exposed', () => {
    const dirtyPairs = roundPatterns('S').find((p) => p.id === 'karachi.south.dirtyPairs')!;
    const exposed = hand(['p1', 'p1', 's3', 's3', 's5', 's5', 'm2', 'm2', 'm4', 'm4', 'm6'], [
      { type: 'pung', tiles: ['p9', 'p9', 'p9'], concealed: false, from: 1 },
    ]);
    expect(coverPattern(dirtyPairs, exposed, ctxFor('S')).reachable).toBe(false);
  });
});

describe('analyseHand', () => {
  it('reports away 0 for the pattern a complete hand matches', () => {
    const analysis = analyse(WINDY_CHOWS, 'E');
    const windyChows = find(analysis.candidates, 'karachi.east.windyChows');
    expect(windyChows.away).toBe(0);
    expect(analysis.candidates[0]!.away).toBe(0);
    expect(windyChows.needs).toEqual([]);
    // The relaxed search and the matcher must agree about what counts as complete.
    expect(matchPattern(roundPatterns('E').find((p) => p.id === 'karachi.east.windyChows')!, hand(WINDY_CHOWS), ctxFor('E')).length).toBeGreaterThan(0);
  });

  it('reports away 1 and names the missing tile', () => {
    // Sind Club Hand with one of its pair swapped for a useless 2 characters.
    const oneOff: TileKind[] = [...SIND_CLUB.slice(0, 13), 'm2'];
    const sind = find(analyse(oneOff, 'N').candidates, 'karachi.north.sindClubHand');
    expect(sind.away).toBe(1);
    expect(sind.needs).toEqual(['m1']);
  });

  it('ranks the closest pattern first', () => {
    const analysis = analyse(SIND_CLUB, 'N');
    expect(analysis.candidates[0]!.patternId).toBe('karachi.north.sindClubHand');
    expect(analysis.candidates[0]!.away).toBe(0);
  });

  it('leaves out patterns the melds have shut out', () => {
    // A chow meld can never serve a pungs-only goulash.
    const analysis = analyseHand(
      hand(['m1', 'm1', 'm1', 'p2', 'p2', 'p2', 's3', 's3', 's3', 's5', 's5'], [
        { type: 'chow', tiles: ['p6', 'p7', 'p8'], concealed: false, from: 3 },
      ]),
      roundPatterns('W'),
      ctxFor('W'),
      karachi.guards,
    );
    expect(analysis.candidates).toEqual([]);
    expect(analysis.bestDiscard).not.toBeNull();
  });

  it('counts an exposed meld towards the hand it serves', () => {
    // Three chows, one per suit, with the honour pung already on the table.
    const analysis = analyse(['m1', 'm2', 'm3', 'p4', 'p5', 'p6', 's7', 's8', 's9', 'WS', 'WS'], 'E', [
      { type: 'pung', tiles: ['WE', 'WE', 'WE'], concealed: false, from: 3 },
    ]);
    const leader = analysis.candidates[0]!;
    expect(leader.away).toBe(0);
    expect(leader.using).toContain('WE');
    expect(analysis.spare).toEqual([]);
    expect(analysis.bestDiscard).toBeNull();
  });

  it('respects the ruleset guard when calling a hand complete', () => {
    // Four pungs and a pair, but its single dragon pung meets only one of the two
    // honour conditions the goulash guard demands, so it is not a win.
    const tiles: TileKind[] = ['DR', 'DR', 'DR', 'm1', 'm1', 'm1', 'p2', 'p2', 'p2', 's3', 's3', 's3', 's5', 's5'];
    const goulash = roundPatterns('W')[0]!;
    expect(matchPattern(goulash, hand(tiles), ctxFor('W'), karachi.guards)).toHaveLength(0);
    expect(find(analyse(tiles, 'W').candidates, 'karachi.goulash').away).toBeGreaterThan(0);
  });
});

describe('what the round says about honours', () => {
  // The bug this layer exists to fix: the old tutor told East players to throw a
  // lone wind, when East is the one round whose hands need five honours.
  const eastHand: TileKind[] = ['m1', 'm2', 'm3', 'p4', 'p5', 'p9', 's2', 's7', 'WE', 'WS', 'WW', 'WN', 'DR', 'DG'];

  it('keeps four lone winds in the East round', () => {
    const analysis = analyse(eastHand, 'E');
    for (const wind of ['WE', 'WS', 'WW', 'WN'] as const) {
      expect(analysis.keep).toContain(wind);
      expect(analysis.spare).not.toContain(wind);
    }
    expect(analysis.spare.every((k) => !isWindTile(k))).toBe(true);
    expect(analysis.bestDiscard).not.toBeNull();
    expect(isWindTile(analysis.bestDiscard!)).toBe(false);
  });

  it('treats honours as dead weight in the South round', () => {
    const analysis = analyse(['m1', 'm2', 'm3', 'p4', 'p5', 'p6', 's7', 's8', 's9', 'p1', 'p1', 'WE', 'WS', 'DR'], 'S');
    for (const honour of ['WE', 'WS', 'DR'] as const) {
      expect(analysis.spare).toContain(honour);
      expect(analysis.keep).not.toContain(honour);
    }
    expect(analysis.bestDiscard).not.toBeNull();
    expect(isHonourTile(analysis.bestDiscard!)).toBe(true);
  });

  it('ranks a part-built big hand above the rest in the North round', () => {
    // 1-5 bamboo with all seven honours: two tiles short of 1-7 plus 7 Honors.
    const tiles: TileKind[] = ['s1', 's2', 's3', 's4', 's5', 'WE', 'WS', 'WW', 'WN', 'DR', 'DG', 'DW', 'm9', 'm9'];
    const analysis = analyse(tiles, 'N');
    const leader = analysis.candidates[0]!;
    expect(leader.patternId).toBe('karachi.north.oneToSevenPlusSevenHonours');
    expect(leader.away).toBe(2);
    expect(leader.needs).toEqual(['s6', 's7']);
    expect(analysis.candidates.slice(1).every((c) => c.away > leader.away)).toBe(true);
    expect(leader.using).not.toContain('m9');
    // `spare` hedges across the leading candidates, so narrowing it to the leader
    // alone is what strands the two 9 characters.
    const committed = analyseHand(hand(tiles), roundPatterns('N'), ctxFor('N'), karachi.guards, { topN: 1 });
    expect(committed.spare).toEqual(['m9', 'm9']);
  });
});

describe('bestDiscard', () => {
  const cases: readonly { round: MatchCtx['roundWind']; tiles: TileKind[] }[] = [
    { round: 'E', tiles: ['m1', 'm2', 'm3', 'p4', 'p5', 'p9', 's2', 's7', 'WE', 'WS', 'WW', 'WN', 'DR', 'DG'] },
    { round: 'S', tiles: ['m1', 'm2', 'm3', 'p4', 'p5', 'p6', 's7', 's8', 's9', 'p1', 'p1', 'WE', 'WS', 'DR'] },
    { round: 'N', tiles: ['s1', 's2', 's3', 's4', 's5', 'WE', 'WS', 'WW', 'WN', 'DR', 'DG', 'DW', 'm9', 'm9'] },
    { round: 'W', tiles: ['m1', 'm1', 'm1', 'p4', 'p4', 'p5', 's7', 's7', 's7', 'WE', 'WE', 'WE', 'DR', 'DG'] },
  ];

  it('never throws a tile the leading candidate is counting on', () => {
    for (const { round, tiles } of cases) {
      const analysis = analyse(tiles, round);
      const discard = analysis.bestDiscard;
      expect(discard, `${round} round`).not.toBeNull();
      const leader = analysis.candidates[0]!;
      // Copies beyond what the leader needs are fair game, the ones it uses are not.
      expect(countOf(leader.usingConcealed, discard!)).toBeLessThan(countOf(tiles, discard!));
    }
  });

  it('prefers a tile no leading candidate wants at all', () => {
    const analysis = analyse(['s1', 's2', 's3', 's4', 's5', 'WE', 'WS', 'WW', 'WN', 'DR', 'DG', 'DW', 'm9', 'm9'], 'N');
    expect(analysis.bestDiscard).toBe('m9');
    expect(analysis.candidates[0]!.using).not.toContain('m9');
  });

  it('returns null when every tile is spoken for', () => {
    expect(analyse(WINDY_CHOWS, 'E').bestDiscard).toBeNull();
  });

  it('still advises when nothing is reachable', () => {
    // No pattern survives a chow meld in a goulash round, but the player must still
    // discard something, so the isolation tie-break picks the loosest tile.
    const analysis = analyseHand(
      hand(['m1', 'm1', 'm1', 'p2', 'p2', 'p2', 's3', 's3', 's3', 's5', 'DG'], [
        { type: 'chow', tiles: ['p6', 'p7', 'p8'], concealed: false, from: 3 },
      ]),
      roundPatterns('W'),
      ctxFor('W'),
      karachi.guards,
    );
    expect(analysis.candidates).toEqual([]);
    expect(analysis.bestDiscard).toBe('DG');
  });
});

describe('ratings', () => {
  it('scores every concealed kind, least useful first', () => {
    const analysis = analyse(['m1', 'm2', 'm3', 'p4', 'p5', 'p9', 's2', 's7', 'WE', 'WS', 'WW', 'WN', 'DR', 'DG'], 'E');
    expect(analysis.ratings.map((r) => r.kind).sort()).toEqual([...new Set(['m1', 'm2', 'm3', 'p4', 'p5', 'p9', 's2', 's7', 'WE', 'WS', 'WW', 'WN', 'DR', 'DG'])].sort());
    for (let i = 1; i < analysis.ratings.length; i++) {
      expect(analysis.ratings[i]!.usefulness).toBeGreaterThanOrEqual(analysis.ratings[i - 1]!.usefulness);
    }
    const winds = analysis.ratings.filter((r) => isWindTile(r.kind));
    expect(winds.every((r) => r.serves.length > 0)).toBe(true);
  });
});

describe('performance', () => {
  it('analyses a full hand against every round in well under the frame budget', () => {
    const tiles: TileKind[] = ['m1', 'm3', 'm5', 'p2', 'p4', 'p7', 's1', 's5', 's9', 'WE', 'WS', 'DR', 'DG', 'DW'];
    for (const round of ['E', 'S', 'W', 'N'] as const) analyse(tiles, round);
    const start = performance.now();
    for (const round of ['E', 'S', 'W', 'N'] as const) {
      const analysis = analyse(tiles, round);
      expect(analysis.candidates.length).toBeGreaterThan(0);
    }
    // Generous, so a loaded CI box does not make this flaky; the real figure is
    // around 15ms for the widest round.
    expect(performance.now() - start).toBeLessThan(250);
  });

  it('is deterministic', () => {
    const tiles: TileKind[] = ['m1', 'm3', 'm5', 'p2', 'p4', 'p7', 's1', 's5', 's9', 'WE', 'WS', 'DR', 'DG', 'DW'];
    expect(JSON.stringify(analyse(tiles, 'E'))).toBe(JSON.stringify(analyse(tiles, 'E')));
  });
});
