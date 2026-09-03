import { describe, expect, it } from 'vitest';
import { matchPattern, standardPattern, type HandInput, type Pattern, type TileKind, type MatchCtx } from '../src/index';

const ctx: MatchCtx = { seatWind: 'E', roundWind: 'E' };
const hand = (concealed: TileKind[], melds: HandInput['melds'] = []): HandInput => ({ concealed, melds });

describe('standard pattern', () => {
  const std = standardPattern(4);
  it('matches four sets and a pair', () => {
    const sols = matchPattern(std, hand(['m1', 'm2', 'm3', 'p5', 'p5', 'p5', 's7', 's8', 's9', 'WE', 'WE', 'WE', 'DR', 'DR']), ctx);
    expect(sols.length).toBeGreaterThan(0);
  });
  it('matches with exposed melds', () => {
    const sols = matchPattern(
      std,
      hand(['m1', 'm2', 'm3', 's7', 's8', 's9', 'DR', 'DR'], [
        { type: 'pung', tiles: ['p5', 'p5', 'p5'], concealed: false, from: 1 },
        { type: 'kong', tiles: ['WE', 'WE', 'WE', 'WE'], concealed: true },
      ]),
      ctx,
    );
    expect(sols.length).toBeGreaterThan(0);
    expect(sols[0]!.groups.filter((g) => g.fromMeld)).toHaveLength(2);
  });
  it('rejects a non-winning hand', () => {
    expect(matchPattern(std, hand(['m1', 'm2', 'm4', 'p5', 'p5', 'p5', 's7', 's8', 's9', 'WE', 'WE', 'WE', 'DR', 'DR']), ctx)).toHaveLength(0);
  });
  it('finds multiple decompositions', () => {
    // 111 222 333 pattern can be read as three pungs or three chows
    const sols = matchPattern(std, hand(['m1', 'm1', 'm1', 'm2', 'm2', 'm2', 'm3', 'm3', 'm3', 'p4', 'p5', 'p6', 'WE', 'WE']), ctx);
    expect(sols.length).toBeGreaterThanOrEqual(2);
  });
  it('matches a 16 tile hand with five sets', () => {
    const sols = matchPattern(
      standardPattern(5),
      hand(['m1', 'm2', 'm3', 'p5', 'p5', 'p5', 's7', 's8', 's9', 'WE', 'WE', 'WE', 'DR', 'DR', 's2', 's3', 's4']),
      ctx,
    );
    expect(sols.length).toBeGreaterThan(0);
  });
});

describe('named patterns', () => {
  const windyChows: Pattern = {
    id: 'windy-chows',
    name: 'Windy Chows',
    components: [
      { c: 'set', of: 'chow', filter: { suit: '$X' } },
      { c: 'set', of: 'chow', filter: { suit: '$Y' } },
      { c: 'set', of: 'chow', filter: { suit: '$Z' } },
      { c: 'each', kinds: ['WE', 'WS', 'WW', 'WN'] },
      { c: 'tiles', n: 1, filter: { wind: true } },
    ],
    distinct: [['$X', '$Y', '$Z']],
  };
  it('matches Windy Chows with one chow per suit', () => {
    expect(matchPattern(windyChows, hand(['m1', 'm2', 'm3', 'p4', 'p5', 'p6', 's7', 's8', 's9', 'WE', 'WS', 'WW', 'WN', 'WN']), ctx).length).toBeGreaterThan(0);
  });
  it('rejects Windy Chows when two chows share a suit', () => {
    expect(matchPattern(windyChows, hand(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 's7', 's8', 's9', 'WE', 'WS', 'WW', 'WN', 'WN']), ctx)).toHaveLength(0);
  });

  const sevenPairs: Pattern = { id: 'seven-pairs', name: 'Seven Pairs', components: [{ c: 'pair', n: 7 }], exposure: 'concealed' };
  it('matches seven pairs', () => {
    expect(matchPattern(sevenPairs, hand(['m1', 'm1', 'p2', 'p2', 's3', 's3', 'WE', 'WE', 'DR', 'DR', 'm9', 'm9', 's5', 's5']), ctx).length).toBe(1);
  });

  const crochet: Pattern = { id: 'crochet', name: 'Crochet', components: [{ c: 'knit', n: 4 }, { c: 'pair', filter: { suitTile: true } }] };
  it('matches Crochet (four knitted sets and a pair)', () => {
    expect(matchPattern(crochet, hand(['m1', 'p1', 's1', 'm4', 'p4', 's4', 'm7', 'p7', 's7', 'm9', 'p9', 's9', 'p2', 'p2']), ctx).length).toBe(1);
  });

  const crazyChows: Pattern = { id: 'crazy-chows', name: 'Crazy Chows', components: [{ c: 'mixedSeq', n: 4, order: '$O' }, { c: 'mixedPair' }] };
  it('matches Crazy Chows with a consistent suit order', () => {
    expect(matchPattern(crazyChows, hand(['m1', 'p2', 's3', 'm4', 'p5', 's6', 'm2', 'p3', 's4', 'm7', 'p8', 's9', 'm5', 's5']), ctx).length).toBeGreaterThan(0);
  });
  it('rejects Crazy Chows with inconsistent suit order', () => {
    expect(matchPattern(crazyChows, hand(['m1', 'p2', 's3', 'p4', 'm5', 's6', 'm2', 'p3', 's4', 'm7', 'p8', 's9', 'm5', 's5']), ctx)).toHaveLength(0);
  });

  const runPungPair: Pattern = {
    id: 'run-pung-pair',
    name: 'Run, Pung, Pair',
    components: [
      { c: 'run', from: 1, to: 9, suit: '$X' },
      { c: 'set', of: 'pung', filter: { suit: '$X' } },
      { c: 'pair', filter: { suit: '$X' } },
    ],
  };
  it('matches Run, Pung, Pair in one suit', () => {
    expect(matchPattern(runPungPair, hand(['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's5', 's5', 's5', 's2', 's2']), ctx).length).toBe(1);
  });
  it('rejects Run, Pung, Pair across suits', () => {
    expect(matchPattern(runPungPair, hand(['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 'm5', 'm5', 'm5', 's2', 's2']), ctx)).toHaveLength(0);
  });

  const thirteenOrphans: Pattern = {
    id: 'thirteen-orphans',
    name: 'Thirteen Orphans',
    components: [
      { c: 'each', kinds: ['m1', 'm9', 'p1', 'p9', 's1', 's9', 'WE', 'WS', 'WW', 'WN', 'DR', 'DG', 'DW'] },
      { c: 'tiles', n: 1, filter: { kinds: ['m1', 'm9', 'p1', 'p9', 's1', 's9', 'WE', 'WS', 'WW', 'WN', 'DR', 'DG', 'DW'] } },
    ],
    exposure: 'concealed',
  };
  it('matches thirteen orphans', () => {
    expect(matchPattern(thirteenOrphans, hand(['m1', 'm9', 'p1', 'p9', 's1', 's9', 'WE', 'WS', 'WW', 'WN', 'DR', 'DG', 'DW', 'DG']), ctx).length).toBe(1);
  });
});
