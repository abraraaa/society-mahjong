/**
 * One worked example for every hand the Karachi ruleset deals: the hand a newcomer is
 * shown when they ask what a pattern looks like. Each is a complete 14-tile hand that
 * the round announces under its own name (the aliases below aside); a test checks
 * every one against the specs, so a pattern added without an example fails it.
 */
import type { TileKind } from '../../tiles';

const GUIDE_SUITS: Readonly<Record<string, string>> = { b: 's', d: 'p', c: 'm' };
const GUIDE_HONOURS: ReadonlyMap<string, TileKind> = new Map([
  ['E', 'WE'],
  ['S', 'WS'],
  ['W', 'WW'],
  ['N', 'WN'],
  ['R', 'DR'],
  ['G', 'DG'],
  ['Wh', 'DW'],
]);

/** Guide notation, the same as the catalogue test: 1b = s1 (bamboo), 1d = p1 (dots), 1c = m1 (characters), E S W N, R G Wh. `|` separates groups for the reader and is ignored. */
export function guideTiles(spec: string): TileKind[] {
  return spec
    .split(/[\s|]+/)
    .filter((token) => token !== '')
    .map((token) => {
      if (/^[1-9][bdc]$/.test(token)) return `${GUIDE_SUITS[token[1]!]}${token[0]}` as TileKind;
      const honour = GUIDE_HONOURS.get(token);
      if (honour) return honour;
      throw new Error(`bad tile ${token}`);
    });
}

