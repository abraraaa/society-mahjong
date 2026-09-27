import { describe, expect, it } from 'vitest';
import { countWord, isLoner, myDiscardCount, orList, planCount, tilesWord, waitList } from './words';

describe('the words the tutor counts in', () => {
  it('spells out small numbers and counts tiles, never "away"', () => {
    expect(countWord(1)).toBe('one');
    expect(countWord(10)).toBe('ten');
    expect(countWord(11)).toBe('11');
    expect(tilesWord(1)).toBe('one tile');
    expect(tilesWord(3)).toBe('three tiles');
  });

  it('writes the plan line short, with digits', () => {
    expect(planCount(0, false)).toBe('complete');
    expect(planCount(1, false)).toBe('1 tile to go');
    expect(planCount(7, false)).toBe('7 tiles to go');
    expect(planCount(7, true)).toBe('about 7 tiles to go');
  });

  it('lists what would finish a hand the way a player says it', () => {
    expect(orList(['a'])).toBe('a');
    expect(orList(['a', 'b', 'c'])).toBe('a, b or c');
    expect(waitList(['m9', 'm3', 'm6'])).toBe('3, 6 or 9 Characters');
    expect(waitList(['s2', 'WE'])).toBe('2 Bamboo or East Wind');
    expect(waitList(['p1'])).toBe('1 Dot');
  });

  it('knows a tile on its own from one with neighbours', () => {
    expect(isLoner(['m1', 's5', 'WE'], 'WE')).toBe(true);
    expect(isLoner(['m1', 's5', 's7'], 's5')).toBe(false);
    expect(isLoner(['m1', 's5', 's9'], 's5')).toBe(true);
    expect(isLoner(['s5', 's5'], 's5')).toBe(false);
  });

  it('counts only the player’s own discards this hand', () => {
    const events = [
      { seq: 1, type: 'discarded', seat: 1 as const, tile: 'm1' as const },
      { seq: 2, type: 'discarded', seat: 0 as const, tile: 'm2' as const },
    ];
    expect(myDiscardCount({ me: 0, events })).toBe(1);
    expect(myDiscardCount({ me: 2, events })).toBe(0);
  });
});
