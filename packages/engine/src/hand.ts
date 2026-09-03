import type { TileKind } from './tiles';

export type Seat = 0 | 1 | 2 | 3;
export const SEATS: readonly Seat[] = [0, 1, 2, 3];
export function nextSeat(s: Seat): Seat {
  return ((s + 1) % 4) as Seat;
}
export function leftOf(s: Seat): Seat {
  return ((s + 3) % 4) as Seat;
}
export function acrossFrom(s: Seat): Seat {
  return ((s + 2) % 4) as Seat;
}
export function rightOf(s: Seat): Seat {
  return nextSeat(s);
}

export type MeldType = 'chow' | 'pung' | 'kong';

export interface Meld {
  readonly type: MeldType;
  readonly tiles: readonly TileKind[];
  /** concealed kongs are the only concealed melds */
  readonly concealed: boolean;
  /** seat the claimed tile came from, if claimed */
  readonly from?: Seat;
}

export interface HandInput {
  /** concealed tiles including the winning tile when evaluating a win */
  readonly concealed: readonly TileKind[];
  readonly melds: readonly Meld[];
  readonly bonus?: readonly TileKind[];
}

export function removeOne(tiles: readonly TileKind[], kind: TileKind): TileKind[] {
  const i = tiles.indexOf(kind);
  if (i < 0) throw new Error(`tile ${kind} not in hand`);
  return [...tiles.slice(0, i), ...tiles.slice(i + 1)];
}
export function removeMany(tiles: readonly TileKind[], kinds: readonly TileKind[]): TileKind[] {
  let out: TileKind[] = [...tiles];
  for (const k of kinds) out = removeOne(out, k);
  return out;
}
export function countOf(tiles: readonly TileKind[], kind: TileKind): number {
  let n = 0;
  for (const t of tiles) if (t === kind) n++;
  return n;
}