export const KARACHI_EXAMPLE_TEXT: Readonly<Record<string, string>> = {
  'karachi.goulash': '1b 1b 1b | 4d 4d 4d | 7c 7c 7c | 9b 9b 9b | 2d 2d',
  // East: the general chow and pung forms, then the named hands.
  'karachi.east.chows.clean.news': '1b 2b 3b | 2b 3b 4b | 7b 8b 9b | E S W N | N',
  'karachi.east.chows.clean.pungPair': '1b 2b 3b | 2b 3b 4b | 7b 8b 9b | R R R | E E',
  'karachi.east.chows.each.news': '4b 5b 6b | 2d 3d 4d | 6c 7c 8c | E S W N | W', // announced as Windy Chows
  'karachi.east.chows.each.pungPair': '1b 2b 3b | 4d 5d 6d | 7c 8c 9c | R R R | E E',
  'karachi.east.pungs.clean.news': '1b 1b 1b | 4b 4b 4b | 7b 7b 7b | E S W N | N',
  'karachi.east.pungs.clean.pungPair': '1b 1b 1b | 4b 4b 4b | 7b 7b 7b | R R R | E E',
  'karachi.east.pungs.each.news': '2b 2b 2b | 5d 5d 5d | 8c 8c 8c | E S W N | S', // announced as Windyfly
  'karachi.east.pungs.each.pungPair': '2b 2b 2b | 5d 5d 5d | 8c 8c 8c | R R R | E E',
  'karachi.east.appleBlossom': '1b 2b 3b | 1d 2d 3d | 1c 2c 3c | Wh Wh Wh | G G',
  'karachi.east.appleBlossom.chows': '4b 5b 6b | 2d 3d 4d | 6c 7c 8c | Wh Wh Wh | G G',
  'karachi.east.windyWonders': '1b 2b 3b | 1d 2d 3d | 1c 2c 3c | E E E | S S',
  'karachi.east.windyfly': '1b 1b 1b | 4d 4d 4d | 7c 7c 7c | E S W N | S',
  'karachi.east.windyChows': '4b 5b 6b | 2d 3d 4d | 6c 7c 8c | E S W N | W',
  'karachi.east.hoveringAngel': '4b 5b 6b | 2d 3d 4d | 1c 2c 3c | N N N | R R',
  'karachi.east.professors': '6d 7d 8d | 4b 5b 6b | 2c 3c 4c | R G Wh | S S',
  'karachi.east.pinkys': '1b 2b 3b 4b | 1d 2d 3d 4d | 1c 2c 3c 4c | W W',
  'karachi.east.monty': '1b 2b 3b 4b | 1d 2d 3d 4d | 1c 2c 3c 4c | R R',
  'karachi.east.khalidas': '1d 2b 3d 4d 5b 6c 7c 8b 9c | E S W N | N',
  'karachi.east.nailas': '1b 2b 3b | 3b 4b 5b | 1d 2d 3d | 3c 4c 5c | N N',
  'karachi.east.dragonfly': 'R G Wh | 3b 3b 3b | 5d 5d 5d | 7c 7c 7c | 4b 4b',
  // South
  'karachi.south.anyDamnHand': '1b 2b 3b | 4b 5b 6b | 1d 2d 3d | 4d 5d 6d | 7c 7c',
  'karachi.south.dirtyPairs': '1b 1b | 3d 3d | 5c 5c | 7b 7b | 2d 2d | 4c 4c | 6b 6b',
  'karachi.south.dirtyGertiesGarter': '1b 2b 3b 4b 5b 6b 7b | 1d 2d 3d 4d 5d 6d 7d',
  'karachi.south.knitting': '1b 1d | 2b 2d | 4b 4d | 5b 5d | 7b 7d | 8b 8d | 9b 9d',
  'karachi.south.crochet': '1b 1d 1c | 4b 4d 4c | 7b 7d 7c | 7b 7d 7c | 4b 4b',
  'karachi.south.crazyChows': '2b 3d 4c | 4b 5d 6c | 5b 6d 7c | 7b 8d 9c | 3b 7d',
  // North
  'karachi.north.lailas': '1d 1d 1d | 9b 9b 9b | R G Wh | E S W N | S',
  'karachi.north.easyVirgin': '1b 2b 3b | 1b 1b 1b | R G Wh | E S W N | W',
  'karachi.north.oneToNinePlusFiveHonours': '1b 2b 3b 4b 5b 6b 7b 8b 9b | E S W N | R',
  'karachi.north.oneToSevenPlusSevenHonours': '1b 2b 3b 4b 5b 6b 7b | E S W N | R G Wh',
  'karachi.north.numbersPungs': '5b 5b 5b | 5d 5d 5d | 5c 5c 5c | E S W N | R',
  'karachi.north.numbersPungs.pungPair': '5b 5b 5b | 5d 5d 5d | 5c 5c 5c | E E E | S S',
  'karachi.north.sindClubHand': 'R G Wh E S W N | 2b 5b 5d 8c 7c | 1c 1c',
  'karachi.north.gatesOfHeaven': '1c 1c 1c | 9c 9c 9c | 2c 3c 4c 5c 6c 7c 8c | 5c',
  'karachi.north.confusedGates': '1b 1b 1b | 9d 9d 9d | 2c 3c 4c 5c 6c 7c 8c | 5c',
  'karachi.north.fourBlessings': 'E E E | S S S | W W W | N N N | R R',
  'karachi.north.allHonorHand': '1b 1b 1b | 9d 9d 9d | E E E | N N N | R R',
  'karachi.north.gertiesGarter': '1b 2b 3b 4b 5b 6b 7b | 1d 2d 3d 4d 5d 6d 7d',
  'karachi.north.greenJade': 'G G G | 1b 1b 1b | 4b 4b 4b | 7b 7b 7b | 8b 8b',
  'karachi.north.imperialJade': 'G G G | 2b 2b 2b | 3b 3b 3b | 4b 4b 4b | 6b 6b',
  'karachi.north.royalCoral': 'R R R | 3c 3c 3c | 5c 5c 5c | 8c 8c 8c | 9c 9c',
  'karachi.north.royalRuby': 'R R R | 1b 1b 1b | 5b 5b 5b | 7b 7b 7b | 9b 9b',
  'karachi.north.rubyJade': 'R R R | G G G | 1b 1b 1b | 2b 2b 2b | 6b 6b',
  'karachi.north.lillyOfTheValley': 'Wh Wh Wh | 2d 2d 2d | 6d 6d 6d | 9d 9d 9d | 4d 4d',
  'karachi.north.lillypilly': 'G G G | Wh Wh | 4d 4d 4d | 6d 6d 6d | 9d 9d 9d',
  'karachi.north.runPungPair': '1d 2d 3d 4d 5d 6d 7d 8d 9d | 8d 8d 8d | 2d 2d',
  'karachi.north.montyUniqueWonders': '1b 9b 1d 9d 1c 9c E S W N R G Wh | 9b',
};

export const KARACHI_EXAMPLES: Readonly<Record<string, readonly TileKind[]>> = Object.freeze(
  Object.fromEntries(Object.entries(KARACHI_EXAMPLE_TEXT).map(([id, text]) => [id, Object.freeze(guideTiles(text))])),
);

/** General ids whose components are exactly a named pattern's: any hand of theirs is announced under the named one. */
export const KARACHI_ALIASES: Readonly<Record<string, string>> = {
  'karachi.east.chows.each.news': 'karachi.east.windyChows',
  'karachi.east.pungs.each.news': 'karachi.east.windyfly',
};
