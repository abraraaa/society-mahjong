/**
 * Karachi hand patterns, transcribed from the Mahjong Mates Special Hands
 * Guide v4.2 (July 2026), the Karachi rules article (Oct 2025) and the
 * Karachi <-> Thompson & Maloney mapping (Mar 2026). See
 * docs/RULES-KARACHI.md for the source of every line and the open points.
 *
 * Scoring in East, South and North is a flat stake per round, so these
 * patterns decide legality and identity, not points. West and the opening
 * goulash score by the Cantonese-style calculation in ./scoring.ts.
 */
import { DRAGON_TILES, WIND_TILES, type TileKind } from '../../tiles';
import type { Component, Pattern, Var } from '../../patterns/types';

const GUIDE = 'Mahjong Mates Special Hands Guide v4.2';
const ARTICLE = 'Mahjong Mates, Karachi Style Mahjong Rules (Oct 2025)';
const ORPHANS: readonly TileKind[] = ['m1', 'm9', 'p1', 'p9', 's1', 's9', ...WIND_TILES, ...DRAGON_TILES];
const GREEN_BAMS: readonly TileKind[] = ['s2', 's3', 's4', 's6', 's8'];
const RED_BAMS: readonly TileKind[] = ['s1', 's5', 's7', 's9'];
const XYZ: readonly Var[] = ['$X', '$Y', '$Z'];

/** NEWS with one wind paired (article's East rule, and the guide's East examples). */
const NEWS_WIND_PAIRED: readonly Component[] = [
  { c: 'each', kinds: WIND_TILES },
  { c: 'tiles', n: 1, filter: { wind: true } },
];
/** NEWS plus any fifth honour (the guide's North examples add a dragon). */
const NEWS_ANY_HONOUR: readonly Component[] = [
  { c: 'each', kinds: WIND_TILES },
  { c: 'tiles', n: 1, filter: { honour: true } },
];
const HONOUR_PUNG_PAIR: readonly Component[] = [
  { c: 'set', of: 'pungOrKong', filter: { honour: true } },
  { c: 'pair', filter: { honour: true } },
];
const ALL_DRAGONS: Component = { c: 'each', kinds: DRAGON_TILES };

function threeSets(of: 'chow' | 'pung', mode: 'clean' | 'each'): { components: Component[]; distinct?: readonly (readonly Var[])[] } {
  const kind = of === 'pung' ? 'pungOrKong' : 'chow';
  if (mode === 'clean') return { components: [{ c: 'set', of: kind, n: 3, filter: { suit: '$X' } }] };
  return { components: XYZ.map((v) => ({ c: 'set', of: kind, filter: { suit: v } }) as Component), distinct: [XYZ] };
}
const CHOWS_EACH = threeSets('chow', 'each').components;

// ---------------------------------------------------------------------------
// East: three chows or three pungs (one suit, or one per suit) + five honours
// ---------------------------------------------------------------------------

/** The general East rule from the article. "Chow + 5 Honors" is the guide's name for the chow form. */
export const EAST_GENERAL: readonly Pattern[] = (['chow', 'pung'] as const).flatMap((of) =>
  (['clean', 'each'] as const).flatMap((mode) =>
    (['news', 'pungPair'] as const).map((h): Pattern => {
      const sets = threeSets(of, mode);
      return {
        id: `karachi.east.${of}s.${mode}.${h}`,
        name: `Three ${of}s (${mode === 'clean' ? 'one suit' : 'one per suit'}) + five honours (${h === 'news' ? 'NEWS, wind paired' : 'honour pung + pair'})`,
        localName: of === 'chow' ? 'Chow + 5 Honors' : 'Pung + 5 Honors',
        source: ARTICLE,
        components: [...sets.components, ...(h === 'news' ? NEWS_WIND_PAIRED : HONOUR_PUNG_PAIR)],
        ...(sets.distinct ? { distinct: sets.distinct } : {}),
        tags: ['east', 'general'],
      };
    }),
  ),
);

export const GOULASH: Pattern = {
  id: 'karachi.goulash',
  name: 'Goulash',
  source: ARTICLE,
  notes: 'Pungs only. Honour pungs need two of: dragon pung, round-wind pung, seat-wind pung. Scored by the Cantonese-style calculator.',
  components: [{ c: 'set', of: 'pungOrKong', n: 4 }, { c: 'pair' }],
  guard: 'karachi.goulashHonours',
  tags: ['goulash'],
};

