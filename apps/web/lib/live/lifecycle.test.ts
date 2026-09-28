import { describe, expect, it } from 'vitest';
import type { HandState } from '@society/engine';
import { STALE_GAME_MS, addHandScores, handsPlayed } from './lifecycle';
import type { Scores4 } from './table-state';

/** Just what adding a hand's points reads of it. */
function won(transfers: readonly { from: number; to: number; amount: number }[]): HandState {
  return { phase: 'finished', result: { type: 'win', winner: 1, patternId: 'all-pungs', selfDrawn: false, settlement: { transfers } } } as unknown as HandState;
}

describe('handsPlayed', () => {
  it('counts every hand before this one, and this one once it has finished', () => {
    const at = (handIndex: number, phase: HandState['phase']) => handsPlayed({ phase, progress: { roundWind: 'E', roundIndex: 0, handInRound: handIndex % 4, handIndex } });
    expect(at(0, 'turn')).toBe(0);
    expect(at(0, 'finished')).toBe(1);
    expect(at(1, 'preplay')).toBe(1);
    expect(at(7, 'claim')).toBe(7);
    expect(at(15, 'finished')).toBe(16);
  });
});

describe('addHandScores', () => {
  it('adds a win’s transfers, seat to seat', () => {
    const before: Scores4 = [3, -3, 0, 0];
    const after = addHandScores(
      before,
      won([
        { from: 0, to: 1, amount: 8 },
        { from: 2, to: 1, amount: 4 },
        { from: 3, to: 1, amount: 4 },
      ]),
    );
    expect(after).toEqual([-5, 13, -4, -4]);
    expect(after.reduce((a, b) => a + b, 0)).toBe(0);
    // The totals it was given are left as they were.
    expect(before).toEqual([3, -3, 0, 0]);
  });

  it('adds nothing for a washout, or a hand with no result', () => {
    const before: Scores4 = [3, -3, 0, 0];
    expect(addHandScores(before, { phase: 'finished', result: { type: 'draw' } } as unknown as HandState)).toBe(before);
    expect(addHandScores(before, { phase: 'turn', result: null } as unknown as HandState)).toBe(before);
  });
});

describe('STALE_GAME_MS', () => {
  it('is six hours', () => {
    expect(STALE_GAME_MS).toBe(6 * 60 * 60 * 1000);
  });
});
