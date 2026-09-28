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
import { coverPattern, type CoverOptions, type CoverResult, type CoverSolution } from './coverage';
import type { AnalysisOptions, HandAnalysis, LayoutGroup, PatternCandidate, TileRating } from './types';
import type { Group } from '../patterns/types';

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
  const rated: { pattern: Pattern; index: number; cover: CoverResult; away: number; concealedUsed: Counts; plan: CoverSolution | undefined }[] = [];
  for (const [index, pattern] of patterns.entries()) {
    const cover = coverPattern(pattern, hand, ctx, guards, coverOptions);
    if (!cover.reachable) continue;

    // A 13 tile hand measured against a 14 tile pattern is one tile away, not zero,
    // so the yardstick is whichever of the two is longer.
    const away = Math.max(cover.size, handSize) - cover.covered;
    // No lay-out at all means the search ran out of budget before it found one; the
    // pattern is still on the table, so it stays on the list with nothing to show for itself.
    // A lay-out can come back with a group the search never filled; one without a hole is a plan the table can draw.
    const first = cover.solutions.find(whole) ?? cover.solutions[0];
    rated.push({ pattern, index, cover, away, concealedUsed: countKinds(first?.used ?? []), plan: first });
  }

  // A tie goes to the pattern listed first. Rulesets list theirs most specific first and the
  // reducer announces the first match, so a complete hand leads with the name it will be announced under.
  rated.sort(
    (a, b) =>
      a.away - b.away ||
      b.cover.covered - a.cover.covered ||
      // While a hand is being built, the round's general hand goes first when a named one is only as close.
      (a.away > 0 ? Number(!a.pattern.tags?.includes('general')) - Number(!b.pattern.tags?.includes('general')) : 0) ||
      // Then the plan the player is already on, so two equally close named hands (or two general ones) don't take turns.
      (options.prefer ? Number(b.pattern.id === options.prefer) - Number(a.pattern.id === options.prefer) : 0) ||
      a.index - b.index,
  );

  // A candidate usually has several lay-outs at its best coverage, and the search finds
  // them characters first, then dots, then bamboo. Following whichever came first meant
  // the tutor protected an arbitrary one and threw away tiles an equally good lay-out,
  // or the next hand along, was using: most often a run in bamboo. So each leading
  // candidate follows the lay-out that keeps the most tiles the other leaders can use,
  // the closer ones counting more; a tie keeps the search's own order.
  const lead = rated.slice(0, topN);
  const reachable = lead.map(({ cover }) => {
    const u: Counts = new Map();
    for (const sol of cover.solutions) maxInto(u, countKinds(sol.used));
    return u;
  });
  lead.forEach((r, i) => {
    if (r.cover.solutions.length < 2) return;
    let best = r.concealedUsed;
    let bestPlan = r.plan;
    let bestScore = -1;
    for (const sol of r.cover.solutions) {
      if (!whole(sol)) continue;
      const used = countKinds(sol.used);
      let score = 0;
      reachable.forEach((u, j) => {
        if (j === i) return;
        for (const [k, n] of used) score += Math.min(n, u.get(k) ?? 0) / (j + 1);
      });
      if (score > bestScore + 1e-9) {
        bestScore = score;
        best = used;
        bestPlan = sol;
      }
    }
    r.concealedUsed = best;
    r.plan = bestPlan;
  });

  // `using` follows that one concrete lay-out, so it reads as a plan and its spare tiles
  // really are spare. `needs` is the union over every lay-out at that coverage, so a
  // many-sided wait is whole.
  const candidates: PatternCandidate[] = rated.slice(0, limit).map(({ pattern, cover, away, concealedUsed, plan }) => ({
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
    layout: plan && whole(plan) ? layoutOf(plan, concealedUsed) : null,
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
  // What the copy you'd throw is worth: a leader counts only if it uses every copy held.
  // Rated per kind, a spare third 2 Characters looked busier than the one tile the next
  // hand along was counting on, and the tutor threw the wrong one.
  const lastCopy = new Map<TileKind, number>();
  for (const [kind, n] of held) {
    let usefulness = 0;
    let last = 0;
    const serves: string[] = [];
    leaders.forEach(({ pattern, concealedUsed }, i) => {
      const used = concealedUsed.get(kind) ?? 0;
      if (used === 0) return;
      serves.push(pattern.id);
      // The closest candidate is the one the player is most likely on, so it counts most.
      usefulness += used / (i + 1);
      if (used >= n) last += 1 / (i + 1);
    });
    lastCopy.set(kind, last);
    ratings.push({ kind, held: n, usefulness, serves });
  }
  ratings.sort(
    (a, b) =>
      lastCopy.get(a.kind)! - lastCopy.get(b.kind)! ||
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

/** Every group of the lay-out has its tiles. */
function whole(sol: CoverSolution): boolean {
  return sol.groups.every((g) => g.tiles.length > 0);
}

/** What a player calls a group: a pung, a run, a pair, the honours. */
function shapeOfGroup(g: Group): LayoutGroup['shape'] {
  switch (g.c) {
    case 'set':
      return g.type === 'chow' ? 'run' : g.type === 'kong' ? 'kong' : g.type === 'pung' ? 'pung' : 'set';
    case 'seq':
    case 'run':
    case 'mixedSeq':
    case 'mixedRun':
      return 'run';
    case 'pair':
    case 'mixedPair':
      return 'pair';
    case 'knit':
      return 'knit';
    case 'each':
      return g.tiles.every((k) => !isSuitTile(k)) ? 'honours' : 'singles';
    default:
      return 'singles';
  }
}

/**
 * The plan's lay-out, tile by tile. Melds are held by definition; within the
 * concealed groups each copy the player holds is marked held until the copies
 * `used` gives run out, and the rest are the tiles still to find.
 */
function layoutOf(plan: CoverSolution, used: Counts): LayoutGroup[] {
  const left = new Map(used);
  return plan.groups.map((g, i) => {
    const tiles = g.tiles.map((kind) => {
      if (g.fromMeld) return { kind, held: true };
      const n = left.get(kind) ?? 0;
      if (n > 0) left.set(kind, n - 1);
      return { kind, held: n > 0 };
    });
    return { shape: shapeOfGroup(g), exposed: g.fromMeld, open: !plan.fixed[i] && !tiles.some((t) => t.held), tiles };
  });
}