export const EAST_NAMED: readonly Pattern[] = [
  {
    id: 'karachi.east.appleBlossom',
    name: 'Apple Blossom',
    source: `${GUIDE}; Sloper on T&M`,
    notes: 'Guide example: 123 in each suit + white dragon pung + green dragon pair. Sloper reads T&M as three mixed chows; the example satisfies both. Either reading accepted.',
    components: [{ c: 'mixedSeq', n: 3 }, { c: 'set', of: 'pungOrKong', filter: { kinds: ['DW'] } }, { c: 'pair', filter: { kinds: ['DG'] } }],
    tags: ['east', 'named'],
  },
  {
    id: 'karachi.east.appleBlossom.chows',
    name: 'Apple Blossom',
    source: GUIDE,
    components: [...CHOWS_EACH, { c: 'set', of: 'pungOrKong', filter: { kinds: ['DW'] } }, { c: 'pair', filter: { kinds: ['DG'] } }],
    distinct: [XYZ],
    tags: ['east', 'named'],
  },
  {
    id: 'karachi.east.windyWonders',
    name: 'Windy Wonders',
    source: GUIDE,
    notes: 'Guide example: 123 in each suit + wind pung + wind pair.',
    components: [...CHOWS_EACH, { c: 'set', of: 'pungOrKong', filter: { wind: true } }, { c: 'pair', filter: { wind: true } }],
    distinct: [XYZ],
    tags: ['east', 'named'],
  },
  {
    id: 'karachi.east.windyfly',
    name: 'Windyfly',
    localName: 'Windyfly',
    source: `${GUIDE}; T&M Windvane p28`,
    notes: 'Guide example: 111b 444d 777c + NEWS with a wind paired. Pungs one per suit.',
    components: [...threeSets('pung', 'each').components, ...NEWS_WIND_PAIRED],
    distinct: [XYZ],
    tags: ['east', 'named'],
  },
  {
    id: 'karachi.east.windyChows',
    name: 'Windy Chows',
    source: `${GUIDE}; T&M Windy Chow p18`,
    notes: 'Guide example: 456b 234d 678c + NEWS with a wind paired. Chows one per suit.',
    components: [...CHOWS_EACH, ...NEWS_WIND_PAIRED],
    distinct: [XYZ],
    tags: ['east', 'named'],
  },
  {
    id: 'karachi.east.hoveringAngel',
    name: 'Hovering Angel',
    source: `${GUIDE}; T&M p17`,
    notes: 'Guide example: 456b 234d 123c + NNN + RR. Chows one per suit, wind pung, dragon pair.',
    components: [...CHOWS_EACH, { c: 'set', of: 'pungOrKong', filter: { wind: true } }, { c: 'pair', filter: { dragon: true } }],
    distinct: [XYZ],
    tags: ['east', 'named'],
  },
  {
    id: 'karachi.east.professors',
    name: 'The Professors',
    source: `${GUIDE}; T&M p19`,
    notes: 'Guide example: 678d 456b 234c + R G Wh + SS. Chows one per suit, one of each dragon, wind pair. ⚠ Sloper reports the pair as own wind; not enforced.',
    components: [...CHOWS_EACH, ALL_DRAGONS, { c: 'pair', filter: { wind: true } }],
    distinct: [XYZ],
    tags: ['east', 'named'],
  },
  {
    id: 'karachi.east.pinkys',
    name: "Pinky's Hand",
    source: `${GUIDE}; T&M Big Robert p14`,
    notes: 'Guide: 1234 in each suit + WW; T&M Big Robert: 4567 in each suit + EE. Same four-tile run in every suit, wind pair.',
    components: [
      { c: 'seq', len: 4, suit: '$X', start: '$n' },
      { c: 'seq', len: 4, suit: '$Y', start: '$n' },
      { c: 'seq', len: 4, suit: '$Z', start: '$n' },
      { c: 'pair', filter: { wind: true } },
    ],
    distinct: [XYZ],
    tags: ['east', 'named'],
  },
  {
    id: 'karachi.east.monty',
    name: 'Monty',
    source: GUIDE,
    notes: "As Pinky's Hand with a dragon pair. The article's comments confirm Monty's hand carries a pair of dragons.",
    components: [
      { c: 'seq', len: 4, suit: '$X', start: '$n' },
      { c: 'seq', len: 4, suit: '$Y', start: '$n' },
      { c: 'seq', len: 4, suit: '$Z', start: '$n' },
      { c: 'pair', filter: { dragon: true } },
    ],
    distinct: [XYZ],
    tags: ['east', 'named'],
  },
  {
    id: 'karachi.east.khalidas',
    name: "Khalida's Hand",
    source: GUIDE,
    notes: 'Guide example: 1d 2b 3d 4d 5b 6c 7c 8b 9c + E S W N N. A 1–9 run with each tile from any suit, plus NEWS with a wind paired.',
    components: [{ c: 'mixedRun', from: 1, to: 9 }, ...NEWS_WIND_PAIRED],
    tags: ['east', 'named'],
  },
  {
    id: 'karachi.east.nailas',
    name: "Naila's Hand",
    source: GUIDE,
    notes: 'Guide example: 123b 345b 123d 345c + NN. ⚠ Generalised as 1-2-3 and 3-4-5 in one suit, 1-2-3 in a second, 3-4-5 in the third, wind pair.',
    components: [
      { c: 'seq', len: 3, suit: '$X', start: 1 },
      { c: 'seq', len: 3, suit: '$X', start: 3 },
      { c: 'seq', len: 3, suit: '$Y', start: 1 },
      { c: 'seq', len: 3, suit: '$Z', start: 3 },
      { c: 'pair', filter: { wind: true } },
    ],
    distinct: [XYZ],
    tags: ['east', 'named'],
  },
  {
    id: 'karachi.east.dragonfly',
    name: 'Dragonfly',
    source: `${GUIDE}; T&M p31`,
    notes: 'Guide example: R G Wh + 333b 555d 777c + 44b. One of each dragon, a pung in each suit, a pair from any suit.',
    components: [
      ALL_DRAGONS,
      { c: 'set', of: 'pungOrKong', filter: { suit: '$X' } },
      { c: 'set', of: 'pungOrKong', filter: { suit: '$Y' } },
      { c: 'set', of: 'pungOrKong', filter: { suit: '$Z' } },
      { c: 'pair', filter: { suitTile: true } },
    ],
    distinct: [XYZ],
    tags: ['east', 'named'],
  },
];

