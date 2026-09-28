import {
  SEATS,
  analysisBot,
  createRng,
  karachi,
  reduce,
  startHand,
  viewFor,
  type Action,
  type GameProgress,
  type HandAnalysis,
  type HandState,
  type PrivatePlayerView,
  type Seat,
} from '@society/engine';
import { analyseFor, coachFor } from './coach';
import { nextPlanMark, preferFor, samePlanMark, type PlanMark } from './plan-mark';
import type { CoachStage, CoachState } from './types';

/**
 * Test-only: seeded hands played out by the real reducer, so a test can look
 * at every view a player would see instead of views put together by hand.
 * Seat 0 follows the tutor; the other seats are gentle bots on a seeded
 * random, as the solo table plays them. The same seed always plays the same
 * hand.
 */

/** One hand of each kind the ruleset deals: the opening goulash, East's honour hands, South, the West goulash, North. */
export const ROUNDS: Readonly<Record<'E0' | 'E1' | 'S' | 'W' | 'N', GameProgress>> = {
  E0: { roundWind: 'E', roundIndex: 0, handInRound: 0, handIndex: 0 },
  E1: { roundWind: 'E', roundIndex: 0, handInRound: 1, handIndex: 1 },
  S: { roundWind: 'S', roundIndex: 1, handInRound: 0, handIndex: 4 },
  W: { roundWind: 'W', roundIndex: 2, handInRound: 0, handIndex: 8 },
  N: { roundWind: 'N', roundIndex: 3, handInRound: 0, handIndex: 12 },
};

/** The longest name the name gate lets through, so the budgets are tried against it. */
export const LONG_NAME = 'Abcdefghijklmnopqrstuvwx';

/** Display names as the solo table has them, with one seat at the longest name allowed. */
export const NAMES: Readonly<Record<Seat, string>> = { 0: 'You', 1: 'Bilal', 2: LONG_NAME, 3: 'Ayesha' };

/** What the tutor says to seat 0 on this view: to someone who has just taken the seat over, with `firstLook`; holding the player to a plan, with `mark`. */
export function coachOf(
  view: PrivatePlayerView,
  stage: CoachStage = 'learning',
  analysis: HandAnalysis = analyseFor(view, karachi),
  firstLook = false,
  mark: PlanMark | null = null,
): CoachState {
  return coachFor({ view, ruleset: karachi, analysis, stage, names: NAMES, firstLook, mark });
}

/**
 * The tutor as a table has it (`useCoach`), for one game: it holds the player
 * to a plan from one view to the next. Give it every view seat 0 sees, in
 * order. When a view moves the plan, it plans again with the new one in
 * front, as the hook's second render does, and that must settle at once.
 */
export function stickyCoach(game: string | number): (view: PrivatePlayerView, stage?: CoachStage) => CoachState {
  let mark: PlanMark | null = null;
  return (view, stage = 'learning') => {
    let analysis = analyseFor(view, karachi, preferFor(mark, game, view));
    let next = nextPlanMark(mark, game, view, analysis.candidates[0]);
    for (let again = 0; !samePlanMark(next, mark); again++) {
      if (again === 2) throw new Error(`the plan didn't settle at seq ${view.seq}`);
      mark = next;
      analysis = analyseFor(view, karachi, preferFor(mark, game, view));
      next = nextPlanMark(mark, game, view, analysis.candidates[0]);
    }
    return coachOf(view, stage, analysis, false, mark);
  };
}

/** Seat 0's move: the tutor's advice, or a pass or a discard when the advice is only to wait. */
function tutorMove(view: PrivatePlayerView): Action | null {
  const a = coachOf(view).action;
  const seat = view.me;
  if (a.kind === 'discard') return { type: 'discard', seat, tile: a.tile };
  if (a.kind === 'claim') return { type: 'claim', seat, claim: a.option };
  if (a.kind === 'pass') return { type: 'pass', seat };
  if (a.kind === 'win') return { type: 'declareWin', seat };
  if (a.kind === 'exchange') return { type: 'exchange', seat, tiles: a.tiles };
  if (view.legal.claims) return { type: 'pass', seat };
  if (view.legal.discard?.[0]) return { type: 'discard', seat, tile: view.legal.discard[0] };
  return null;
}

export interface PlayOptions {
  readonly seed: string;
  readonly progress: GameProgress;
  readonly dealer?: Seat;
  /** every view seat 0 sees, from the deal to the end, in order */
  readonly onView?: (view: PrivatePlayerView) => void;
  /** stop at the first view seat 0 sees that this is true of, once `onView` has had it */
  readonly until?: (view: PrivatePlayerView) => boolean;
}

/** Plays one hand to its end (or 800 moves, or `until`), and returns where it stopped. */
export function playHand({ seed, progress, dealer = 0, onView, until }: PlayOptions): HandState {
  const random = createRng(`${seed}-bots`).next;
  let s: HandState = startHand(karachi, { seed, progress, dealer });
  const seen = (state: HandState) => {
    const view = viewFor(state, karachi, 0);
    onView?.(view);
    return until?.(view) ?? false;
  };
  if (seen(s)) return s;
  for (let step = 0; step < 800 && s.phase !== 'finished'; step++) {
    const seat = SEATS.find((x) => {
      const l = viewFor(s, karachi, x).legal;
      return !!(l.discard || l.claims || l.exchange || l.win);
    });
    if (seat === undefined) break;
    const view = viewFor(s, karachi, seat);
    const action = seat === 0 ? tutorMove(view) : (analysisBot(view, karachi, { strength: 'gentle', random }) ?? (view.legal.claims ? { type: 'pass', seat } : null));
    if (!action || action.type === 'resolveClaims') break;
    s = reduce(s, action, karachi);
    if (seen(s)) break;
  }
  return s;
}
