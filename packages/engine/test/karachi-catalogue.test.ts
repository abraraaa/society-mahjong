/**
 * Golden fixtures: every Karachi example in the Mahjong Mates Special Hands
 * Guide v4.2 must match its named pattern in its round, and changing one
 * tile must break that match. Guide notation b/d/c = bamboo/dots/characters.
 */
import { describe, expect, it } from 'vitest';
import { karachi, matchPatterns, type HandInput, type MatchCtx, type TileKind, type Wind } from '../src/index';

const ctx: MatchCtx = { seatWind: 'S', roundWind: 'E' };

/** "1b 2b 3b E R Wh" -> engine kinds */
function tiles(spec: string): TileKind[] {
  const suit: Record<string, string> = { b: 's', d: 'p', c: 'm' };
  return spec
    .trim()
    .split(/\s+/)
    .map((t) => {
      if (/^[1-9][bdc]$/.test(t)) return `${suit[t[1]!]}${t[0]}` as TileKind;
      if (t === 'R') return 'DR';
      if (t === 'G') return 'DG';
      if (t === 'Wh') return 'DW';
      if ('ESWN'.includes(t)) return `W${t}` as TileKind;
      throw new Error(`bad tile ${t}`);
    });
}

const round = (w: Wind, handInRound = 1) => karachi.handSpec({ roundWind: w, roundIndex: 'ESWN'.indexOf(w), handInRound, handIndex: 1 });
const ids = (w: Wind, h: HandInput) => matchPatterns(round(w).patterns, h, ctx, karachi.guards).map((m) => m.pattern.id);

interface Fixture {
  readonly id: string;
  readonly round: Wind;
  readonly hand: string;
  /** a substitution that must break the named match: [from, to] */
  readonly mutate: readonly [string, string];
}

