import { isHonourTile, isSuitTile, numOf, suitOf, suitTile, tileOrder, type TileKind } from '../tiles';
import type { Action, PrivatePlayerView } from '../game/index';

/** How much a tile contributes to the rest of the hand; low means discard first. */
export function tileUtility(kind: TileKind, hand: readonly TileKind[]): number {
  const same = hand.filter((t) => t === kind).length;
  let score = (same - 1) * 3;
  if (isSuitTile(kind)) {
    const s = suitOf(kind);
    const n = numOf(kind);
    const has = (x: number) => x >= 1 && x <= 9 && hand.includes(suitTile(s, x));
    if (has(n - 1)) score += 2;
    if (has(n + 1)) score += 2;
    if (has(n - 2)) score += 1;
    if (has(n + 2)) score += 1;
    if (n === 1 || n === 9) score -= 0.5;
  } else if (isHonourTile(kind) && same === 1) {
    score -= 1;
  }
  return score;
}

function leastUseful(hand: readonly TileKind[], n: number): TileKind[] {
  const ranked = [...new Set(hand)].sort((a, b) => tileUtility(a, hand) - tileUtility(b, hand) || tileOrder(b) - tileOrder(a));
  const out: TileKind[] = [];
  let pool = [...hand];
  for (const k of ranked) {
    while (out.length < n && pool.includes(k)) {
      out.push(k);
      pool = pool.filter((t, i) => !(t === k && i === pool.indexOf(k)));
    }
    if (out.length >= n) break;
  }
  return out;
}

/**
 * A deterministic bot good enough to fill a seat and finish a hand. It sees
 * exactly what a human in that seat sees: a PrivatePlayerView, never the
 * full HandState, so it cannot act on the wall or other players' tiles.
 */
export function simpleBot(view: PrivatePlayerView): Action | null {
  const { legal, me: seat, concealed } = view;
  if (legal.exchange) return { type: 'exchange', seat, tiles: leastUseful(concealed, legal.exchange.count) };
  if (legal.claims) {
    const win = legal.claims.find((c) => c.type === 'win');
    if (win) return { type: 'claim', seat, claim: win };
    const kong = legal.claims.find((c) => c.type === 'kong');
    if (kong) return { type: 'claim', seat, claim: kong };
    const pung = legal.claims.find((c) => c.type === 'pung');
    if (pung) return { type: 'claim', seat, claim: pung };
    return { type: 'pass', seat };
  }
  if (legal.win) return { type: 'declareWin', seat };
  if (legal.kong && legal.kong.length > 0) return { type: 'declareKong', seat, tile: legal.kong[0]! };
  if (legal.discard && legal.discard.length > 0) return { type: 'discard', seat, tile: leastUseful(concealed, 1)[0]! };
  return null;
}
