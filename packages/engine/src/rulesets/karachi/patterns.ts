/**
 * Karachi-style hand patterns, transcribed from docs/RULES-KARACHI.md.
 * Everything here is data. Definitions marked `notes` with ⚠ are unconfirmed.
 */
import { DRAGON_TILES, WIND_TILES, type TileKind } from '../../tiles';
import type { Component, Pattern, Var } from '../../patterns/types';

const SRC = 'Mahjong Mates, Karachi Style Mahjong Rules (Oct 2025); T&M mapping (Mar 2026)';
const ORPHANS: readonly TileKind[] = ['m1', 'm9', 'p1', 'p9', 's1', 's9', ...WIND_TILES, ...DRAGON_TILES];
const GREEN_BAMS: readonly TileKind[] = ['s2', 's3', 's4', 's6', 's8'];
const RED_BAMS: readonly TileKind[] = ['s1', 's5', 's7', 's9'];
const CORAL: readonly TileKind[] = ['m2', 'm3', 'm4', 'm6', 'm8', 'DR'];

const XYZ: readonly Var[] = ['$X', '$Y', '$Z'];

const fiveHonours = {
  news: [
    { c: 'each', kinds: WIND_TILES },
    { c: 'tiles', n: 1, filter: { wind: true } },
  ] as const satisfies readonly Component[],
  pungPair: [
    { c: 'set', of: 'pungOrKong', filter: { honour: true } },
    { c: 'pair', filter: { honour: true } },
  ] as const satisfies readonly Component[],
};

function threeSets(of: 'chow' | 'pung', mode: 'clean' | 'each'): { components: Component[]; distinct?: readonly (readonly Var[])[] } {
  const kind = of === 'pung' ? 'pungOrKong' : 'chow';
  if (mode === 'clean') return { components: [{ c: 'set', of: kind, n: 3, filter: { suit: '$X' } }] };
  return {
    components: XYZ.map((v) => ({ c: 'set', of: kind, filter: { suit: v } }) as Component),
    distinct: [XYZ],
  };
}

/** East round general structure: three chows or three pungs (clean or one per suit) plus five honours. */
export const EAST_GENERAL: readonly Pattern[] = (['chow', 'pung'] as const).flatMap((of) =>
  (['clean', 'each'] as const).flatMap((mode) =>
    (['news', 'pungPair'] as const).map((h): Pattern => {
      const sets = threeSets(of, mode);
      return {
        id: `karachi.east.${of}s.${mode}.${h}`,
        name: `Three ${of}s (${mode === 'clean' ? 'one suit' : 'one per suit'}) + five honours (${h === 'news' ? 'NEWS + pair' : 'honour pung + pair'})`,
        source: SRC,
        components: [...sets.components, ...fiveHonours[h]],
        ...(sets.distinct ? { distinct: sets.distinct } : {}),
        tags: ['east', 'general'],
      };
    }),
  ),
);

export const GOULASH: Pattern = {
  id: 'karachi.goulash',
  name: 'Goulash',
  source: SRC,
  notes: 'Pungs only. Honour pungs need two of: dragon pung, round-wind pung, seat-wind pung. ⚠ suit constraints unknown.',
  components: [{ c: 'set', of: 'pungOrKong', n: 4 }, { c: 'pair' }],
  guard: 'karachi.goulashHonours',
  tags: ['goulash'],
};

