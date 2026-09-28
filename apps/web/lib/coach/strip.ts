import { isSuitTile, tileOrder, type LayoutGroup, type LayoutTile } from '@society/engine';

/**
 * How the plan strip and the hand card lay out a hand: the engine's groups,
 * arranged the way a player would set the tiles out on the table.
 *
 * - Sets laid face up come first, as they sit in front of the player.
 * - Then runs, pungs and kongs in suit and number order, then the winds and
 *   dragons together, then the pair.
 * - A single loose tile that repeats one in the honours (the paired wind in
 *   "all four winds with one paired") joins that group, so NEWS reads as five.
 * - The other single loose tiles share one group: Khalida's 1 to 9 reads as
 *   one row, Crazy Chows' two loose tiles as one pair of gaps.
 */
export interface StripGroup {
  readonly exposed: boolean;
  /** nothing held and nothing pins its tiles: drawn as face-down tiles, since any set of that shape would do */
  readonly open: boolean;
  readonly tiles: readonly LayoutTile[];
}

const RANK: Readonly<Record<LayoutGroup['shape'], number>> = { run: 0, pung: 0, kong: 0, knit: 0, set: 0, singles: 1, honours: 2, pair: 3 };

function firstOrder(g: LayoutGroup): number {
  return Math.min(...g.tiles.map((t) => tileOrder(t.kind)));
}

export function stripGroups(layout: readonly LayoutGroup[]): StripGroup[] {
  const exposed = layout.filter((g) => g.exposed);
  const rest = layout.filter((g) => !g.exposed).map((g) => ({ ...g, tiles: [...g.tiles] }));
  const honours = rest.filter((g) => g.shape === 'honours');
  const loose: LayoutTile[] = [];
  const kept: (LayoutGroup & { tiles: LayoutTile[] })[] = [];
  for (const g of rest) {
    if (g.shape === 'singles' && g.tiles.length === 1) {
      const home = honours.find((h) => h.tiles.some((t) => t.kind === g.tiles[0]!.kind));
      if (home) home.tiles.push(g.tiles[0]!);
      else loose.push(g.tiles[0]!);
      continue;
    }
    kept.push(g);
  }
  const sorted = kept.sort((a, b) => RANK[a.shape] - RANK[b.shape] || firstOrder(a) - firstOrder(b));
  for (const g of sorted) g.tiles.sort((a, b) => tileOrder(a.kind) - tileOrder(b.kind));
  const out: StripGroup[] = exposed.map((g) => ({ exposed: true, open: false, tiles: g.tiles }));
  const before = sorted.filter((g) => RANK[g.shape] <= 1);
  const after = sorted.filter((g) => RANK[g.shape] > 1);
  for (const g of before) out.push({ exposed: false, open: g.open, tiles: g.tiles });
  if (loose.length > 0) {
    // Suit tiles in number order, then suit; honours last.
    const byNumber = (t: LayoutTile) => (isSuitTile(t.kind) ? Number(t.kind[1]) * 10 + 'mps'.indexOf(t.kind[0]!) : 1000 + tileOrder(t.kind));
    out.push({ exposed: false, open: false, tiles: [...loose].sort((a, b) => byNumber(a) - byNumber(b)) });
  }
  for (const g of after) out.push({ exposed: false, open: g.open, tiles: g.tiles });
  return out;
}

/** Tiles held and tiles in all, across the groups. */
export function heldOf(groups: readonly StripGroup[]): { held: number; total: number } {
  let held = 0;
  let total = 0;
  for (const g of groups)
    for (const t of g.tiles) {
      total++;
      if (t.held) held++;
    }
  return { held, total };
}
