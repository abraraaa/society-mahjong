import { describe, expect, it } from 'vitest';
import { DEFAULT_STAKES, falseMahjongPenalty, karachi, matchPatterns, scoreCantonese, scoreFlat, type HandInput, type MatchCtx, type Seat, type TileKind, type Wind, type WinInput } from '../src/index';

const hand = (concealed: TileKind[], melds: HandInput['melds'] = []): HandInput => ({ concealed, melds });

function win(h: HandInput, opts: { seat: Seat; dealer: Seat; round: Wind; seatWind: Wind; selfDrawn?: boolean; bonus?: TileKind[]; handIndex?: number }): WinInput {
  const ctx: MatchCtx = { seatWind: opts.seatWind, roundWind: opts.round };
  const progress = { roundWind: opts.round, roundIndex: 'ESWN'.indexOf(opts.round), handInRound: opts.handIndex === 0 ? 0 : 1, handIndex: opts.handIndex ?? 1 };
  const spec = karachi.handSpec(progress);
  return {
    seat: opts.seat,
    dealer: opts.dealer,
    hand: h,
    matches: matchPatterns(spec.patterns, h, ctx, karachi.guards),
    selfDrawn: opts.selfDrawn ?? false,
    ...(opts.selfDrawn ? {} : { discarder: ((opts.seat + 1) % 4) as Seat }),
    ctx,
    bonus: opts.bonus ?? [],
    wallRemaining: 30,
    handIndex: opts.handIndex ?? 1,
    progress,
    flags: { lastWallTile: false, robbedKong: false, afterKong: false, firstDiscard: false, heavenly: false },
  };
}

const eastHand = hand(['s1', 's2', 's3', 'p1', 'p2', 'p3', 'm1', 'm2', 'm3', 'WE', 'WE', 'WE', 'DR', 'DR']);

describe('Karachi flat stakes (East, South, North)', () => {
  it('East wins the East round: everyone pays double the stake', () => {
    const s = scoreFlat(win(eastHand, { seat: 0, dealer: 0, round: 'E', seatWind: 'E' }));
    expect(s.transfers.map((t) => t.amount)).toEqual([4000, 4000, 4000]);
    expect(s.total).toBe(12000);
  });
  it('a non-East winner: East pays double, the others pay the stake', () => {
    const s = scoreFlat(win(eastHand, { seat: 1, dealer: 0, round: 'E', seatWind: 'S' }));
    const byFrom = Object.fromEntries(s.transfers.map((t) => [t.from, t.amount]));
    expect(byFrom).toEqual({ 0: 4000, 2: 2000, 3: 2000 });
  });
  it('South is half of East and North is double', () => {
    const south = scoreFlat(win(eastHand, { seat: 1, dealer: 0, round: 'S', seatWind: 'S' }));
    const north = scoreFlat(win(eastHand, { seat: 1, dealer: 0, round: 'N', seatWind: 'S' }));
    expect(south.transfers.find((t) => t.from === 2)?.amount).toBe(1000);
    expect(north.transfers.find((t) => t.from === 2)?.amount).toBe(4000);
  });
  it('applies the own flower / season multiplier (provisional)', () => {
    // seat S is index 2: own flower F2 and own season S2
    const s = scoreFlat(win(eastHand, { seat: 1, dealer: 0, round: 'E', seatWind: 'S', bonus: ['F2', 'S2'] }));
    expect(s.transfers.find((t) => t.from === 2)?.amount).toBe(2000 * DEFAULT_STAKES.flowerMultiplier[2]);
  });
  it('false mahjong: the offender pays every other player', () => {
    expect(falseMahjongPenalty(2)).toEqual([
      { from: 2, to: 0, amount: 4000 },
      { from: 2, to: 1, amount: 4000 },
      { from: 2, to: 3, amount: 4000 },
    ]);
  });
  it('routes East, South and North wins to the flat stake and West to the calculator', () => {
    const flat = karachi.score(win(eastHand, { seat: 1, dealer: 0, round: 'N', seatWind: 'S' }));
    expect(flat.lines[0]?.id).toBe('stake');
    // seat S in a West round: an East pung would fail the goulash honour gate, so keep to suit pungs
    const goulash = hand(['s2', 's2', 's2', 'p5', 'p5', 'p5', 'm9', 'm9', 'm9', 's7', 's7', 's7', 'DR', 'DR']);
    const west = karachi.score(win(goulash, { seat: 1, dealer: 0, round: 'W', seatWind: 'S' }));
    expect(west.lines[0]?.id).toBe('mahjong');
  });
});

describe('Karachi Cantonese-style calculation (West and opening goulash)', () => {
  it('reproduces the tracker example: one revealed basic pung, win by discard, base 22, no doublers', () => {
    // Only the revealed pung contributes beyond the 20 for mahjong; everything else is chows and a plain pair
    const h = hand(['s4', 's5', 's6', 'p6', 'p7', 'p8', 'm2', 'm3', 'm4', 'p2', 'p2'], [{ type: 'pung', tiles: ['s3', 's3', 's3'], concealed: false, from: 2 }]);
    const w = win(h, { seat: 1, dealer: 0, round: 'W', seatWind: 'S' });
    // West is all goulash, so use the general four-sets shape for the arithmetic check
    w.matches[0] ?? (w as { matches: WinInput['matches'] }).matches;
    const s = scoreCantonese({ ...w, matches: matchPatterns([{ id: 'std', name: 'std', components: [{ c: 'set', of: 'any', n: 4 }, { c: 'pair' }] }], h, w.ctx) });
    expect(s.lines.find((l) => l.id === 'mahjong')?.value).toBe(20);
    expect(s.lines.find((l) => l.id === 'meld:s3')?.value).toBe(2);
    expect(s.transfers.map((t) => t.amount)).toEqual([22, 22, 22]);
  });
  it('doubles once per doubler: all pungs, three concealed, seat and round wind', () => {
    // seat S in round W: WS pung is the seat wind, WW pung is the round wind
    const h = hand(['p5', 'p5', 'p5', 'm9', 'm9', 'm9', 'WS', 'WS', 'WS', 'WW', 'WW', 'WW', 'DR', 'DR']);
    const s = scoreCantonese(win(h, { seat: 1, dealer: 0, round: 'W', seatWind: 'S' }));
    // base: 20 + 4 (concealed basic pung) + 8 + 8 + 8 (concealed major pungs) + 2 (dragon pair) = 50
    // doublers: all pungs 1, three+ concealed 1, seat wind 1, round wind 1 = 4 -> 50 * 16
    expect(s.transfers[0]?.amount).toBe(800);
    const ids = s.lines.map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(['allPungs', 'concealed3', 'seatWindPung', 'roundWindPung', 'pairDragons']));
  });
  it('scores the opening goulash of the East round with the calculator, later East hands flat', () => {
    const goulash = hand(['s2', 's2', 's2', 'p5', 'p5', 'p5', 'm9', 'm9', 'm9', 'WE', 'WE', 'WE', 'DR', 'DR']);
    const opening = karachi.score(win(goulash, { seat: 0, dealer: 0, round: 'E', seatWind: 'E', handIndex: 0 }));
    expect(opening.lines[0]?.id).toBe('mahjong');
    const later = karachi.score(win(eastHand, { seat: 0, dealer: 0, round: 'E', seatWind: 'E', handIndex: 1 }));
    expect(later.lines[0]?.id).toBe('stake');
  });
});
