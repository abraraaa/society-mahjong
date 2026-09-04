import type { Pattern } from '@society/engine';

/**
 * What each hand actually looks like, in the words a player would use at the table.
 *
 * A name alone teaches nobody: "Windy Chows" means something only once you have
 * been told it is a run in each suit plus all four winds with one paired. Every
 * line here is written off the pattern's own components and the row for that hand
 * in docs/RULES-KARACHI.md, and `shapeOf` falls back to a bland summary rather
 * than say nothing when a pattern arrives without one.
 */

/**
 * The East general rule is eight generated patterns whose ids spell out their own
 * structure, so their descriptions are generated the same way rather than typed
 * out eight times and left to drift apart.
 */
function eastGeneralShapes(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const setType of ['chow', 'pung'] as const) {
    for (const mode of ['clean', 'each'] as const) {
      for (const h of ['news', 'pungPair'] as const) {
        const sets = setType === 'chow' ? (mode === 'clean' ? 'three runs in one suit' : 'a run in each suit') : mode === 'clean' ? 'three pungs in one suit' : 'a pung in each suit';
        const honours = h === 'news' ? 'all four winds with one paired' : 'an honour pung and pair';
        out[`karachi.east.${setType}s.${mode}.${h}`] = `${sets}, plus ${honours}`;
      }
    }
  }
  return out;
}

const SHAPES: Readonly<Record<string, string>> = {
  ...eastGeneralShapes(),

  'karachi.goulash': 'four pungs and a pair, with no runs anywhere',

  'karachi.east.appleBlossom': 'a run in each suit, a white dragon pung and a green dragon pair',
  'karachi.east.appleBlossom.chows': 'a run in each suit, a white dragon pung and a green dragon pair',
  'karachi.east.windyWonders': 'a run in each suit, a wind pung and a wind pair',
  'karachi.east.windyfly': 'a pung in each suit, plus all four winds with one paired',
  'karachi.east.windyChows': 'a run in each suit, plus all four winds with one paired',
  'karachi.east.hoveringAngel': 'a run in each suit, a wind pung and a dragon pair',
  'karachi.east.professors': 'a run in each suit, one of each dragon and a wind pair',
  'karachi.east.pinkys': 'the same four-tile run in all three suits, plus a wind pair',
  'karachi.east.monty': 'the same four-tile run in all three suits, plus a dragon pair',
  'karachi.east.khalidas': '1 through 9 across the suits, plus all four winds with one paired',
  'karachi.east.nailas': '1-2-3 and 3-4-5 in one suit, 1-2-3 in a second, 3-4-5 in the third, and a wind pair',
  'karachi.east.dragonfly': 'one of each dragon, a pung in each suit and a pair from any suit',

  'karachi.south.anyDamnHand': 'any four sets and a pair, with not one wind or dragon',
  'karachi.south.dirtyPairs': 'seven pairs of suit tiles, nothing exposed',
  'karachi.south.dirtyGertiesGarter': '1 through 7 in two suits',
  'karachi.south.knitting': 'seven pairs, each the same number in the same two suits',
  'karachi.south.crochet': 'four knitted sets — one number across all three suits — and a pair',
  'karachi.south.crazyChows': 'four runs with each tile from a different suit, plus two loose suit tiles',

  'karachi.north.lailas': 'a pung of 1s, a pung of 9s in another suit, all three dragons, all four winds with one paired',
  'karachi.north.easyVirgin': '1-2-3 and a pung of 1s in one suit, all three dragons, all four winds with one paired',
  'karachi.north.oneToNinePlusFiveHonours': '1 through 9 in one suit, all four winds and one more honour',
  'karachi.north.oneToSevenPlusSevenHonours': '1 through 7 in one suit, plus all seven honours',
  'karachi.north.numbersPungs': 'the same number pungged in all three suits, all four winds and one more honour',
  'karachi.north.numbersPungs.pungPair': 'the same number pungged in all three suits, plus an honour pung and pair',
  'karachi.north.sindClubHand': 'the fixed Sind Club tiles: all seven honours, 2 and 5 bamboo, 5 dots, 7 and 8 characters, and a pair of 1 characters',
  'karachi.north.gatesOfHeaven': 'one suit only — a pung of 1s, a pung of 9s, 2 through 8, and one of those doubled',
  'karachi.north.confusedGates': 'a pung of 1s, a pung of 9s in another suit, 2 through 8 in the third with one doubled',
  'karachi.north.fourBlessings': 'a pung of every wind, plus any pair',
  'karachi.north.allHonorHand': 'four pungs of terminals or honours, and a pair of the same',
  'karachi.north.gertiesGarter': '1 through 7 in two suits',
  'karachi.north.greenJade': 'a green dragon pung, three bamboo pungs and a bamboo pair',
  'karachi.north.imperialJade': 'green tiles only — a green dragon pung, three green bamboo pungs and a pair',
  'karachi.north.royalCoral': 'a red dragon pung, three character pungs and a character pair',
  'karachi.north.royalRuby': 'a red dragon pung, then red bamboo — 1, 5, 7, 9 — pungged and paired',
  'karachi.north.rubyJade': 'red and green dragon pungs, two bamboo pungs and a bamboo pair',
  'karachi.north.lillyOfTheValley': 'a white dragon pung, three dots pungs and a dots pair',
  'karachi.north.lillypilly': 'a green dragon pung, a white dragon pair and three dots pungs',
  'karachi.north.runPungPair': '1 through 9 in one suit, plus a pung and a pair from that same suit',
  'karachi.north.montyUniqueWonders': 'one of every terminal and honour, with one of them doubled',
};

