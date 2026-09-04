import type { TileKind } from '../tiles';
import type { ClaimRules } from '../ruleset';

export interface PatternCandidate {
  readonly patternId: string;
  readonly name: string;
  readonly localName?: string;
  /** how many tiles must still change to complete this pattern */
  readonly away: number;
  /** every tile kind that would reduce `away`, drawn or claimed */
  readonly needs: readonly TileKind[];
  /** the part of `needs` a discard can supply: a claimable meld, or the winning tile */
  readonly needsClaimable: readonly TileKind[];
  /** the part of `needs` only the wall can supply - in Karachi, every chow tile */
  readonly needsFromWall: readonly TileKind[];
  /** the player's tiles serving one best lay-out of this pattern, melds included */
  readonly using: readonly TileKind[];
  /** the concealed part of `using`: the tiles this pattern asks you not to discard */
  readonly usingConcealed: readonly TileKind[];
  /** `away` is an upper bound: the search was cut short, so the hand may be closer */
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
  /**
   * The ruleset's claim rules, which decide whether a needed tile can come from a
   * discard. Without them nothing is reported claimable, since only the ruleset knows.
   */
  readonly claims?: ClaimRules;
}