const FIXTURES: readonly Fixture[] = [
  // East
  { id: 'karachi.east.chows.each.pungPair', round: 'E', hand: '1b 2b 3b 1d 2d 3d 1c 2c 3c E E E R R', mutate: ['R R', 'R G'] },
  { id: 'karachi.east.appleBlossom', round: 'E', hand: '1b 2b 3b 1d 2d 3d 1c 2c 3c Wh Wh Wh G G', mutate: ['G G', 'R R'] },
  { id: 'karachi.east.windyWonders', round: 'E', hand: '1b 2b 3b 1d 2d 3d 1c 2c 3c E E E S S', mutate: ['S S', 'R R'] },
  { id: 'karachi.east.windyfly', round: 'E', hand: '1b 1b 1b 4d 4d 4d 7c 7c 7c E W N S S', mutate: ['S S', 'S R'] },
  { id: 'karachi.east.pinkys', round: 'E', hand: '1b 2b 3b 4b 1d 2d 3d 4d 1c 2c 3c 4c W W', mutate: ['4c', '5c'] },
  { id: 'karachi.east.pinkys', round: 'E', hand: '4b 5b 6b 7b 4d 5d 6d 7d 4c 5c 6c 7c E E', mutate: ['E E', 'R R'] },
  { id: 'karachi.east.khalidas', round: 'E', hand: '1d 2b 3d 4d 5b 6c 7c 8b 9c E S W N N', mutate: ['9c', '9c'] },
  { id: 'karachi.east.monty', round: 'E', hand: '1b 2b 3b 4b 1d 2d 3d 4d 1c 2c 3c 4c R R', mutate: ['R R', 'W W'] },
  { id: 'karachi.east.nailas', round: 'E', hand: '1b 2b 3b 3b 4b 5b 1d 2d 3d 3c 4c 5c N N', mutate: ['3c 4c 5c', '1c 2c 3c'] },
  { id: 'karachi.east.hoveringAngel', round: 'E', hand: '4b 5b 6b 2d 3d 4d 1c 2c 3c N N N R R', mutate: ['R R', 'E E'] },
  { id: 'karachi.east.windyChows', round: 'E', hand: '4b 5b 6b 2d 3d 4d 6c 7c 8c E S N W W', mutate: ['W W', 'W R'] },
  { id: 'karachi.east.professors', round: 'E', hand: '6d 7d 8d 4b 5b 6b 2c 3c 4c R G Wh S S', mutate: ['S S', 'R R'] },
  { id: 'karachi.east.dragonfly', round: 'E', hand: 'R G Wh 3b 3b 3b 5d 5d 5d 7c 7c 7c 4b 4b', mutate: ['5d 5d 5d', '5b 5b 5b'] },
  // South
  { id: 'karachi.south.anyDamnHand', round: 'S', hand: '1b 2b 3b 4b 5b 6b 1d 2d 3d 4d 5d 6d 7c 7c', mutate: ['7c 7c', 'E E'] },
  { id: 'karachi.south.dirtyPairs', round: 'S', hand: '1b 1b 3d 3d 5c 5c 7b 7b 2d 2d 4c 4c 6b 6b', mutate: ['6b 6b', 'E E'] },
  { id: 'karachi.south.dirtyGertiesGarter', round: 'S', hand: '1b 2b 3b 4b 5b 6b 7b 1d 2d 3d 4d 5d 6d 7d', mutate: ['7d', '8d'] },
  { id: 'karachi.south.knitting', round: 'S', hand: '1b 1d 2b 2d 4b 4d 5b 5d 7b 7d 8b 8d 9b 9d', mutate: ['9d', '9c'] },
  { id: 'karachi.south.crochet', round: 'S', hand: '1b 1d 1c 4b 4d 4c 7b 7d 7c 7b 7d 7c 4b 4b', mutate: ['4b 4b', '4b 5b'] },
  { id: 'karachi.south.crazyChows', round: 'S', hand: '2b 3d 4c 4b 5d 6c 5b 6d 7c 7b 8d 9c 3b 7d', mutate: ['3b 7d', 'E E'] },
  // North
  { id: 'karachi.north.lailas', round: 'N', hand: '1d 1d 1d 9b 9b 9b R G Wh N E W S S', mutate: ['9b 9b 9b', '9d 9d 9d'] },
  { id: 'karachi.north.easyVirgin', round: 'N', hand: '1b 2b 3b 1b 1b 1b R G Wh E S N W W', mutate: ['1b 1b 1b', '1d 1d 1d'] },
  { id: 'karachi.north.oneToNinePlusFiveHonours', round: 'N', hand: '1b 2b 3b 4b 5b 6b 7b 8b 9b E S W N R', mutate: ['9b', '9d'] },
  { id: 'karachi.north.oneToSevenPlusSevenHonours', round: 'N', hand: '1b 2b 3b 4b 5b 6b 7b E S W N R G Wh', mutate: ['Wh', 'R'] },
  { id: 'karachi.north.numbersPungs', round: 'N', hand: '5b 5b 5b 5d 5d 5d 5c 5c 5c E S W N R', mutate: ['5c 5c 5c', '6c 6c 6c'] },
  { id: 'karachi.north.numbersPungs.pungPair', round: 'N', hand: 'E E E S S 5b 5b 5b 5d 5d 5d 5c 5c 5c', mutate: ['S S', '5b 5b'] },
  { id: 'karachi.north.sindClubHand', round: 'N', hand: 'R G Wh E S W N 2b 5b 5d 1c 8c 7c 1c', mutate: ['2b', '3b'] },
  { id: 'karachi.north.gatesOfHeaven', round: 'N', hand: '1c 1c 1c 9c 9c 9c 2c 3c 4c 6c 7c 8c 5c 5c', mutate: ['5c 5c', '5c 5d'] },
  { id: 'karachi.north.confusedGates', round: 'N', hand: '1b 1b 1b 9d 9d 9d 2c 3c 4c 6c 7c 8c 5c 5c', mutate: ['9d 9d 9d', '9b 9b 9b'] },
  { id: 'karachi.north.fourBlessings', round: 'N', hand: 'E E E S S S W W W N N N R R', mutate: ['N N N', 'G G G'] },
  { id: 'karachi.north.allHonorHand', round: 'N', hand: '1b 1b 1b 9d 9d 9d E E E N N N R R', mutate: ['9d 9d 9d', '8d 8d 8d'] },
  { id: 'karachi.north.gertiesGarter', round: 'N', hand: '1b 2b 3b 4b 5b 6b 7b 1d 2d 3d 4d 5d 6d 7d', mutate: ['1d', '8d'] },
  { id: 'karachi.north.greenJade', round: 'N', hand: 'G G G 1b 1b 1b 4b 4b 4b 7b 7b 7b 8b 8b', mutate: ['8b 8b', '8d 8d'] },
  { id: 'karachi.north.imperialJade', round: 'N', hand: 'G G G 2b 2b 2b 3b 3b 3b 4b 4b 4b 6b 6b', mutate: ['6b 6b', '5b 5b'] },
  { id: 'karachi.north.royalCoral', round: 'N', hand: 'R R R 3c 3c 3c 5c 5c 5c 8c 8c 8c 9c 9c', mutate: ['9c 9c', '9b 9b'] },
  { id: 'karachi.north.royalRuby', round: 'N', hand: 'R R R 1b 1b 1b 5b 5b 5b 7b 7b 7b 9b 9b', mutate: ['9b 9b', '8b 8b'] },
  { id: 'karachi.north.rubyJade', round: 'N', hand: 'R R R G G G 1b 1b 1b 2b 2b 2b 6b 6b', mutate: ['6b 6b', '6d 6d'] },
  { id: 'karachi.north.lillyOfTheValley', round: 'N', hand: 'Wh Wh Wh 2d 2d 2d 6d 6d 6d 9d 9d 9d 4d 4d', mutate: ['Wh Wh Wh', 'G G G'] },
  { id: 'karachi.north.lillypilly', round: 'N', hand: 'G G G Wh Wh 4d 4d 4d 6d 6d 6d 9d 9d 9d', mutate: ['Wh Wh', 'R R'] },
  { id: 'karachi.north.runPungPair', round: 'N', hand: '1d 2d 3d 4d 5d 6d 7d 8d 9d 8d 8d 8d 2d 2d', mutate: ['2d 2d', '2b 2b'] },
  { id: 'karachi.north.montyUniqueWonders', round: 'N', hand: '1b 1d 9d 1c 9c E S W N R G Wh 9b 9b', mutate: ['9b 9b', '9b 8b'] },
];

