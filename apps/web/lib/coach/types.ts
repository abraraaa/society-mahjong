import type { ClaimOption, LayoutGroup, Seat, TileKind, Wind } from '@society/engine';
import type { ExchangeStep } from './exchange';

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
  /** the round's everyday hands: its general-tagged titles in spec order, or its one title when it deals only one hand (the goulash); none in North */
  readonly generalTitles: readonly string[];
  /** "Hands this round": one per title the round allows, the player's own lay-out where it's among their nearest, else an example */
  readonly hands: readonly CoachHandRef[];
}

/** A hand the tutor can show: the player's own nearest lay-out, how it would stand after a claim, a winner's hand, or an example. */
export interface CoachHandRef {
  readonly patternId: string;
  readonly title: string;
  readonly shape: string;
  readonly whose: 'yours' | 'ifClaimed' | 'winner' | 'example';
  /** the winner's display name; 'You' for the player */
  readonly owner?: string;
  /** yours / ifClaimed */
  readonly away?: number;
  readonly approximate?: boolean;
  /**
   * The engine's groups; the card lays them out with stripGroups. A missing lay-out
   * falls back to the example (whose 'example'); empty only for a ruleset with no
   * examples, and the card then shows the title and shape alone.
   */
  readonly layout: readonly LayoutGroup[];
  /** its footnote the first time it's named this visit: the shape every hand of this title shares (`noteShapeOf`) */
  readonly note: string;
}

/**
 * Something the tutor teaches once a visit: a round, a rule, a hand or a word,
 * explained in a footnote the first time it comes up. The coach says what this
 * view could teach; `lessonFor` (teach.ts) decides which of it to show, given
 * what this visit has already been taught.
 */
export interface CoachTeach {
  /** 'round:goulash' | 'round:honour' | 'round:noHonour' | 'round:big' | 'rule:runs' | 'rule:flowers' | 'rule:honourGate' | 'firstLook' | `hand:${title}` | `term:${Term}` */
  readonly key: string;
  /** note: draw it as a footnote; said: the bubble or a sheet already says it, so mark it taught and draw nothing */
  readonly place: 'note' | 'said';
  /** bold before the text; none for a lesson sentence */
  readonly label?: string;
  /** the label is this hand's name, tappable */
  readonly hand?: CoachHandRef;
  readonly text: string;
  /** keys taught with it, because it says the same thing */
  readonly also?: readonly string[];
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
  /** the nearest complete hand of this pattern, grouped into sets, each tile held or still to find; null when there isn't one */
  readonly layout: readonly LayoutGroup[] | null;
  /** what its card shows: this lay-out, or the example when there isn't one */
  readonly hand: CoachHandRef;
}

export type CoachAction =
  | { readonly kind: 'wait' }
  | { readonly kind: 'discard'; readonly tile: TileKind }
  /** a kong that costs the hand nothing; `discard` is the tile to let go instead, for someone who'd rather not */
  | { readonly kind: 'kong'; readonly tile: TileKind; readonly discard: TileKind | null }
  /** the West exchange: the tiles to pass, and which pass it is (which way, which of the three) */
  | { readonly kind: 'exchange'; readonly tiles: readonly TileKind[]; readonly step?: ExchangeStep | null }
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
  /** the winning hand, named and explained, with the card that shows it */
  readonly hand?: { readonly title: string; readonly shape: string; readonly ref: CoachHandRef };
  /** the winner's tiles, revealed, for the sheet to lay out */
  readonly tiles?: readonly TileKind[];
  /** how far the player got, when the coach can say honestly */
  readonly myTarget?: CoachTarget;
}

/** A run of bubble text; `action` marks the one phrase that renders bold. */
export interface CoachSegment {
  readonly text: string;
  readonly action?: true;
  /** the text is this hand's title: it renders as one tappable word that opens the hand's card, never glossary-tagged inside */
  readonly hand?: CoachHandRef;
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
  /** what this view could teach a first-timer, in order: the round, then rules; the names in `say` are added by `lessonFor` */
  readonly teach: readonly CoachTeach[];
  /** which view this is: `view.progress.handIndex` and `view.seq`, so a note is decided once per view */
  readonly at: { readonly hand: number; readonly seq: number };
  /**
   * The plan this turn's line says the tutor has switched from, on the turn that says so (plan-mark.ts): its
   * hand, and how many tiles closer the new plan is. `null` when the old hand can't be made now; 0 when the two
   * are as close and the new one won the tie (the round's general hand, which is easier). Null on every other view.
   */
  readonly planSwitch: { readonly from: CoachHandRef; readonly closerBy: number | null } | null;
}
