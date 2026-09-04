import type { TileKind } from '@society/engine';

/**
 * The words a first-timer meets at the table, each explained the way a friend
 * would across the felt: one or two sentences, and tiles to look at where that
 * says it better. Anything the coach says is scanned for these (`annotate`), so
 * every "pung" and "goulash" in the bubble can be tapped.
 */
export type Term =
  | 'pung'
  | 'kong'
  | 'chow'
  | 'pair'
  | 'set'
  | 'honours'
  | 'winds'
  | 'dragons'
  | 'suits'
  | 'goulash'
  | 'wall'
  | 'discard'
  | 'river'
  | 'claim'
  | 'mahjong'
  | 'selfDrawn'
  | 'dealer'
  | 'roundWind'
  | 'seatWind'
  | 'bonus'
  | 'exchange'
  | 'terminals'
  | 'concealed'
  | 'exposed'
  | 'draw';

export interface TermEntry {
  readonly label: string;
  /** the one-line version, for footnotes under the bubble */
  readonly short: string;
  /** the fuller version, for the sheet */
  readonly long: string;
  readonly example?: readonly TileKind[];
  /** words and phrases that mean this term; longest first when they overlap */
  readonly aliases: readonly string[];
}

export const GLOSSARY: Readonly<Record<Term, TermEntry>> = {
  pung: {
    label: 'Pung',
    short: 'three of the same tile',
    long: 'Three identical tiles. You can build one from the wall, or take a discard to complete it when you already hold two — that is what the Pung button does.',
    example: ['m5', 'm5', 'm5'],
    aliases: ['pungs', 'pung', 'pungged', 'three of a kind'],
  },
  kong: {
    label: 'Kong',
    short: 'four of the same tile',
    long: 'Four identical tiles. Declaring one earns a replacement tile from the back of the wall. A pung you already hold can grow into a kong.',
    example: ['p2', 'p2', 'p2', 'p2'],
    aliases: ['kongs', 'kong'],
  },
  chow: {
    label: 'Run',
    short: 'three in a row, one suit',
    long: 'Three tiles in sequence in one suit, like 3-4-5 of bamboo. Also called a chow. In Karachi rules a run can only be made from tiles you draw; nobody’s discard ever completes one.',
    example: ['s3', 's4', 's5'],
    aliases: ['runs', 'run', 'chows', 'chow', 'sequence'],
  },
  pair: {
    label: 'Pair',
    short: 'two of the same tile',
    long: 'Two identical tiles. Nearly every winning hand needs exactly one pair, sometimes called the eyes.',
    example: ['DR', 'DR'],
    aliases: ['pairs', 'paired', 'pair'],
  },
  set: {
    label: 'Set',
    short: 'a pung, kong or run',
    long: 'Any of the three groups of tiles a hand is built from: a pung, a kong or a run. “Four sets and a pair” is the standard shape of a hand.',
    aliases: ['sets', 'set'],
  },
  honours: {
    label: 'Honours',
    short: 'the winds and dragons',
    long: 'The tiles that are not numbered: the four winds (East, South, West, North) and the three dragons (red, green, white). Some rounds want them, some forbid them.',
    example: ['WE', 'WS', 'WW', 'WN', 'DR', 'DG', 'DW'],
    aliases: ['honours', 'honour', 'honors', 'honor'],
  },
  winds: {
    label: 'Winds',
    short: 'East, South, West, North',
    long: 'Four tiles named for the compass points. Each seat has a wind, each round has a wind, and a hand wanting “all four winds with one paired” wants E, S, W, N with one of them doubled.',
    example: ['WE', 'WS', 'WW', 'WN'],
    aliases: ['winds', 'wind', 'east wind', 'south wind', 'west wind', 'north wind'],
  },
  dragons: {
    label: 'Dragons',
    short: 'red, green and white',
    long: 'Three tiles: red (the character 中), green (發) and white (a blank or framed tile). Together with the winds they make up the honours.',
    example: ['DR', 'DG', 'DW'],
    aliases: ['dragons', 'dragon', 'red dragon', 'green dragon', 'white dragon'],
  },
  suits: {
    label: 'Suits',
    short: 'characters, bamboo, dots — 1 to 9 each',
    long: 'The three numbered families, each running 1 to 9 with four copies of every tile: characters (the red numerals), bamboo (sticks, with a bird for the 1) and dots (circles).',
    example: ['m1', 's1', 'p1'],
    aliases: ['suits', 'suit', 'characters', 'bamboo', 'dots'],
  },
  goulash: {
    label: 'Goulash',
    short: 'four pungs and a pair, no runs',
    long: 'The Karachi table’s opening hand and the whole of the West round: four pungs (or kongs) and a pair, with no runs anywhere. Honour pungs are only allowed when you hold two of: a dragon pung, the round wind, your own wind.',
    aliases: ['goulash'],
  },
  wall: {
    label: 'Wall',
    short: 'the face-down tiles you draw from',
    long: 'All the tiles not yet in anyone’s hand, stacked face down. Each turn you draw one from it. When it runs out with no winner, the hand is washed out.',
    aliases: ['the wall', 'wall'],
  },
  discard: {
    label: 'Discard',
    short: 'the tile you throw away each turn',
    long: 'After drawing, you throw one tile face up into the middle. That is your discard, and for a few seconds the others may claim it.',
    aliases: ['discards', 'discarded', 'discarding', 'discard'],
  },
  river: {
    label: 'River',
    short: 'the discards, in order',
    long: 'Every tile thrown away so far, in the order it happened. Reading it tells you which tiles are already gone — tap a tile in your hand to see how many copies are out.',
    aliases: ['river'],
  },
  claim: {
    label: 'Claim',
    short: 'taking someone’s discard for your hand',
    long: 'When a discard completes a pung, kong or your winning hand, you may take it instead of drawing. A sheet opens with the choices; claiming exposes that set face up.',
    aliases: ['claiming', 'claimed', 'claims', 'claim'],
  },
  mahjong: {
    label: 'Mahjong',
    short: 'a complete winning hand',
    long: 'The call when your hand is complete. In these rules a hand is complete only when it matches one of the round’s named patterns, which is what the coach is steering you toward.',
    aliases: ['mahjong'],
  },
  selfDrawn: {
    label: 'Off the wall',
    short: 'winning on your own draw',
    long: 'Completing your hand with the tile you drew, rather than with someone’s discard. Also called self-drawn; some tables pay it more.',
    aliases: ['off the wall', 'self-drawn', 'self drawn'],
  },
  dealer: {
    label: 'Dealer',
    short: 'East, who starts the hand',
    long: 'The player in the East seat. The dealer draws first and, at many tables, pays and receives double.',
    aliases: ['dealer'],
  },
  roundWind: {
    label: 'Round wind',
    short: 'the wind the whole table is on',
    long: 'A game runs through four rounds — East, South, West, North — and each round has its wind. In Karachi rules the round also decides which hands are allowed.',
    aliases: ['round wind'],
  },
  seatWind: {
    label: 'Your own wind',
    short: 'the wind of your seat',
    long: 'Each seat is a wind: the dealer is East, then South, West and North to the right. A pung of your own wind counts for more in most rules.',
    aliases: ['your own wind', 'own wind', 'seat wind'],
  },
  bonus: {
    label: 'Flowers',
    short: 'bonus tiles, set aside on sight',
    long: 'Flower and season tiles are not part of any hand. When you draw one it is set aside face up and you draw a replacement. Some tables score them.',
    example: ['F1', 'S1'],
    aliases: ['flowers', 'flower', 'seasons', 'season', 'bonus tiles', 'bonus tile'],
  },
  exchange: {
    label: 'Exchange',
    short: 'passing three tiles before play',
    long: 'Before a goulash hand in the West round, everyone passes three tiles to the right, then across, then to the left. The coach picks tiles no hand of yours is using.',
    aliases: ['exchange'],
  },
  terminals: {
    label: 'Terminals',
    short: 'the 1s and 9s',
    long: 'The 1 and 9 of each suit — the ends of the runs. Several big hands are built from terminals and honours only.',
    example: ['m1', 'm9', 's1', 's9', 'p1', 'p9'],
    aliases: ['terminals', 'terminal'],
  },
  concealed: {
    label: 'Concealed',
    short: 'still hidden in your hand',
    long: 'Tiles nobody else can see. A set you build entirely from the wall stays concealed; one you claim is exposed.',
    aliases: ['concealed'],
  },
  exposed: {
    label: 'Exposed',
    short: 'a set laid face up after a claim',
    long: 'A set you completed by claiming a discard. It is placed face up and cannot change; the rest of your hand stays hidden.',
    aliases: ['exposed'],
  },
  draw: {
    label: 'Washed out',
    short: 'the wall ran out with no winner',
    long: 'Nobody completed a hand before the wall ran dry. No points change hands and the next hand is dealt.',
    aliases: ['washed out', 'wall out', 'wall ran dry'],
  },
};