export const EAST_NAMED: readonly Pattern[] = [
  {
    id: 'karachi.east.windyChows',
    name: 'Windy Chows',
    localName: 'Windy Chows',
    source: 'T&M p18',
    components: [...threeSets('chow', 'each').components, ...fiveHonours.news],
    distinct: [XYZ],
    tags: ['east', 'named'],
  },
  {
    id: 'karachi.east.hoveringAngels',
    name: 'Hovering Angels',
    localName: 'Chow + 5 Honors',
    source: 'T&M p17',
    notes: 'One chow per suit, pung of own wind, pair of white dragons, concealed except last.',
    components: [
      ...threeSets('chow', 'each').components,
      { c: 'set', of: 'pungOrKong', filter: { wind: true } },
      { c: 'pair', filter: { kinds: ['DW'] } },
    ],
    distinct: [XYZ],
    exposure: 'concealed',
    guard: 'karachi.ownWindPung',
    tags: ['east', 'named'],
  },
  {
    id: 'karachi.east.pinkys',
    name: 'Big Robert',
    localName: 'Pinkys',
    source: 'T&M p14',
    notes: 'Three four-tile runs, one per suit, plus a pair of winds or dragons. ⚠ verify against T&M.',
    components: [
      { c: 'seq', len: 4, suit: '$X' },
      { c: 'seq', len: 4, suit: '$Y' },
      { c: 'seq', len: 4, suit: '$Z' },
      { c: 'pair', filter: { honour: true } },
    ],
    distinct: [XYZ],
    tags: ['east', 'named'],
  },
  {
    id: 'karachi.east.dragonfly',
    name: 'Dragonfly',
    localName: 'Dragonfly',
    source: 'T&M p31',
    notes: 'One of each dragon, a pung or kong in each suit, a pair from any suit. ⚠ verify against T&M.',
    components: [
      { c: 'each', kinds: DRAGON_TILES },
      { c: 'set', of: 'pungOrKong', filter: { suit: '$X' } },
      { c: 'set', of: 'pungOrKong', filter: { suit: '$Y' } },
      { c: 'set', of: 'pungOrKong', filter: { suit: '$Z' } },
      { c: 'pair', filter: { suitTile: true } },
    ],
    distinct: [XYZ],
    tags: ['east', 'named'],
  },
  {
    id: 'karachi.east.appleBlossom',
    name: 'Apple Blossom',
    localName: 'Apple Blossom',
    source: 'T&M p19 via Sloper (T&M mixed-chow discussion)',
    notes: 'Three mixed chows (consecutive numbers, one tile from each suit, any suit order), pung or kong of white dragons, pair of green dragons.',
    components: [
      { c: 'mixedSeq', n: 3 },
      { c: 'set', of: 'pungOrKong', filter: { kinds: ['DW'] } },
      { c: 'pair', filter: { kinds: ['DG'] } },
    ],
    tags: ['east', 'named'],
  },
  // TODO(rules): The Professors (T&M p19), Windyvane / Windyfly (p28) — see docs/RULES-KARACHI.md candidates.
];

export const SOUTH: readonly Pattern[] = [
  {
    id: 'karachi.south.pungs',
    name: 'Four pungs and a pair, no honours',
    source: SRC,
    components: [{ c: 'set', of: 'pungOrKong', n: 4, filter: { suitTile: true } }, { c: 'pair', filter: { suitTile: true } }],
    tags: ['south', 'general'],
  },
  {
    id: 'karachi.south.mixed',
    name: 'Four sets and a pair, no honours',
    source: SRC,
    notes: '⚠ The article allows "mixed chows" in South; assumed to mean any chow/pung mix without honours.',
    components: [{ c: 'set', of: 'any', n: 4, filter: { suitTile: true } }, { c: 'pair', filter: { suitTile: true } }],
    tags: ['south', 'general'],
  },
  {
    id: 'karachi.south.crazyChows',
    name: 'Crazy Chows',
    localName: 'Crazy Chow',
    source: 'T&M p16',
    notes: 'Four mixed chows plus a mixed pair. Per Sloper on T&M, mixed chows need not share a suit order.',
    components: [{ c: 'mixedSeq', n: 4 }, { c: 'mixedPair' }],
    tags: ['south', 'named'],
  },
  {
    id: 'karachi.south.knitting',
    name: 'Knitting',
    localName: 'Knitting',
    source: 'T&M p20',
    notes: '⚠ Seven pairs in two suits (Western). Some sources define knitted pairs instead.',
    components: [{ c: 'pair', n: 7, filter: { suitTile: true } }],
    maxSuits: 2,
    exposure: 'concealed',
    tags: ['south', 'named'],
  },
  {
    id: 'karachi.south.dirtyPairs',
    name: 'Seven Twins',
    localName: 'Dirty Pairs',
    source: 'T&M p22',
    notes: 'Seven pairs, simples only (no terminals, no honours).',
    components: [{ c: 'pair', n: 7, filter: { simple: true } }],
    exposure: 'concealed',
    tags: ['south', 'named'],
  },
  {
    id: 'karachi.south.crochet',
    name: 'Triple Knitting',
    localName: 'Crochet',
    source: 'T&M p20',
    notes: 'Four knitted sets (same number, one per suit) plus a pair, no honours.',
    components: [{ c: 'knit', n: 4 }, { c: 'pair', filter: { suitTile: true } }],
    tags: ['south', 'named'],
  },
];

