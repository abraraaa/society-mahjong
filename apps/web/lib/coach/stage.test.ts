import { describe, expect, it } from 'vitest';
import { WATCH_EVERY, asksToWatch, stageFor, watchHeading } from './stage';

describe('stageFor', () => {
  it('walks a newcomer from new to learning', () => {
    expect(stageFor({ handsFinished: 0, wins: 0, discardsMade: 0 })).toBe('new');
    expect(stageFor({ handsFinished: 0, wins: 0, discardsMade: 1 })).toBe('first_hand');
    expect(stageFor({ handsFinished: 1, wins: 0, discardsMade: 9 })).toBe('learning');
  });

  it('never quiets the tutor on wins alone: a win with every tip taken is the tutor’s too', () => {
    expect(stageFor({ handsFinished: 8, wins: 3, discardsMade: 60 })).toBe('learning');
    expect(stageFor({ handsFinished: 40, wins: 20, discardsMade: 300 })).toBe('learning');
  });

  it('is solid once the player says "just watch"', () => {
    expect(stageFor({ handsFinished: 8, wins: 3, discardsMade: 60, watching: true })).toBe('solid');
  });
});

describe('asksToWatch', () => {
  it(`asks at ${WATCH_EVERY} wins, not before`, () => {
    expect(asksToWatch({ wins: 0 })).toBe(false);
    expect(asksToWatch({ wins: WATCH_EVERY - 1 })).toBe(false);
    expect(asksToWatch({ wins: WATCH_EVERY })).toBe(true);
  });

  it('never asks again after "just watch"', () => {
    expect(asksToWatch({ wins: 3, watching: true })).toBe(false);
    expect(asksToWatch({ wins: 30, watching: true })).toBe(false);
  });

  it('after "keep helping", waits three more wins', () => {
    expect(asksToWatch({ wins: 3, keptHelpingAt: 3 })).toBe(false);
    expect(asksToWatch({ wins: 5, keptHelpingAt: 3 })).toBe(false);
    expect(asksToWatch({ wins: 6, keptHelpingAt: 3 })).toBe(true);
  });
});

describe('watchHeading', () => {
  it('says the wins in words, as the tutor says counts', () => {
    expect(watchHeading(3)).toBe('Three wins. Want me to just watch?');
    expect(watchHeading(6)).toBe('Six wins. Want me to just watch?');
    expect(watchHeading(12)).toBe('12 wins. Want me to just watch?');
  });
});
