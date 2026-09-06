import { describe, expect, it } from 'vitest';
import { stageFor } from '../coach/stage';
import { policyFor } from './policy';
import { stageFromStats, tallyHand } from './stage';

describe('stageFromStats', () => {
  it('a fresh profile, or one with no tally yet, is new', () => {
    expect(stageFromStats({})).toBe('new');
    expect(stageFromStats({ hands: 0, wins: 0 })).toBe('new');
  });

  it('one finished hand makes learning, however many more follow without a win', () => {
    expect(stageFromStats({ hands: 1 })).toBe('learning');
    expect(stageFromStats({ hands: 40, wins: 2 })).toBe('learning');
  });

  it('three wins make solid', () => {
    expect(stageFromStats({ hands: 3, wins: 3 })).toBe('solid');
    expect(stageFromStats({ hands: 12, wins: 5 })).toBe('solid');
  });

  it('uses the solo table’s thresholds, less the discard it cannot see', () => {
    for (const hands of [0, 1, 2, 5, 20]) {
      for (const wins of [0, 1, 2, 3, 7]) {
        expect(stageFromStats({ hands, wins })).toBe(stageFor({ handsFinished: hands, wins, discardsMade: 0 }));
      }
    }
  });

  it('is what quickens the clocks: a table of regulars runs at seven seconds', () => {
    expect(policyFor([stageFromStats({ hands: 9, wins: 3 }), stageFromStats({ hands: 30, wins: 4 })])).toEqual({ claimSeconds: 7, turnSeconds: 60 });
    expect(policyFor([stageFromStats({ hands: 9, wins: 3 }), stageFromStats({})])).toEqual({ claimSeconds: 20, turnSeconds: 90 });
  });
});

describe('tallyHand', () => {
  it('counts the hand, and the win only for the winner', () => {
    expect(tallyHand({}, false)).toEqual({ hands: 1, wins: 0 });
    expect(tallyHand({ hands: 1, wins: 0 }, true)).toEqual({ hands: 2, wins: 1 });
  });

  it('keeps whatever else the profile has recorded, and leaves the input alone', () => {
    const before = { hands: 2, wins: 1, favourite: 'windy-chows' };
    const after = tallyHand(before, true);
    expect(after).toEqual({ hands: 3, wins: 2, favourite: 'windy-chows' });
    expect(before).toEqual({ hands: 2, wins: 1, favourite: 'windy-chows' });
  });

  it('walks a profile through the stages', () => {
    let stats = tallyHand({}, false);
    expect(stageFromStats(stats)).toBe('learning');
    for (let i = 0; i < 3; i++) stats = tallyHand(stats, true);
    expect(stageFromStats(stats)).toBe('solid');
  });
});