export const NORTH: readonly Pattern[] = [
  {
    id: 'karachi.north.allHonours',
    name: 'All Honor Hand',
    localName: 'All Honor Hand',
    source: 'T&M p44',
    components: [{ c: 'set', of: 'pungOrKong', n: 4, filter: { honour: true } }, { c: 'pair', filter: { honour: true } }],
    tags: ['north'],
  },
  {
    id: 'karachi.north.wrigglySnakeV1',
    name: 'Confused Gates',
    localName: 'Wriggly Snake v1',
    source: 'T&M p9',
    notes: 'Pung of 1s in one suit, 2–8 in a second, pung of 9s in the third, concealed. ⚠ 14th tile assumed to pair a 2–8 of the middle suit.',
    components: [
      { c: 'set', of: 'pung', filter: { suit: '$X', num: 1 } },
      { c: 'run', from: 2, to: 8, suit: '$Y' },
      { c: 'set', of: 'pung', filter: { suit: '$Z', num: 9 } },
      { c: 'tiles', n: 1, filter: { suit: '$Y', nums: [2, 3, 4, 5, 6, 7, 8] } },
    ],
    distinct: [XYZ],
    exposure: 'concealed',
    tags: ['north'],
  },
  {
    id: 'karachi.north.fourBlessings',
    name: 'Four Blessings',
    localName: 'Four Blessing',
    source: 'T&M p30',
    components: [{ c: 'set', of: 'pungOrKong', n: 4, filter: { wind: true } }, { c: 'pair' }],
    tags: ['north'],
  },
  {
    id: 'karachi.north.wrigglySnakeV2',
    name: 'Gates of Heaven',
    localName: 'Wriggly Snake v2',
    source: 'T&M p9',
    notes: 'One suit: pung of 1s, pung of 9s, run 2–8, one of 2–8 paired.',
    components: [
      { c: 'set', of: 'pung', filter: { suit: '$X', num: 1 } },
      { c: 'set', of: 'pung', filter: { suit: '$X', num: 9 } },
      { c: 'run', from: 2, to: 8, suit: '$X' },
      { c: 'tiles', n: 1, filter: { suit: '$X', nums: [2, 3, 4, 5, 6, 7, 8] } },
    ],
    exposure: 'concealed',
    tags: ['north'],
  },
  {
    id: 'karachi.north.gertiesGarter',
    name: "Gertie's Garter",
    localName: 'Gerties Garter',
    source: 'T&M p14',
    components: [
      { c: 'run', from: 1, to: 7, suit: '$X' },
      { c: 'run', from: 1, to: 7, suit: '$Y' },
    ],
    distinct: [['$X', '$Y']],
    tags: ['north'],
  },
  {
    id: 'karachi.north.greenJade',
    name: 'Green Jade',
    localName: 'Green Jade',
    source: 'T&M p35',
    notes: 'Sets of green bamboos (2,3,4,6,8) with a pair of green dragons. ⚠ verify.',
    components: [{ c: 'set', of: 'any', n: 4, filter: { kinds: GREEN_BAMS } }, { c: 'pair', filter: { kinds: ['DG'] } }],
    tags: ['north'],
  },
  {
    id: 'karachi.north.imperialJade',
    name: 'Imperial Jade',
    localName: 'Imperial Jade',
    source: 'T&M p36',
    notes: 'Pungs/kongs of green dragons and green bamboos, at most one chow, pair of green bamboos. ⚠ chow limit not enforced.',
    components: [{ c: 'set', of: 'any', n: 4, filter: { kinds: ['DG', ...GREEN_BAMS] } }, { c: 'pair', filter: { kinds: GREEN_BAMS } }],
    tags: ['north'],
  },
  {
    id: 'karachi.north.numberPungs.windPung',
    name: 'Numbers in Parallel',
    localName: 'Number Pungs',
    source: 'T&M p43',
    notes: 'Pungs of one number in all three suits, a pung of winds and a pair of dragons.',
    components: [
      { c: 'set', of: 'pungOrKong', filter: { suit: '$X', num: '$n' } },
      { c: 'set', of: 'pungOrKong', filter: { suit: '$Y', num: '$n' } },
      { c: 'set', of: 'pungOrKong', filter: { suit: '$Z', num: '$n' } },
      { c: 'set', of: 'pungOrKong', filter: { wind: true } },
      { c: 'pair', filter: { dragon: true } },
    ],
    distinct: [XYZ],
    tags: ['north'],
  },
  {
    id: 'karachi.north.numberPungs.dragonPung',
    name: 'Numbers in Parallel',
    localName: 'Number Pungs',
    source: 'T&M p43',
    notes: 'Pungs of one number in all three suits, a pung of dragons and a pair of winds.',
    components: [
      { c: 'set', of: 'pungOrKong', filter: { suit: '$X', num: '$n' } },
      { c: 'set', of: 'pungOrKong', filter: { suit: '$Y', num: '$n' } },
      { c: 'set', of: 'pungOrKong', filter: { suit: '$Z', num: '$n' } },
      { c: 'set', of: 'pungOrKong', filter: { dragon: true } },
      { c: 'pair', filter: { wind: true } },
    ],
    distinct: [XYZ],
    tags: ['north'],
  },
  {
    id: 'karachi.north.royalCoral',
    name: 'Royal Coral',
    localName: 'Royal Coral',
    source: 'T&M p35',
    notes: 'Sets (chows allowed) of 2,3,4,6,8 characters and red dragons; pair from the same tiles.',
    components: [{ c: 'set', of: 'any', n: 4, filter: { kinds: CORAL } }, { c: 'pair', filter: { kinds: CORAL } }],
    tags: ['north'],
  },
  {
    id: 'karachi.north.royalRuby',
    name: 'Royal Ruby',
    localName: 'Royal Ruby',
    source: 'T&M p37',
    notes: 'Pungs/kongs of red dragons and red bamboos (1,5,7,9); pair of red bamboos.',
    components: [{ c: 'set', of: 'pungOrKong', n: 4, filter: { kinds: ['DR', ...RED_BAMS] } }, { c: 'pair', filter: { kinds: RED_BAMS } }],
    tags: ['north'],
  },
  {
    id: 'karachi.north.rubyJade',
    name: 'Ruby Jade',
    localName: 'Ruby Jade',
    source: 'T&M p37',
    notes: 'Pungs/kongs of red and green dragons, red and green bamboos; pair of any bamboo.',
    components: [
      { c: 'set', of: 'pungOrKong', n: 4, filter: { kinds: ['DR', 'DG', ...RED_BAMS, ...GREEN_BAMS] } },
      { c: 'pair', filter: { suit: 's' } },
    ],
    tags: ['north'],
  },
  {
    id: 'karachi.north.runPungPair',
    name: 'Run, Pung, Pair',
    localName: 'Run, Pung, Pair',
    source: 'T&M p9',
    components: [
      { c: 'run', from: 1, to: 9, suit: '$X' },
      { c: 'set', of: 'pungOrKong', filter: { suit: '$X' } },
      { c: 'pair', filter: { suit: '$X' } },
    ],
    tags: ['north'],
  },
  {
    id: 'karachi.north.montyUniqueWonders',
    name: 'Unique Wonder',
    localName: 'Monty Unique Wonders (13 Orphans)',
    source: 'T&M p44',
    components: [
      { c: 'each', kinds: ORPHANS },
      { c: 'tiles', n: 1, filter: { kinds: ORPHANS } },
    ],
    exposure: 'concealed',
    tags: ['north'],
  },
  {
    id: 'karachi.north.wrigglySnake.news',
    name: 'Wriggly Snake',
    localName: '1-9 plus 5 Honors',
    source: 'T&M p27',
    notes: 'Run 1–9 in one suit plus NEWS with one wind paired. Concealed in Western play.',
    components: [{ c: 'run', from: 1, to: 9, suit: '$X' }, ...fiveHonours.news],
    tags: ['north'],
  },
  {
    id: 'karachi.north.wrigglySnake.pungPair',
    name: 'Wriggly Snake',
    localName: '1-9 plus 5 Honors',
    source: 'T&M p27',
    notes: '⚠ Karachi name suggests the honour pung + pair form also qualifies.',
    components: [{ c: 'run', from: 1, to: 9, suit: '$X' }, ...fiveHonours.pungPair],
    tags: ['north'],
  },
  // TODO(rules): Lilly Pilly (T&M p36), White Opal / Lilly of the Valley (p35) — definitions unknown.
];