const SET_WORD: Readonly<Record<string, string>> = {
  chow: 'run',
  pung: 'pung',
  kong: 'kong',
  pungOrKong: 'pung',
  any: 'set',
};

function plural(n: number, word: string): string {
  return n === 1 ? `a ${word}` : `${n} ${word}s`;
}

/**
 * The safety net: a shape nobody has written, summarised from the pattern's own
 * components. Bland, but it cannot be wrong, and it makes an unnamed hand obvious
 * enough to notice and write properly.
 */
function genericShape(pattern: Pattern): string {
  const parts: string[] = [];
  for (const c of pattern.components) {
    const n = 'n' in c && typeof c.n === 'number' ? c.n : 1;
    switch (c.c) {
      case 'set':
        parts.push(plural(n, SET_WORD[c.of] ?? 'set'));
        break;
      case 'pair':
        parts.push(plural(n, 'pair'));
        break;
      case 'seq':
        parts.push(plural(n, `run of ${c.len}`));
        break;
      case 'run':
        parts.push(`${c.from} through ${c.to} in one suit`);
        break;
      case 'mixedRun':
        parts.push(`${c.from} through ${c.to} across the suits`);
        break;
      case 'each':
        parts.push(`one of each of ${c.kinds.length} named tiles`);
        break;
      case 'tiles':
        parts.push(plural(n, 'loose tile'));
        break;
      case 'knit':
        parts.push(plural(n, 'knitted set'));
        break;
      case 'mixedSeq':
        parts.push(plural(n, 'mixed run'));
        break;
      case 'mixedPair':
        parts.push(plural(n, 'knitted pair'));
        break;
    }
  }
  return parts.join(', ');
}

/** What players call this hand: the local name where it has one. */
export function titleOf(hand: { readonly name: string; readonly localName?: string }): string {
  return hand.localName ?? hand.name;
}

/** The hand's shape in plain words. `patterns` is only consulted for the fallback. */
export function shapeOf(patternId: string, patterns: readonly Pattern[] = []): string {
  const written = SHAPES[patternId];
  if (written) return written;
  const pattern = patterns.find((p) => p.id === patternId);
  return pattern ? genericShape(pattern) : '';
}

/** Exported for the catalogue test: every pattern the ruleset can deal should be here. */
export function hasWrittenShape(patternId: string): boolean {
  return patternId in SHAPES;
}
