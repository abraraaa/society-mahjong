import type { ClaimOption, Seat, TileKind, Wind } from '@society/engine';

/**
 * The coach's structured answer. Everything the bubble says is derived from these
 * fields, and nothing else: a later conversational tutor can be handed this object
 * and asked to narrate it without ever being told a rule it could get wrong.
 */

/** Where in the hand the player is standing when the coach speaks. */
export type CoachMoment = 'handStart' | 'exchange' | 'turn' | 'waiting' | 'claim' | 'handEnd';

/**
 * How much hand-holding is wanted. Mirrors the `onboarding_stage` on the profile
 * (docs/PLAN.md §3); solo play derives it from hands played and unaided wins.
 */
export type CoachStage = 'new' | 'first_hand' | 'learning' | 'solid';

/** What the round asks for, taken from the ruleset's hand spec rather than remembered. */
export interface CoachGoal {
  readonly roundWind: Wind;
  /** the hand spec's `kind`: goulash, honour, noHonour, big */
  readonly handKind: string;
  readonly label: string;
  /** the round's aim in one line */
  readonly aim: string;
  /** the one thing beginners get wrong in this round, or null when there isn't one */
  readonly watchOut: string | null;
  readonly honours: 'required' | 'forbidden' | 'gated' | 'optional';
  readonly chowsClaimable: boolean;
}

/** One pattern the hand could still become, dressed for a human. */
export interface CoachTarget {
  readonly patternId: string;
  /** what players call it: `localName` where there is one, else `name` */
  readonly title: string;
  /** the shape in plain words, e.g. "a run in each suit, plus all four winds with one paired" */
  readonly shape: string;
  readonly away: number;
  /** `away` is an upper bound, so copy hedges it */
  readonly approximate: boolean;
  /** how close it feels, which is what decides how boldly the coach names it */
  readonly confidence: 'close' | 'shaping' | 'searching';
  /** concealed tiles already serving it */
  readonly holding: readonly TileKind[];
  /** needed tiles a discard could supply */
  readonly wantsFromDiscard: readonly TileKind[];
  /** needed tiles only the wall can supply - in Karachi, every run */
  readonly wantsFromWall: readonly TileKind[];
}

export type CoachAction =
  | { readonly kind: 'wait' }
  | { readonly kind: 'discard'; readonly tile: TileKind }
  | { readonly kind: 'exchange'; readonly tiles: readonly TileKind[] }
  | { readonly kind: 'claim'; readonly option: ClaimOption; readonly tile: TileKind }
  | { readonly kind: 'pass'; readonly tile: TileKind }
  | { readonly kind: 'win' };

/** How the hand ended, for the debrief. */
export interface CoachOutcome {
  readonly type: 'win' | 'draw';
  readonly winner?: Seat;
  readonly winnerName?: string;
  readonly winnerIsMe?: boolean;
  readonly selfDrawn?: boolean;
  /** the winning hand, named and explained */
  readonly hand?: { readonly title: string; readonly shape: string };
  /** the winner's tiles, revealed, for the sheet to lay out */
  readonly tiles?: readonly TileKind[];
  /** how far the player got, when the coach can say honestly */
  readonly myTarget?: CoachTarget;
}

/** A run of bubble text; `action` marks the one phrase that renders bold. */
export interface CoachSegment {
  readonly text: string;
  readonly action?: true;
}

export interface CoachState {
  readonly moment: CoachMoment;
  readonly stage: CoachStage;
  readonly goal: CoachGoal;
  /** the hand the player is closest to, or null when the analysis has nothing to say */
  readonly target: CoachTarget | null;
  /** the next best, so a later tutor can talk about switching plans */
  readonly runnerUp: CoachTarget | null;
  readonly action: CoachAction;
  /** the persistent status line: "Windy Chows · 3 away", or null when nothing has shape */
  readonly plan: string | null;
  /** the bubble. Empty means the coach has nothing worth saying - render nothing */
  readonly say: readonly CoachSegment[];
  /** why, in one clause, with no markup: the seam a conversational tutor expands on */
  readonly reason: string | null;
  /** concealed tile kinds the table should light up */
  readonly highlight: readonly TileKind[];
  readonly outcome: CoachOutcome | null;
}
