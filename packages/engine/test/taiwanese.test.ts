import { describe, expect, it } from 'vitest';
import { createTaiwanese, matchPatterns, scoreTaiwanese, type HandInput, type MatchCtx, type TileKind, type WinInput } from '../src/index';

const hand = (concealed: TileKind[], melds: HandInput['melds'] = []): HandInput => ({ concealed, melds });
const ctx: MatchCtx = { seatWind: 'S', roundWind: 'E' };
const tw = createTaiwanese({ sheet: 'house' });
const patterns = tw.handSpec({ roundWind: 'E', roundIndex: 0, handInRound: 0, handIndex: 0 }).patterns;

function winInput(h: HandInput, selfDrawn: boolean, extra: Partial<WinInput> = {}): WinInput {
  const matches = matchPatterns(patterns, h, ctx, tw.guards);
  return {
    seat: 1,
    dealer: 0,
    hand: h,
    matches,
    selfDrawn,
    ctx,
    bonus: [],
    wallRemaining: 40,
    handIndex: 1,
    flags: { lastWallTile: false, robbedKong: false, afterKong: false, firstDiscard: false, heavenly: false },
    ...(selfDrawn ? {} : { discarder: 2 as const }),
    ...extra,
  };
}

describe('Taiwanese patterns', () => {
  it('needs 17 tiles: five sets and a pair', () => {
    const h = hand(['m1', 'm2', 'm3', 'p5', 'p5', 'p5', 's7', 's8', 's9', 'WE', 'WE', 'WE', 'DR', 'DR', 's2', 's3', 's4']);
    expect(matchPatterns(patterns, h, ctx).length).toBeGreaterThan(0);
    const fourteen = hand(['m1', 'm2', 'm3', 'p5', 'p5', 'p5', 's7', 's8', 's9', 'WE', 'WE', 'WE', 'DR', 'DR']);
    expect(matchPatterns(patterns, fourteen, ctx)).toHaveLength(0);
  });
  it('matches Nico Nico', () => {
    const h = hand(['m1', 'm1', 'p2', 'p2', 's3', 's3', 'WE', 'WE', 'DR', 'DR', 'm9', 'm9', 's5', 's5', 'p7', 'p7', 'p7']);
    expect(matchPatterns(patterns, h, ctx).map((m) => m.pattern.id)).toContain('taiwanese.nicoNico');
  });
});

describe('Taiwanese house scoring', () => {
  it('scores a concealed self-pick all-pong hand with the base', () => {
    const h = hand(['m1', 'm1', 'm1', 'p5', 'p5', 'p5', 's7', 's7', 's7', 'WE', 'WE', 'WE', 'DR', 'DR', 's2', 's2', 's2']);
    const s = scoreTaiwanese(winInput(h, true), 'house');
    const ids = s.lines.map((l) => l.id);
    expect(ids).toContain('concealedSelfPick'); // 15
    expect(ids).not.toContain('selfPick'); // excluded by concealedSelfPick
    expect(ids).toContain('allPong'); // 25
    expect(ids).toContain('concealedPongs5'); // 80
    expect(ids).toContain('roundWindPong'); // WE in an E round: 1 + windPong 1
    expect(ids).toContain('base');
    expect(s.transfers).toHaveLength(3);
    expect(s.unit).toBe('points');
  });
  it('charges only the discarder on a discard win', () => {
    const h = hand(['m1', 'm2', 'm3', 'p5', 'p5', 'p5', 's7', 's8', 's9', 'WE', 'WE', 'WE', 'DR', 'DR', 's2', 's3', 's4']);
    const s = scoreTaiwanese(winInput(h, false), 'house');
    expect(s.transfers).toEqual([{ from: 2, to: 1, amount: s.total }]);
  });
  it('awards tai without a base on the standard sheet', () => {
    const h = hand(['m1', 'm1', 'm1', 'm5', 'm5', 'm5', 'm7', 'm7', 'm7', 'm9', 'm9', 'm9', 'm2', 'm2', 'm3', 'm3', 'm3']);
    const s = scoreTaiwanese(winInput(h, true), 'standard');
    const ids = s.lines.map((l) => l.id);
    expect(s.unit).toBe('tai');
    expect(ids).toContain('pure'); // 8
    expect(ids).toContain('allPong'); // 4
    expect(ids).toContain('concealedSelfPick'); // 3
    expect(ids).toContain('concealedPongs5'); // 8
    expect(ids).not.toContain('base');
    expect(s.total).toBe(8 + 4 + 3 + 8);
  });
});
