import { describe, expect, it } from 'vitest';
import { stageFor } from '../coach/stage';
import { policyFor } from './policy';
import { answerWatch, asksFromStats, stageFromStats, tallyHand } from './stage';

describe('stageFromStats', () => {
  it('a fresh profile, or one with no tally yet, is new', () => {
    expect(stageFromStats({})).toBe('new');
    expect(stageFromStats({ hands: 0, wins: 0 })).toBe('new');
  });

  it('one finished hand makes learning, however many more follow without a win', () => {
    expect(stageFromStats({ hands: 1 })).toBe('learning');
    expect(stageFromStats({ hands: 40, wins: 2 })).toBe('learning');
  });

  it('wins alone never make solid: only the player’s "just watch" does', () => {
    expect(stageFromStats({ hands: 3, wins: 3 })).toBe('learning');
    expect(stageFromStats({ hands: 30, wins: 12 })).toBe('learning');
    expect(stageFromStats({ hands: 3, wins: 3, watch: true })).toBe('solid');
  });

  it('uses the solo table’s thresholds, less the discard it cannot see', () => {
    for (const hands of [0, 1, 2, 5, 20]) {
      for (const wins of [0, 1, 2, 3, 7]) {
        for (const watch of [false, true]) {
          expect(stageFromStats({ hands, wins, watch })).toBe(stageFor({ handsFinished: hands, wins, discardsMade: 0, watching: watch }));
        }
      }
    }
  });

  it('is what quickens the clocks: a table of regulars runs at seven seconds', () => {
    const regular = { hands: 9, wins: 3, watch: true };
    expect(policyFor([stageFromStats(regular), stageFromStats({ hands: 30, wins: 4, watch: true })])).toEqual({ claimSeconds: 7, turnSeconds: 60 });
    expect(policyFor([stageFromStats(regular), stageFromStats({ hands: 30, wins: 4 })])).toEqual({ claimSeconds: 12, turnSeconds: 75 });
    expect(policyFor([stageFromStats(regular), stageFromStats({})])).toEqual({ claimSeconds: 20, turnSeconds: 90 });
  });
});

describe('asksFromStats', () => {
  it('asks at three wins, not before', () => {
    expect(asksFromStats({})).toBe(false);
    expect(asksFromStats({ hands: 9, wins: 2 })).toBe(false);
    expect(asksFromStats({ hands: 9, wins: 3 })).toBe(true);
  });

  it('asks a regular from before the offer existed, once, at their next hand', () => {
    expect(asksFromStats({ hands: 40, wins: 11 })).toBe(true);
  });

  it('stops asking once they say "just watch"', () => {
    expect(asksFromStats(answerWatch({ hands: 9, wins: 3 }, true))).toBe(false);
  });

  it('after "keep helping", asks again three wins on', () => {
    let stats = answerWatch({ hands: 9, wins: 3 }, false);
    expect(stats).toEqual({ hands: 9, wins: 3, keptHelpingAt: 3 });
    expect(asksFromStats(stats)).toBe(false);
    stats = tallyHand(tallyHand(stats, true), true);
    expect(asksFromStats(stats)).toBe(false);
    stats = tallyHand(stats, true);
    expect(asksFromStats(stats)).toBe(true);
  });

  it('reads a malformed answer as no answer', () => {
    expect(asksFromStats({ hands: 9, wins: 3, keptHelpingAt: -4 })).toBe(true);
    expect(asksFromStats({ hands: 9, wins: 3, watch: 'yes' as unknown as boolean })).toBe(true);
    expect(stageFromStats({ hands: 9, wins: 3, watch: 'yes' as unknown as boolean })).toBe('learning');
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
    expect(stageFromStats(stats)).toBe('learning');
    expect(asksFromStats(stats)).toBe(true);
    stats = answerWatch(stats, true);
    expect(stageFromStats(stats)).toBe('solid');
    // The answer outlives the tally's next writes.
    expect(stageFromStats(tallyHand(stats, false))).toBe('solid');
  });
});
