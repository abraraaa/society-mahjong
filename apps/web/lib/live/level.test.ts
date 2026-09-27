import { describe, expect, it } from 'vitest';
import type { GameEvent } from '@society/engine';
import { liveStage } from './level';
import { CLAIM_PASS_MARGIN_MS, claimMsLeft } from './timing';

const view = (events: GameEvent[]) => ({ me: 2 as const, events });
const discard = (seat: 0 | 1 | 2 | 3): GameEvent => ({ seq: 5, type: 'discarded', seat, tile: 's5' });

describe('the live tutor’s stage', () => {
  it('is the server’s tally, new when there is none', () => {
    expect(liveStage('learning', view([]))).toBe('learning');
    expect(liveStage(null, view([]))).toBe('new');
    expect(liveStage(undefined, view([]))).toBe('new');
  });

  it('moves a first-timer on to first_hand once they have discarded in this hand, and only their own discard counts', () => {
    expect(liveStage('new', view([discard(1)]))).toBe('new');
    expect(liveStage('new', view([discard(1), discard(2)]))).toBe('first_hand');
  });

  it('is never lower than the server says', () => {
    expect(liveStage('learning', view([discard(2)]))).toBe('learning');
    expect(liveStage('solid', view([discard(2)]))).toBe('solid');
  });
});

describe('the claim sheet’s timing', () => {
  it('passes a margin ahead of the server’s deadline', () => {
    expect(claimMsLeft({ deadlines: { claim: 21_000, turn: null }, now: 1_000 })).toBe(20_000 - CLAIM_PASS_MARGIN_MS);
  });

  it('never waits a negative time, and has nothing to time without a claim window', () => {
    expect(claimMsLeft({ deadlines: { claim: 1_500, turn: null }, now: 1_000 })).toBe(0);
    expect(claimMsLeft({ deadlines: { claim: null, turn: 9_000 }, now: 1_000 })).toBeNull();
  });
});
