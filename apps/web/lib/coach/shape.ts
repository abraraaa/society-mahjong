import type { Pattern } from '@society/engine';

/**
 * What each hand actually looks like, in the words a player would use at the table.
 *
 * A name alone teaches nobody: "Windy Chows" means something only once you've
 * been told it's a run in each suit plus all four winds with one paired. Every
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

  'karachi.east.appleBlossom': 'three mixed-suit runs, a white dragon pung and a green dragon pair',
  'karachi.east.appleBlossom.chows': 'a run in each suit, a white dragon pung and a green dragon pair',
  'karachi.east.windyWonders': 'a run in each suit, a wind pung and a wind pair',
  'karachi.east.windyfly': 'a pung in each suit, plus all four winds with one paired',
  'karachi.east.windyChows': 'a run in each suit, plus all four winds with one paired',
  'karachi.east.hoveringAngel': 'a run in each suit, a wind pung and a dragon pair',
  'karachi.east.professors': 'a run in each suit, one of each dragon and a wind pair',
  'karachi.east.pinkys': 'the same four-tile run in all three suits, plus a wind pair',
  'karachi.east.monty': 'the same four-tile run in all three suits, plus a dragon pair',
  'karachi.east.khalidas': '1 to 9 across the suits, plus all four winds with one paired',
  'karachi.east.nailas': '1-2-3 and 3-4-5 in one suit, one of each in the others, a wind pair',
  'karachi.east.dragonfly': 'one of each dragon, a pung in each suit and a pair from any suit',

  'karachi.south.anyDamnHand': 'any four sets (runs or pungs) and a pair, with no winds or dragons',
  'karachi.south.dirtyPairs': 'seven pairs of suit tiles, nothing exposed',
  'karachi.south.dirtyGertiesGarter': '1 to 7 in two suits',
  'karachi.south.knitting': 'seven pairs, each the same number in the same two suits',
  'karachi.south.crochet': 'four trios, each one number in all three suits, plus a pair',
  'karachi.south.crazyChows': 'four runs, each tile from a different suit, and two loose tiles',

  'karachi.north.lailas': '1s and 9s pungs in two suits, each dragon, four winds with one paired',
  'karachi.north.easyVirgin': '1-2-3 and 1-1-1 in one suit, each dragon, four winds with one paired',
  'karachi.north.oneToNinePlusFiveHonours': '1 to 9 in one suit, all four winds and one more honour',
  'karachi.north.oneToSevenPlusSevenHonours': '1 to 7 in one suit, plus all seven honours',
  'karachi.north.numbersPungs': 'a pung of the same number in each suit, four winds and one more honour',
  'karachi.north.numbersPungs.pungPair': 'a pung of the same number in each suit, plus an honour pung and pair',
  'karachi.north.sindClubHand': 'a fixed hand of all seven honours and seven particular suit tiles',
  'karachi.north.gatesOfHeaven': 'pungs of 1s and 9s, 2 to 8, one tile doubled, all one suit',
  'karachi.north.confusedGates': '1s and 9s pungs in two suits, 2 to 8 in the third, one doubled',
  'karachi.north.fourBlessings': 'a pung of every wind, plus any pair',
  'karachi.north.allHonorHand': 'four pungs of terminals or honours, and a pair of the same',
  'karachi.north.gertiesGarter': '1 to 7 in two suits',
  'karachi.north.greenJade': 'a green dragon pung, three bamboo pungs and a bamboo pair',
  'karachi.north.imperialJade': 'only green tiles, with a green dragon pung, three pungs and a pair',
  'karachi.north.royalCoral': 'a red dragon pung, three character pungs and a character pair',
  'karachi.north.royalRuby': 'a red dragon pung, then pungs and a pair of 1, 5, 7, 9 bamboo',
  'karachi.north.rubyJade': 'red and green dragon pungs, two bamboo pungs and a bamboo pair',
  'karachi.north.lillyOfTheValley': 'a white dragon pung, three dots pungs, a dots pair',
  'karachi.north.lillypilly': 'a green dragon pung, a white dragon pair and three dots pungs',
  'karachi.north.runPungPair': '1 to 9 in one suit, plus a pung and a pair in that suit',
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
        parts.push(`${c.from} to ${c.to} in one suit`);
        break;
      case 'mixedRun':
        parts.push(`${c.from} to ${c.to} across the suits`);
        break;
      case 'each':
        parts.push(`one of each of ${c.kinds.length} named tiles`);
        break;
      case 'tiles':
        parts.push(plural(n, 'loose tile'));
        break;
      case 'knit':
        parts.push(plural(n, 'trio of one number'));
        break;
      case 'mixedSeq':
        parts.push(plural(n, 'mixed run'));
        break;
      case 'mixedPair':
        parts.push(plural(n, 'pair of one number in two suits'));
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

/**
 * A hand's footnote, for a title that names more than one pattern and whose
 * patterns differ: one line that's true of every one of them. Only those
 * titles are here (shape.test.ts checks it), so a footnote made from a single
 * pattern reads the same as one made from the whole round.
 */
export const TITLE_SHAPES: Readonly<Record<string, string>> = {
  'Chow + 5 Honours': 'three runs, one suit or one per suit, plus five winds and dragons',
  'Pung + 5 Honours': 'three pungs, one suit or one per suit, plus five winds and dragons',
  'Numbers Pungs': 'a pung of the same number in each suit, plus five winds and dragons',
  'Apple Blossom': 'three runs, a white dragon pung and a green dragon pair',
};

/** A hand's footnote line: the shape every pattern with this title shares, or `TITLE_SHAPES[title]` where they differ. */
export function noteShapeOf(title: string, patterns: readonly Pattern[]): string {
  if (Object.prototype.hasOwnProperty.call(TITLE_SHAPES, title)) return TITLE_SHAPES[title]!;
  const same = patterns.filter((p) => titleOf(p) === title);
  return same.length > 0 ? shapeOf(same[0]!.id, patterns) : '';
}

/** Exported for the catalogue test: every pattern the ruleset can deal should be here. */
export function hasWrittenShape(patternId: string): boolean {
  return patternId in SHAPES;
}
