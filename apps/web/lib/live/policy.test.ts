import { describe, expect, it } from 'vitest';
import { emptySeatBots, humanLevels, policyFor } from './policy';

/**
 * Who the filler bots are and how long the clocks run, from each seat's
 * level: null is a bot or an empty seat.
 */
describe('humanLevels', () => {
  it('keeps the humans’ levels in seat order and drops bots and empty seats', () => {
    expect(humanLevels(['learning', null, 'new', null])).toEqual(['learning', 'new']);
    expect(humanLevels([null, null, null, null])).toEqual([]);
    expect(humanLevels([])).toEqual([]);
  });

  it('sizes the clocks by the humans only, so a bot never counts as a first-timer', () => {
    expect(policyFor(humanLevels(['solid', null, null, null]))).toEqual(policyFor(['solid']));
    expect(policyFor(humanLevels(['solid', null, 'new', null]))).toEqual(policyFor(['new']));
  });
});

describe('emptySeatBots', () => {
  it('is gentle while any human at the table is below solid', () => {
    for (const low of ['new', 'first_hand', 'learning'] as const) {
      expect(emptySeatBots([low, null, null, null])).toBe('gentle');
      expect(emptySeatBots(['solid', null, low, 'solid'])).toBe('gentle');
    }
  });

  it('is sharp once every human is solid', () => {
    expect(emptySeatBots(['solid', null, null, null])).toBe('sharp');
    expect(emptySeatBots(['solid', 'solid', null, 'solid'])).toBe('sharp');
  });

  it('is sharp with no humans at all', () => {
    expect(emptySeatBots([null, null, null, null])).toBe('sharp');
    expect(emptySeatBots([])).toBe('sharp');
  });

  it('is always sharp in a strict room, whoever is seated', () => {
    expect(emptySeatBots(['new', null, null, null], true)).toBe('sharp');
    expect(emptySeatBots(['solid', null, null, null], true)).toBe('sharp');
    expect(emptySeatBots(['new', null, null, null], false)).toBe('gentle');
  });
});
