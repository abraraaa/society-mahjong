/**
 * Golden fixtures: every Karachi example in the Mahjong Mates Special Hands
 * Guide v4.2 must match its named pattern in its round, and changing one
 * tile must break that match. Guide notation b/d/c = bamboo/dots/characters.
 */
import { describe, expect, it } from 'vitest';
import { analyseHand, karachi, matchPatterns, type HandInput, type MatchCtx, type Wind } from '../src/index';
import { KARACHI_FIXTURES as FIXTURES, tiles } from './karachi-fixtures';

const ctx: MatchCtx = { seatWind: 'S', roundWind: 'E' };

const round = (w: Wind, handInRound = 1) => karachi.handSpec({ roundWind: w, roundIndex: 'ESWN'.indexOf(w), handInRound, handIndex: 1 });
const ids = (w: Wind, h: HandInput) => matchPatterns(round(w).patterns, h, ctx, karachi.guards).map((m) => m.pattern.id);
/** How far the analyser thinks the hand is from one named pattern of the round. */
const away = (w: Wind, h: HandInput, id: string) =>
  analyseHand(h, round(w).patterns, ctx, karachi.guards, { limit: Infinity }).candidates.find((c) => c.patternId === id)?.away;

describe('Karachi catalogue (guide fixtures)', () => {
  for (const f of FIXTURES) {
    it(`${f.id} matches "${f.hand}" in ${f.round}`, () => {
      const hand = tiles(f.hand);
      expect(hand).toHaveLength(14);
      expect(ids(f.round, { concealed: hand, melds: [] })).toContain(f.id);
      // The relaxed search must agree with the matcher about a finished hand.
      expect(away(f.round, { concealed: hand, melds: [] }, f.id)).toBe(0);
    });
    it(`${f.id} rejects the mutation ${f.mutate[0]} -> ${f.mutate[1]}`, () => {
      if (f.mutate[0] === f.mutate[1]) return; // self-mutation marks a hand with no simple negative
      const mutated = f.hand.replace(f.mutate[0], f.mutate[1]);
      expect(mutated).not.toBe(f.hand);
      expect(ids(f.round, { concealed: tiles(mutated), melds: [] })).not.toContain(f.id);
      expect(away(f.round, { concealed: tiles(mutated), melds: [] }, f.id)).toBeGreaterThan(0);
    });
  }
  it('goulash accepts the West round exchange hand shape', () => {
    const spec = karachi.handSpec({ roundWind: 'W', roundIndex: 2, handInRound: 0, handIndex: 8 });
    expect(spec.kind).toBe('goulash');
    expect(matchPatterns(spec.patterns, { concealed: tiles('1b 1b 1b 4d 4d 4d 7c 7c 7c 9b 9b 9b 2d 2d'), melds: [] }, ctx, karachi.guards).length).toBeGreaterThan(0);
  });
});