// ---------------------------------------------------------------------------
// South: no honours
// ---------------------------------------------------------------------------

export const SOUTH: readonly Pattern[] = [
  {
    id: 'karachi.south.anyDamnHand',
    name: 'Any Damn Hand',
    source: `${GUIDE}; ${ARTICLE}`,
    notes: 'Four sets and a pair with no honours; chows and pungs may mix. Guide example: 123b 456b 123d 456d 77c.',
    components: [{ c: 'set', of: 'any', n: 4, filter: { suitTile: true } }, { c: 'pair', filter: { suitTile: true } }],
    tags: ['south', 'general'],
  },
  {
    id: 'karachi.south.dirtyPairs',
    name: 'Dirty Pairs',
    source: `${GUIDE}; T&M Seven Twins p22`,
    notes: 'Seven pairs of suit tiles across any suits. ⚠ The mapping PDF says "no terminals or honours"; the guide example includes a pair of 1b. Terminals allowed here.',
    components: [{ c: 'pair', n: 7, filter: { suitTile: true } }],
    exposure: 'concealed',
    tags: ['south', 'named'],
  },
  {
    id: 'karachi.south.dirtyGertiesGarter',
    name: "Dirty Gertie's Garter",
    source: GUIDE,
    notes: '1–7 in two suits.',
    components: [{ c: 'run', from: 1, to: 7, suit: '$X' }, { c: 'run', from: 1, to: 7, suit: '$Y' }],
    distinct: [['$X', '$Y']],
    tags: ['south', 'named'],
  },
  {
    id: 'karachi.south.knitting',
    name: 'Knitting',
    source: `${GUIDE}; T&M p20`,
    notes: 'Seven knitted pairs: each pair is the same number in two suits, the same two suits throughout. Guide example: 1b1d 2b2d 4b4d 5b5d 7b7d 8b8d 9b9d.',
    components: [{ c: 'mixedPair', n: 7 }],
    maxSuits: 2,
    exposure: 'concealed',
    tags: ['south', 'named'],
  },
  {
    id: 'karachi.south.crochet',
    name: 'Crochet',
    source: `${GUIDE}; T&M Triple Knitting p20`,
    notes: 'Four knitted sets (same number, one per suit) and a pair. Guide example: 1b1d1c 4b4d4c 7b7d7c 7b7d7c 4b4b.',
    components: [{ c: 'knit', n: 4 }, { c: 'pair', filter: { suitTile: true } }],
    tags: ['south', 'named'],
  },
  {
    id: 'karachi.south.crazyChows',
    name: 'Crazy Chows',
    source: `${GUIDE}; T&M p16`,
    notes: 'Four mixed chows plus two suit tiles. ⚠ The guide example ends 3b 7d, which is not a pair of any kind; the tail is left as any two suit tiles.',
    components: [{ c: 'mixedSeq', n: 4 }, { c: 'tiles', n: 2, filter: { suitTile: true } }],
    tags: ['south', 'named'],
  },
];

