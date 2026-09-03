import { describe, expect, it } from 'vitest';
import { karachi, matchPatterns, type HandInput, type MatchCtx, type TileKind } from '../src/index';

const hand = (concealed: TileKind[], melds: HandInput['melds'] = []): HandInput => ({ concealed, melds });
const east: MatchCtx = { seatWind: 'E', roundWind: 'E' };
const spec = (round: 'E' | 'S' | 'W' | 'N', handInRound = 1) =>
  karachi.handSpec({ roundWind: round, roundIndex: 'ESWN'.indexOf(round), handInRound, handIndex: 0 });
const wins = (round: 'E' | 'S' | 'W' | 'N', h: HandInput, ctx = east, handInRound = 1) =>
  matchPatterns(spec(round, handInRound).patterns, h, ctx, karachi.guards).map((m) => m.pattern.id);

describe('Karachi hand schedule', () => {
  it('opens East with a goulash then honour hands', () => {
    expect(spec('E', 0).kind).toBe('goulash');
    expect(spec('E', 1).kind).toBe('honour');
  });
  it('makes every West hand a goulash with a three tile exchange', () => {
    const s = spec('W', 2);
    expect(s.kind).toBe('goulash');
    expect(s.preplay?.[0]).toEqual({ type: 'exchange', count: 3, order: ['right', 'across', 'left'] });
  });
});

describe('Karachi East', () => {
  it('accepts three chows one per suit plus NEWS with a pair (Windy Chows)', () => {
    const ids = wins('E', hand(['m1', 'm2', 'm3', 'p4', 'p5', 'p6', 's7', 's8', 's9', 'WE', 'WS', 'WW', 'WN', 'WN']));
    expect(ids).toContain('karachi.east.chows.each.news');
    expect(ids).toContain('karachi.east.windyChows');
  });
  it('accepts three clean pungs plus an honour pung and honour pair', () => {
    const ids = wins('E', hand(['m1', 'm1', 'm1', 'm4', 'm4', 'm4', 'm7', 'm7', 'm7', 'DR', 'DR', 'DR', 'WE', 'WE']));
    expect(ids).toContain('karachi.east.pungs.clean.pungPair');
  });
  it('does not read two chows in one suit as the general three-chow form', () => {
    const ids = wins('E', hand(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 's7', 's8', 's9', 'WE', 'WS', 'WW', 'WN', 'WN']));
    expect(ids.filter((id) => id.startsWith('karachi.east.chows.'))).toHaveLength(0);
    // ...but it is a legal Karachi hand: a mixed 1-9 run plus NEWS with a wind paired is Khalida's Hand
    expect(ids).toContain('karachi.east.khalidas');
  });
  it('rejects a mix of chows and pungs', () => {
    expect(wins('E', hand(['m1', 'm2', 'm3', 'p4', 'p4', 'p4', 's7', 's8', 's9', 'WE', 'WS', 'WW', 'WN', 'WN']))).toHaveLength(0);
  });
  it('accepts Apple Blossom and rejects it with the wrong dragon pair', () => {
    const blossom = hand(['m1', 'm2', 'm3', 'p1', 'p2', 'p3', 's1', 's2', 's3', 'DW', 'DW', 'DW', 'DG', 'DG']);
    expect(wins('E', blossom)).toContain('karachi.east.appleBlossom');
    const mixed = hand(['m1', 'p2', 's3', 'p4', 's5', 'm6', 's7', 'm8', 'p9', 'DW', 'DW', 'DW', 'DG', 'DG']);
    expect(wins('E', mixed)).toContain('karachi.east.appleBlossom');
    const wrongPair = hand(['m1', 'm2', 'm3', 'p1', 'p2', 'p3', 's1', 's2', 's3', 'DW', 'DW', 'DW', 'DR', 'DR']);
    expect(wins('E', wrongPair)).not.toContain('karachi.east.appleBlossom');
  });
  it("requires Pinky's Hand to use the same four-tile run in every suit", () => {
    expect(wins('E', hand(['m1', 'm2', 'm3', 'm4', 'p5', 'p6', 'p7', 'p8', 's2', 's3', 's4', 's5', 'WE', 'WE']))).not.toContain('karachi.east.pinkys');
    expect(wins('E', hand(['m1', 'm2', 'm3', 'm4', 'p1', 'p2', 'p3', 'p4', 's1', 's2', 's3', 's4', 'WE', 'WE']))).toContain('karachi.east.pinkys');
  });
});

