import type { TileKind } from '../tiles';

export interface PatternCandidate {
  readonly patternId: string;
  readonly name: string;
  readonly localName?: string;
  /** how many tiles must still change to complete this pattern */
  readonly away: number;
  /** tile kinds that would reduce `away` if drawn or claimed, over every best lay-out */
  readonly needs: readonly TileKind[];
  /** the player's tiles serving one best lay-out of this pattern, melds included */
  readonly using: readonly TileKind[];
  /** the concealed part of `using`: the tiles this pattern asks you not to discard */
  readonly usingConcealed: readonly TileKind[];
  /** the search hit its node budget, so `away` may be one or two tiles pessimistic */
  readonly approximate: boolean;
}

/** Why one concealed tile kind is or is not worth keeping. */
export interface TileRating {
  readonly kind: TileKind;
  /** copies held */
  readonly held: number;
  /** 0 when the tile serves none of the leading candidates; higher is worth more */
  readonly usefulness: number;
  /** ids of the leading candidates this tile serves */
  readonly serves: readonly string[];
}

export interface HandAnalysis {
  /** reachable patterns, closest first */
  readonly candidates: readonly PatternCandidate[];
  /** concealed tiles serving at least one leading candidate */
  readonly keep: readonly TileKind[];
  /** concealed tiles serving none of them: the dead weight */
  readonly spare: readonly TileKind[];
  /** the least useful concealed tile, or null when every tile is spoken for */
  readonly bestDiscard: TileKind | null;
  /** every concealed kind scored, least useful first, so callers can explain themselves */
  readonly ratings: readonly TileRating[];
}

export interface AnalysisOptions {
  /** how many candidates count as "the plan" when deciding what is spare */
  readonly topN?: number;
  /** how many candidates to return */
  readonly limit?: number;
}
