import { DRAGON_TILES, WIND_TILES, type TileKind } from '../../tiles';
import { standardPattern, type Pattern } from '../../patterns/types';

const ORPHANS: readonly TileKind[] = ['m1', 'm9', 'p1', 'p9', 's1', 's9', ...WIND_TILES, ...DRAGON_TILES];

export const TW_STANDARD: Pattern = standardPattern(5, 'taiwanese.standard', 'Five sets and a pair');

export const TW_NICO_NICO: Pattern = {
  id: 'taiwanese.nicoNico',
  name: 'Nico Nico',
  localName: '七對半',
  source: 'Mahjong Dubai rulebook',
  notes: 'Seven pairs and one pung, fully concealed.',
  components: [{ c: 'pair', n: 7 }, { c: 'set', of: 'pung' }],
  exposure: 'concealed',
  tags: ['special'],
};

export const TW_THIRTEEN_ORPHANS: Pattern = {
  id: 'taiwanese.thirteenOrphans',
  name: '13 Orphans',
  source: 'Mahjong Dubai rulebook (House/Advanced)',
  notes: 'One each of the orphans, any set, plus one honour tile for the pair. 17 tiles.',
  components: [
    { c: 'each', kinds: ORPHANS },
    { c: 'set', of: 'any' },
    { c: 'tiles', n: 1, filter: { honour: true } },
  ],
  exposure: 'concealed',
  tags: ['special', 'house'],
};

export const TW_PATTERNS_STANDARD: readonly Pattern[] = [TW_STANDARD, TW_NICO_NICO];
export const TW_PATTERNS_HOUSE: readonly Pattern[] = [TW_STANDARD, TW_NICO_NICO, TW_THIRTEEN_ORPHANS];
