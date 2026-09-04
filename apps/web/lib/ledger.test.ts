import { describe, expect, it } from 'vitest';
import type { HandResult } from '@society/engine';
import { NO_SCORES, applyResult, handDeltas, signed, standings } from './ledger';

const win: HandResult = {
  type: 'win',
  winner: 2,
  patternId: 'x',
  selfDrawn: false,
  settlement: {
    winner: 2,
    unit: 'points',
    total: 2000,
    lines: [],
    transfers: [
      { from: 0, to: 2, amount: 4000 },
      { from: 1, to: 2, amount: 2000 },
      { from: 3, to: 2, amount: 2000 },
    ],
    provisional: false,
  },
};

describe('ledger', () => {
  it('moves the settlement between seats and sums to zero', () => {
    const s = applyResult(NO_SCORES, win);
    expect(s).toEqual({ 0: -4000, 1: -2000, 2: 8000, 3: -2000 });
    expect(Object.values(s).reduce((a, b) => a + b, 0)).toBe(0);
    expect(standings(s)).toEqual([2, 1, 3, 0].sort((a, b) => s[b as 0] - s[a as 0]));
  });
  it('a wash moves nothing', () => {
    expect(applyResult({ 0: 5, 1: 0, 2: -5, 3: 0 }, { type: 'draw' })).toEqual({ 0: 5, 1: 0, 2: -5, 3: 0 });
    expect(handDeltas(null)).toEqual(NO_SCORES);
  });
  it('formats with a sign', () => {
    expect(signed(4000)).toBe('+4,000');
    expect(signed(-2000)).toBe('\u22122,000');
    expect(signed(0)).toBe('0');
  });
});