describe('Karachi catalogue (guide fixtures)', () => {
  for (const f of FIXTURES) {
    it(`${f.id} matches "${f.hand}" in ${f.round}`, () => {
      const hand = tiles(f.hand);
      expect(hand).toHaveLength(14);
      expect(ids(f.round, { concealed: hand, melds: [] })).toContain(f.id);
    });
    it(`${f.id} rejects the mutation ${f.mutate[0]} -> ${f.mutate[1]}`, () => {
      if (f.mutate[0] === f.mutate[1]) return; // self-mutation marks a hand with no simple negative
      const mutated = f.hand.replace(f.mutate[0], f.mutate[1]);
      expect(mutated).not.toBe(f.hand);
      expect(ids(f.round, { concealed: tiles(mutated), melds: [] })).not.toContain(f.id);
    });
  }
  it('goulash accepts the West round exchange hand shape', () => {
    const spec = karachi.handSpec({ roundWind: 'W', roundIndex: 2, handInRound: 0, handIndex: 8 });
    expect(spec.kind).toBe('goulash');
    expect(matchPatterns(spec.patterns, { concealed: tiles('1b 1b 1b 4d 4d 4d 7c 7c 7c 9b 9b 9b 2d 2d'), melds: [] }, ctx, karachi.guards).length).toBeGreaterThan(0);
  });
});
