/**
 * Tile model. Kinds are short string codes:
 *   suits   m1..m9 (characters / wan), p1..p9 (dots / circles), s1..s9 (bamboo)
 *   winds   WE WS WW WN
 *   dragons DR (red) DG (green) DW (white)
 *   bonus   F1..F4 (flowers / blossoms), S1..S4 (seasons)
 * Suit tiles are lowercase, everything else uppercase, so codes never collide.
 */
export type Suit = 'm' | 'p' | 's';
export const SUITS: readonly Suit[] = ['m', 'p', 's'];
export type Num = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export const NUMS: readonly Num[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];
export type SuitTile = `${Suit}${Num}`;
export type Wind = 'E' | 'S' | 'W' | 'N';
export const WINDS: readonly Wind[] = ['E', 'S', 'W', 'N'];
export type WindTile = `W${Wind}`;
export const WIND_TILES: readonly WindTile[] = ['WE', 'WS', 'WW', 'WN'];
export type DragonTile = 'DR' | 'DG' | 'DW';
export const DRAGON_TILES: readonly DragonTile[] = ['DR', 'DG', 'DW'];
export type HonourTile = WindTile | DragonTile;
export const HONOUR_TILES: readonly HonourTile[] = [...WIND_TILES, ...DRAGON_TILES];
export type FlowerTile = 'F1' | 'F2' | 'F3' | 'F4';
export type SeasonTile = 'S1' | 'S2' | 'S3' | 'S4';
export type BonusTile = FlowerTile | SeasonTile;
export const FLOWER_TILES: readonly FlowerTile[] = ['F1', 'F2', 'F3', 'F4'];
export const SEASON_TILES: readonly SeasonTile[] = ['S1', 'S2', 'S3', 'S4'];
export type TileKind = SuitTile | HonourTile | BonusTile;

/** A physical tile in a set. `id` is unique within the set and stable for a game. */
export interface TileInstance {
  readonly id: number;
  readonly kind: TileKind;
}

export interface TileSetConfig {
  readonly suits: readonly Suit[];
  readonly winds: boolean;
  readonly dragons: boolean;
  readonly flowers: boolean;
  readonly seasons: boolean;
  /** copies of each non-bonus tile, normally 4 */
  readonly copies: number;
}

export const FULL_SET: TileSetConfig = {
  suits: SUITS,
  winds: true,
  dragons: true,
  flowers: true,
  seasons: true,
  copies: 4,
};

export function suitTile(suit: Suit, num: number): SuitTile {
  return `${suit}${num as Num}`;
}
export function windTile(wind: Wind): WindTile {
  return `W${wind}`;
}

export function isSuitTile(k: TileKind): k is SuitTile {
  const c = k.charCodeAt(0);
  return c >= 97 && c <= 122; // lowercase
}
export function isWindTile(k: TileKind): k is WindTile {
  return k[0] === 'W' && k.length === 2 && isSuitTile(k) === false && 'ESWN'.includes(k[1]!);
}
export function isDragonTile(k: TileKind): k is DragonTile {
  return k === 'DR' || k === 'DG' || k === 'DW';
}
export function isHonourTile(k: TileKind): k is HonourTile {
  return isWindTile(k) || isDragonTile(k);
}
export function isBonusTile(k: TileKind): k is BonusTile {
  return (k[0] === 'F' || k[0] === 'S') && k.length === 2 && '1234'.includes(k[1]!);
}
export function suitOf(k: SuitTile): Suit {
  return k[0] as Suit;
}
export function numOf(k: SuitTile): Num {
  return Number(k[1]) as Num;
}
export function windOf(k: WindTile): Wind {
  return k[1] as Wind;
}
export function isTerminal(k: TileKind): boolean {
  if (!isSuitTile(k)) return false;
  const n = numOf(k);
  return n === 1 || n === 9;
}
export function isSimple(k: TileKind): boolean {
  return isSuitTile(k) && !isTerminal(k);
}

/** Canonical ordering used for display and deterministic comparisons. */
const ORDER: readonly TileKind[] = [
  ...SUITS.flatMap((s) => NUMS.map((n) => suitTile(s, n))),
  ...WIND_TILES,
  ...DRAGON_TILES,
  ...FLOWER_TILES,
  ...SEASON_TILES,
];
const ORDER_INDEX = new Map<TileKind, number>(ORDER.map((k, i) => [k, i]));
export const ALL_TILE_KINDS: readonly TileKind[] = ORDER;

export function tileOrder(k: TileKind): number {
  return ORDER_INDEX.get(k) ?? 999;
}
export function compareTiles(a: TileKind, b: TileKind): number {
  return tileOrder(a) - tileOrder(b);
}
export function sortTiles<T extends TileKind>(tiles: readonly T[]): T[] {
  return [...tiles].sort(compareTiles);
}

export function buildTileSet(cfg: TileSetConfig): TileInstance[] {
  const kinds: TileKind[] = [];
  for (const s of cfg.suits) for (const n of NUMS) kinds.push(suitTile(s, n));
  if (cfg.winds) kinds.push(...WIND_TILES);
  if (cfg.dragons) kinds.push(...DRAGON_TILES);
  const tiles: TileInstance[] = [];
  let id = 0;
  for (const kind of kinds) for (let c = 0; c < cfg.copies; c++) tiles.push({ id: id++, kind });
  if (cfg.flowers) for (const kind of FLOWER_TILES) tiles.push({ id: id++, kind });
  if (cfg.seasons) for (const kind of SEASON_TILES) tiles.push({ id: id++, kind });
  return tiles;
}

const SUIT_NAMES: Record<Suit, string> = { m: 'Characters', p: 'Dots', s: 'Bamboo' };
const WIND_NAMES: Record<Wind, string> = { E: 'East', S: 'South', W: 'West', N: 'North' };
const DRAGON_NAMES: Record<DragonTile, string> = { DR: 'Red Dragon', DG: 'Green Dragon', DW: 'White Dragon' };
const FLOWER_NAMES: Record<FlowerTile, string> = { F1: 'Plum', F2: 'Orchid', F3: 'Chrysanthemum', F4: 'Bamboo Flower' };
const SEASON_NAMES: Record<SeasonTile, string> = { S1: 'Spring', S2: 'Summer', S3: 'Autumn', S4: 'Winter' };

export function tileName(k: TileKind): string {
  if (isSuitTile(k)) return `${numOf(k)} ${SUIT_NAMES[suitOf(k)]}`;
  if (isWindTile(k)) return `${WIND_NAMES[windOf(k)]} Wind`;
  if (isDragonTile(k)) return DRAGON_NAMES[k];
  if (k[0] === 'F') return FLOWER_NAMES[k as FlowerTile];
  return SEASON_NAMES[k as SeasonTile];
}

/** Multiset of tile kinds. */
export type Counts = Map<TileKind, number>;
export function countKinds(tiles: readonly TileKind[]): Counts {
  const m: Counts = new Map();
  for (const t of tiles) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}
export function countsToList(c: Counts): TileKind[] {
  const out: TileKind[] = [];
  for (const [k, n] of c) for (let i = 0; i < n; i++) out.push(k);
  return sortTiles(out);
}