// ---------------------------------------------------------------------------
// North: big hands only
// ---------------------------------------------------------------------------

/** "dragon pung + three pungs of one suit + pair of that suit": the jade/coral/ruby family. */
function dragonSuitHand(id: string, name: string, dragon: TileKind, suitKinds: readonly TileKind[] | null, suit: 's' | 'p' | 'm', source: string, notes: string, extra: Component[] = []): Pattern {
  const suitFilter = suitKinds ? { kinds: suitKinds } : { suit };
  return {
    id,
    name,
    source,
    notes,
    components: [
      { c: 'set', of: 'pungOrKong', filter: { kinds: [dragon] } },
      ...extra,
      { c: 'set', of: 'pungOrKong', n: 3 - (extra.length > 0 ? 1 : 0), filter: suitFilter },
      { c: 'pair', filter: suitFilter },
    ],
    tags: ['north', 'named'],
  };
}

export const NORTH: readonly Pattern[] = [
  {
    id: 'karachi.north.lailas',
    name: "Laila's Hand",
    source: GUIDE,
    notes: 'Guide example: 111d 999b + R G Wh + N E W S(paired). Pung of 1s in one suit, pung of 9s in another, one of each dragon, NEWS with a wind paired.',
    components: [
      { c: 'set', of: 'pungOrKong', filter: { suit: '$X', num: 1 } },
      { c: 'set', of: 'pungOrKong', filter: { suit: '$Y', num: 9 } },
      ALL_DRAGONS,
      ...NEWS_WIND_PAIRED,
    ],
    distinct: [['$X', '$Y']],
    tags: ['north', 'named'],
  },
  {
    id: 'karachi.north.easyVirgin',
    name: 'Easy Virgin',
    source: GUIDE,
    notes: 'Guide example: 123b 111b + R G Wh + E S N W(paired). A 1-2-3 chow and a pung of 1s in the same suit, one of each dragon, NEWS with a wind paired.',
    components: [
      { c: 'seq', len: 3, suit: '$X', start: 1 },
      { c: 'set', of: 'pungOrKong', filter: { suit: '$X', num: 1 } },
      ALL_DRAGONS,
      ...NEWS_WIND_PAIRED,
    ],
    tags: ['north', 'named'],
  },
  {
    id: 'karachi.north.oneToNinePlusFiveHonours',
    name: '1-9 plus 5 Honors',
    source: `${GUIDE}; T&M Wriggly Snake p27`,
    notes: 'Guide example: 1–9 bamboo + E S W N + R. A 1–9 run in one suit plus NEWS and any fifth honour.',
    components: [{ c: 'run', from: 1, to: 9, suit: '$X' }, ...NEWS_ANY_HONOUR],
    tags: ['north', 'named'],
  },
  {
    id: 'karachi.north.oneToSevenPlusSevenHonours',
    name: '1-7 plus 7 Honors',
    source: GUIDE,
    notes: 'Guide example: 1–7 bamboo + E S W N + R G Wh. Also Hitler\'s Blunder (Parsi), Seventh Heaven (Mumbai).',
    components: [{ c: 'run', from: 1, to: 7, suit: '$X' }, { c: 'each', kinds: WIND_TILES }, ALL_DRAGONS],
    tags: ['north', 'named'],
  },
  {
    id: 'karachi.north.numbersPungs',
    name: 'Numbers Pungs',
    source: `${GUIDE}; T&M Numbers in Parallel p43`,
    notes: 'Guide example: 555b 555d 555c + E S W N + R. Pungs of one number in all three suits plus NEWS and any fifth honour.',
    components: [
      { c: 'set', of: 'pungOrKong', filter: { suit: '$X', num: '$n' } },
      { c: 'set', of: 'pungOrKong', filter: { suit: '$Y', num: '$n' } },
      { c: 'set', of: 'pungOrKong', filter: { suit: '$Z', num: '$n' } },
      ...NEWS_ANY_HONOUR,
    ],
    distinct: [XYZ],
    tags: ['north', 'named'],
  },
  {
    id: 'karachi.north.numbersPungs.pungPair',
    name: 'Numbers Pungs',
    source: 'T&M Numbers in Parallel (guide example: EEE SS 555b 555d 555c)',
    notes: 'The Western form: pungs of one number in all three suits plus an honour pung and an honour pair.',
    components: [
      { c: 'set', of: 'pungOrKong', filter: { suit: '$X', num: '$n' } },
      { c: 'set', of: 'pungOrKong', filter: { suit: '$Y', num: '$n' } },
      { c: 'set', of: 'pungOrKong', filter: { suit: '$Z', num: '$n' } },
      ...HONOUR_PUNG_PAIR,
    ],
    distinct: [XYZ],
    tags: ['north', 'named'],
  },
  {
    id: 'karachi.north.sindClubHand',
    name: 'Sind Club Hand',
    source: GUIDE,
    notes: 'A fixed hand: R G Wh E S W N + 2b 5b 5d 1c 8c 7c 1c. The pair is 1c.',
    components: [
      { c: 'each', kinds: [...DRAGON_TILES, ...WIND_TILES, 's2', 's5', 'p5', 'm8', 'm7'] },
      { c: 'pair', filter: { kinds: ['m1'] } },
    ],
    tags: ['north', 'named'],
  },
  {
    id: 'karachi.north.gatesOfHeaven',
    name: 'Gates of Heaven',
    localName: 'Monty Wriggly Snake v2',
    source: `${GUIDE}; T&M p9`,
    notes: 'One suit: pung of 1s, pung of 9s, 2–8, one of 2–8 paired.',
    components: [
      { c: 'set', of: 'pungOrKong', filter: { suit: '$X', num: 1 } },
      { c: 'set', of: 'pungOrKong', filter: { suit: '$X', num: 9 } },
      { c: 'run', from: 2, to: 8, suit: '$X' },
      { c: 'tiles', n: 1, filter: { suit: '$X', nums: [2, 3, 4, 5, 6, 7, 8] } },
    ],
    tags: ['north', 'named'],
  },
  {
    id: 'karachi.north.confusedGates',
    name: 'Confused Gates',
    localName: 'Wriggly Snake v1',
    source: `${GUIDE}; T&M p9`,
    notes: 'Guide example: 111b 999d 2c..8c 5c(paired). Pung of 1s, pung of 9s, 2–8 in the third suit with one of 2–8 paired.',
    components: [
      { c: 'set', of: 'pungOrKong', filter: { suit: '$X', num: 1 } },
      { c: 'set', of: 'pungOrKong', filter: { suit: '$Y', num: 9 } },
      { c: 'run', from: 2, to: 8, suit: '$Z' },
      { c: 'tiles', n: 1, filter: { suit: '$Z', nums: [2, 3, 4, 5, 6, 7, 8] } },
    ],
    distinct: [XYZ],
    tags: ['north', 'named'],
  },
  {
    id: 'karachi.north.fourBlessings',
    name: 'Four Blessings',
    source: `${GUIDE}; T&M p30`,
    components: [{ c: 'set', of: 'pungOrKong', n: 4, filter: { wind: true } }, { c: 'pair' }],
    tags: ['north', 'named'],
  },
  {
    id: 'karachi.north.allHonorHand',
    name: 'All Honor Hand',
    source: `${GUIDE}; T&M p44`,
    notes: 'Guide example: 111b 999d EEE NNN RR. Pungs of terminals and honours, honour pair. ⚠ terminal pair assumed allowed.',
    components: [
      { c: 'set', of: 'pungOrKong', n: 4, filter: { kinds: [...ORPHANS] } },
      { c: 'pair', filter: { kinds: [...ORPHANS] } },
    ],
    tags: ['north', 'named'],
  },
  {
    id: 'karachi.north.gertiesGarter',
    name: "Gertie's Garter",
    source: `${GUIDE}; T&M p14`,
    components: [{ c: 'run', from: 1, to: 7, suit: '$X' }, { c: 'run', from: 1, to: 7, suit: '$Y' }],
    distinct: [['$X', '$Y']],
    tags: ['north', 'named'],
  },
  dragonSuitHand('karachi.north.greenJade', 'Green Jade', 'DG', null, 's', `${GUIDE}; T&M p35`, 'Guide example: GGG 111b 444b 777b 88b. Green dragon pung, three bamboo pungs, bamboo pair. The guide lists "Ruby Jade" as its Karachi alias.'),
  dragonSuitHand('karachi.north.imperialJade', 'Imperial Jade', 'DG', ['DG', ...GREEN_BAMS], 's', `${GUIDE}; T&M p36`, 'Guide example: GGG 222b 333b 444b 66b. Green tiles only.'),
  dragonSuitHand('karachi.north.royalCoral', 'Royal Coral', 'DR', null, 'm', `${GUIDE}; T&M Red Coral p35`, 'Guide example: RRR 333c 555c 888c 99c. Red dragon pung, three character pungs, character pair.'),
  dragonSuitHand('karachi.north.royalRuby', 'Royal Ruby', 'DR', ['DR', ...RED_BAMS], 's', `${GUIDE}; T&M p37`, 'Guide example: RRR 111b 555b 777b 99b. Red dragon pung, red bamboo pungs and pair.'),
  dragonSuitHand('karachi.north.rubyJade', 'Ruby Jade', 'DR', null, 's', `${GUIDE}; T&M p37`, 'Guide example: RRR GGG 111b 222b 66b. Red and green dragon pungs, two bamboo pungs, bamboo pair.', [{ c: 'set', of: 'pungOrKong', filter: { kinds: ['DG'] } }]),
  dragonSuitHand('karachi.north.lillyOfTheValley', 'Lilly of the Valley (Monty ver)', 'DW', null, 'p', `${GUIDE} White Opal; mapping PDF`, 'T&M White Opal maps to this Karachi name: white dragon pung, three dots pungs, dots pair. Guide example: WhWhWh 222d 666d 999d 44d.'),
  {
    id: 'karachi.north.lillypilly',
    name: 'Lillypilly',
    source: `${GUIDE}; T&M p36`,
    notes: 'Guide example: GGG WhWh 444d 666d 999d. Green dragon pung, white dragon pair, three dots pungs.',
    components: [
      { c: 'set', of: 'pungOrKong', filter: { kinds: ['DG'] } },
      { c: 'pair', filter: { kinds: ['DW'] } },
      { c: 'set', of: 'pungOrKong', n: 3, filter: { suit: 'p' } },
    ],
    tags: ['north', 'named'],
  },
  {
    id: 'karachi.north.runPungPair',
    name: 'Run, Pung & Pair',
    source: `${GUIDE}; T&M p9`,
    notes: 'Guide example: 1–9 dots + 888d + 22d. One suit.',
    components: [
      { c: 'run', from: 1, to: 9, suit: '$X' },
      { c: 'set', of: 'pungOrKong', filter: { suit: '$X' } },
      { c: 'pair', filter: { suit: '$X' } },
    ],
    tags: ['north', 'named'],
  },
  {
    id: 'karachi.north.montyUniqueWonders',
    name: 'Monty Unique Wonders',
    localName: '13 Orphans',
    source: `${GUIDE}; T&M Unique Wonder p44`,
    components: [{ c: 'each', kinds: ORPHANS }, { c: 'tiles', n: 1, filter: { kinds: ORPHANS } }],
    exposure: 'concealed',
    tags: ['north', 'named'],
  },
];