export const TERMS = Object.keys(GLOSSARY) as Term[];

/** A run of text, tagged with the term it names when it names one. */
export interface Annotated {
  readonly text: string;
  readonly term?: Term;
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const ALIASES: readonly { alias: string; term: Term }[] = TERMS.flatMap((term) => GLOSSARY[term].aliases.map((alias) => ({ alias, term }))).sort((a, b) => b.alias.length - a.alias.length);
const PATTERN = new RegExp(`\\b(${ALIASES.map((a) => escape(a.alias)).join('|')})\\b`, 'gi');
const BY_ALIAS = new Map(ALIASES.map((a) => [a.alias.toLowerCase(), a.term]));

/** Split text into runs, tagging each glossary word or phrase. */
export function annotate(text: string): Annotated[] {
  const out: Annotated[] = [];
  let last = 0;
  for (const m of text.matchAll(PATTERN)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: text.slice(last, i) });
    const term = BY_ALIAS.get(m[0].toLowerCase());
    out.push(term ? { text: m[0], term } : { text: m[0] });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** The distinct terms a piece of text mentions, in order of first appearance. */
export function termsIn(text: string): Term[] {
  const seen = new Set<Term>();
  for (const a of annotate(text)) if (a.term) seen.add(a.term);
  return [...seen];
}
