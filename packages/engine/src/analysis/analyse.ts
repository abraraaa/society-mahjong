/**
 * Hand analysis: how close is this hand to each of the round's legal patterns,
 * which tiles are earning their place, and which one should go.
 *
 * The tutor is the caller this exists for. It needs to know what the player is
 * building before it can advise, which is why every answer here is relative to
 * the patterns the ruleset allows this round rather than to mahjong in general.
 */
import {
  countKinds,
  countsToList,
  isBonusTile,
  isSuitTile,
  numOf,
  sortTiles,
  suitOf,
  suitTile,
  tileOrder,
  type Counts,
  type TileKind,
} from '../tiles';
import type { HandInput } from '../hand';
import type { Guards, MatchCtx, Pattern } from '../patterns/types';
import { coverPattern, type CoverOptions, type CoverResult } from './coverage';
import type { AnalysisOptions, HandAnalysis, PatternCandidate, TileRating } from './types';

const DEFAULT_TOP_N = 3;
const DEFAULT_LIMIT = 8;

function maxInto(into: Counts, from: Counts): void {
  for (const [k, n] of from) into.set(k, Math.max(into.get(k) ?? 0, n));
}

/**
 * How connected a tile is to the rest of the hand, used only to break ties between
 * equally useless tiles: a lone honour goes before a stray 5 that at least sits
 * next to a 4. Copies count double, since a pair is worth more than a neighbour.
 */
function connection(kind: TileKind, counts: Counts): number {
  let n = 2 * (counts.get(kind) ?? 0);
  if (!isSuitTile(kind)) return n;
  const suit = suitOf(kind);
  const num = numOf(kind);
  for (let d = -2; d <= 2; d++) {
    if (d === 0 || num + d < 1 || num + d > 9) continue;
    n += counts.get(suitTile(suit, num + d)) ?? 0;
  }
  return n;
}

/**
 * Rank the round's patterns by how close the hand is to each, then work out what
 * that says about the tiles in it.
 *
 * `away` counts tiles that must still change: 0 for a complete hand, 1 for a hand
 * waiting on its last tile, and so on. Patterns the rules shut out - a meld they
 * cannot use, an exposure they forbid, no lay-out the ruleset guard accepts - are
 * left out of `candidates` entirely. Being far away is not being shut out.
 */
export function analyseHand(
  hand: HandInput,
  patterns: readonly Pattern[],
  ctx: MatchCtx,
  guards: Guards = {},
  options: AnalysisOptions = {},
): HandAnalysis {
  const topN = options.topN ?? DEFAULT_TOP_N;
  const limit = options.limit ?? DEFAULT_LIMIT;

  const concealed = hand.concealed.filter((k) => !isBonusTile(k));
  const held = countKinds(concealed);
  const handSize = concealed.length + hand.melds.reduce((n, m) => n + m.tiles.length, 0);

  const coverOptions: CoverOptions = options.claims ? { claims: options.claims } : {};
  const rated: { pattern: Pattern; cover: CoverResult; away: number; concealedUsed: Counts }[] = [];
  for (const pattern of patterns) {
    const cover = coverPattern(pattern, hand, ctx, guards, coverOptions);
    if (!cover.reachable) continue;

    // A 13 tile hand measured against a 14 tile pattern is one tile away, not zero,
    // so the yardstick is whichever of the two is longer.
    const away = Math.max(cover.size, handSize) - cover.covered;
    // No lay-out at all means the search ran out of budget before it found one; the
    // pattern is still on the table, so it stays on the list with nothing to show for itself.
    rated.push({ pattern, cover, away, concealedUsed: countKinds(cover.solutions[0]?.used ?? []) });
  }

  rated.sort(
    (a, b) =>
      a.away - b.away ||
      b.cover.covered - a.cover.covered ||
      (a.pattern.id < b.pattern.id ? -1 : 1),
  );

  // `using` follows one concrete lay-out - the first the search found, which is its
  // greedy best - so it reads as a plan and its spare tiles really are spare. `needs`
  // is the union over every lay-out at that coverage, so a many-sided wait is whole.
  const candidates: PatternCandidate[] = rated.slice(0, limit).map(({ pattern, cover, away, concealedUsed }) => ({
    patternId: pattern.id,
    name: pattern.name,
    ...(pattern.localName ? { localName: pattern.localName } : {}),
    away,
    needs: sortTiles(cover.needs.map((n) => n.kind)),
    needsClaimable: sortTiles(cover.needs.filter((n) => n.claimable).map((n) => n.kind)),
    needsFromWall: sortTiles(cover.needs.filter((n) => !n.claimable).map((n) => n.kind)),
    using: sortTiles([...cover.meldTiles, ...countsToList(concealedUsed)]),
    usingConcealed: countsToList(concealedUsed),
    approximate: cover.approximate,
  }));

  const leaders = rated.slice(0, topN);

  // A tile is dead weight when none of the leading candidates has a use for it.
  const keepCounts: Counts = new Map();
  for (const { concealedUsed } of leaders) maxInto(keepCounts, concealedUsed);
  for (const [k, n] of keepCounts) keepCounts.set(k, Math.min(n, held.get(k) ?? 0));

  const keep: TileKind[] = [];
  const spare: TileKind[] = [];
  for (const [kind, n] of held) {
    const kept = keepCounts.get(kind) ?? 0;
    for (let i = 0; i < n; i++) (i < kept ? keep : spare).push(kind);
  }

  const ratings: TileRating[] = [];
  for (const [kind, n] of held) {
    let usefulness = 0;
    const serves: string[] = [];
    leaders.forEach(({ pattern, concealedUsed }, i) => {
      const used = concealedUsed.get(kind) ?? 0;
      if (used === 0) return;
      serves.push(pattern.id);
      // The closest candidate is the one the player is most likely on, so it counts most.
      usefulness += used / (i + 1);
    });
    ratings.push({ kind, held: n, usefulness, serves });
  }
  ratings.sort(
    (a, b) =>
      a.usefulness - b.usefulness ||
      connection(a.kind, held) - connection(b.kind, held) ||
      tileOrder(b.kind) - tileOrder(a.kind),
  );

  // Never suggest throwing a tile the best candidate is counting on. Copies beyond
  // what it needs are fair game: a third 5 dots is spare when the plan wants a pair.
  const bestUse = leaders[0]?.concealedUsed ?? new Map<TileKind, number>();
  const discardable = ratings.find((r) => r.held > (bestUse.get(r.kind) ?? 0));

  return {
    candidates,
    keep: sortTiles(keep),
    spare: sortTiles(spare),
    bestDiscard: discardable ? discardable.kind : null,
    ratings,
  };
}