describe('Karachi goulash', () => {
  it('accepts four suit pungs and a pair', () => {
    expect(wins('E', hand(['m1', 'm1', 'm1', 'p4', 'p4', 'p4', 's7', 's7', 's7', 'm9', 'm9', 'm9', 'WE', 'WE']), east, 0)).toContain('karachi.goulash');
  });
  it('rejects a single honour pung with only one condition met', () => {
    // dragon pung alone: one condition
    expect(wins('E', hand(['m1', 'm1', 'm1', 'p4', 'p4', 'p4', 's7', 's7', 's7', 'DR', 'DR', 'DR', 'WE', 'WE']), east, 0)).toHaveLength(0);
  });
  it('accepts honour pungs once two conditions are met', () => {
    // East seat in an East round: an East pung meets round wind and seat wind
    expect(wins('E', hand(['m1', 'm1', 'm1', 'p4', 'p4', 'p4', 'WE', 'WE', 'WE', 'DR', 'DR', 'DR', 's2', 's2']), east, 0)).toContain('karachi.goulash');
    // South seat in an East round with a South pung and a dragon pung
    expect(wins('E', hand(['m1', 'm1', 'm1', 'p4', 'p4', 'p4', 'WS', 'WS', 'WS', 'DR', 'DR', 'DR', 's2', 's2']), { seatWind: 'S', roundWind: 'E' }, 0)).toContain('karachi.goulash');
    // South seat in an East round with a West pung and a dragon pung: only one condition
    expect(wins('E', hand(['m1', 'm1', 'm1', 'p4', 'p4', 'p4', 'WW', 'WW', 'WW', 'DR', 'DR', 'DR', 's2', 's2']), { seatWind: 'S', roundWind: 'E' }, 0)).toHaveLength(0);
  });
  it('rejects chows', () => {
    expect(wins('E', hand(['m1', 'm2', 'm3', 'p4', 'p4', 'p4', 's7', 's7', 's7', 'm9', 'm9', 'm9', 'WE', 'WE']), east, 0)).toHaveLength(0);
  });
});

describe('Karachi South', () => {
  it('accepts four suit pungs and a pair', () => {
    expect(wins('S', hand(['m1', 'm1', 'm1', 'p4', 'p4', 'p4', 's7', 's7', 's7', 'm9', 'm9', 'm9', 's2', 's2']))).toContain('karachi.south.anyDamnHand');
  });
  it('rejects any honour tile', () => {
    expect(wins('S', hand(['m1', 'm1', 'm1', 'p4', 'p4', 'p4', 's7', 's7', 's7', 'm9', 'm9', 'm9', 'WE', 'WE']))).toHaveLength(0);
  });
  it('accepts Crochet and Dirty Pairs', () => {
    expect(wins('S', hand(['m1', 'p1', 's1', 'm4', 'p4', 's4', 'm7', 'p7', 's7', 'm9', 'p9', 's9', 'p2', 'p2']))).toContain('karachi.south.crochet');
    expect(wins('S', hand(['m2', 'm2', 'p3', 'p3', 's4', 's4', 'm5', 'm5', 'p6', 'p6', 's7', 's7', 'm8', 'm8']))).toContain('karachi.south.dirtyPairs');
  });
  it('limits Knitting to knitted pairs in two suits', () => {
    expect(wins('S', hand(['m1', 'p1', 'm2', 'p2', 'm4', 'p4', 'm5', 'p5', 'm7', 'p7', 'm8', 'p8', 'm9', 'p9']))).toContain('karachi.south.knitting');
    expect(wins('S', hand(['m1', 'p1', 'm2', 'p2', 'm4', 's4', 'm5', 'p5', 'm7', 'p7', 'm8', 'p8', 'm9', 'p9']))).not.toContain('karachi.south.knitting');
    // same-kind pairs are Dirty Pairs, not Knitting
    expect(wins('S', hand(['m2', 'm2', 'p3', 'p3', 'm4', 'm4', 'm5', 'm5', 'p6', 'p6', 'p9', 'p9', 'm8', 'm8']))).not.toContain('karachi.south.knitting');
  });
});

describe('Karachi North', () => {
  it('accepts Gates of Heaven (Wriggly Snake v2)', () => {
    expect(wins('N', hand(['s1', 's1', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's9', 's9', 's5']))).toContain('karachi.north.gatesOfHeaven');
  });
  it("accepts Gertie's Garter", () => {
    expect(wins('N', hand(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']))).toContain('karachi.north.gertiesGarter');
  });
  it('accepts Numbers in Parallel', () => {
    expect(wins('N', hand(['m5', 'm5', 'm5', 'p5', 'p5', 'p5', 's5', 's5', 's5', 'WN', 'WN', 'WN', 'DG', 'DG']))).toContain('karachi.north.numbersPungs.pungPair');
  });
  it('accepts Monty Unique Wonders', () => {
    expect(wins('N', hand(['m1', 'm9', 'p1', 'p9', 's1', 's9', 'WE', 'WS', 'WW', 'WN', 'DR', 'DG', 'DW', 'm1']))).toContain('karachi.north.montyUniqueWonders');
  });
  it('rejects an ordinary four sets and a pair', () => {
    expect(wins('N', hand(['m1', 'm2', 'm3', 'p5', 'p5', 'p5', 's7', 's8', 's9', 'WE', 'WE', 'WE', 'DR', 'DR']))).toHaveLength(0);
  });
});
