import type { PatternCandidate, PrivatePlayerView } from '@society/engine';
import { titleOf } from './shape';

/**
 * The plan the tutor is holding the player to, carried from one view to the
 * next so it holds steady. Two hands exactly as close used to take turns
 * leading from one draw to the next, and the strip and the tutor's discards
 * turned with them. With the plan passed back to the analysis as `prefer`,
 * the one the player is on stays in front until another hand is really
 * closer, or the round's general hand catches it up (the owner's rule), and
 * then the tutor says why it switched, once, on the player's next turn.
 * Pure, so the hook that keeps it (use-coach.ts) holds no logic of its own.
 */

export interface PlanMark {
  /** what makes a new game: solo's round counter, a live gameId */
  readonly game: string | number;
  /** `view.progress.handIndex` */
  readonly hand: number;
  readonly patternId: string;
  readonly title: string;
  /**
   * the plan the player last saw on one of their turns, once the title has moved on from it; `toldAt` is the turn view
   * that said so, and `heldAt` the turn view whose bubble couldn't (a kong tip), which it waited through
   */
  readonly switched: { readonly fromId: string; readonly fromTitle: string; readonly toldAt: number | null; readonly heldAt?: number } | null;
}

function sameHand(mark: PlanMark, game: string | number, view: PrivatePlayerView): boolean {
  return mark.game === game && mark.hand === view.progress.handIndex;
}

/** The plan to keep in front, as a pattern id: the mark's, in the same game and hand. */
export function preferFor(mark: PlanMark | null, game: string | number, view: PrivatePlayerView): string | undefined {
  return mark && sameHand(mark, game, view) ? mark.patternId : undefined;
}

/** A view where the switch line can show: the player's own turn, with a discard to make and no win. */
export function isTurnView(view: PrivatePlayerView): boolean {
  return view.phase === 'turn' && view.turn === view.me && (view.legal.discard?.length ?? 0) > 0 && !view.legal.win;
}

/**
 * The mark after this view, whose analysis leads with `leader`. The same mark,
 * as an object, when nothing about it changed, so a caller can compare it.
 *
 * - A new game or hand starts afresh, with nothing switched.
 * - No leader keeps the mark.
 * - The same title follows the leader's id and keeps `switched`.
 * - A new title records the switch from the plan the player last saw on a
 *   turn: while an earlier switch is still untold, its `from` stays, and a
 *   return to that plan clears it, since there's nothing to say.
 * - On a turn view, an untold switch is told there: `toldAt` is its seq. On one whose bubble can't say it (`tells`
 *   false, from the coach's `tellsSwitch`: a turn whose tip is a kong), it waits, but only through that one view
 *   (`heldAt`): the next turn view tells it whatever its tip, so a player who keeps turning the kong down still hears
 *   it, measured against the plan they saw one turn ago rather than many.
 */
export function nextPlanMark(
  mark: PlanMark | null,
  game: string | number,
  view: PrivatePlayerView,
  leader: PatternCandidate | undefined,
  tells = isTurnView(view),
): PlanMark | null {
  const hand = view.progress.handIndex;
  let next: PlanMark | null;
  if (!mark || !sameHand(mark, game, view)) {
    next = leader ? { game, hand, patternId: leader.patternId, title: titleOf(leader), switched: null } : null;
  } else if (!leader) {
    next = mark;
  } else {
    const title = titleOf(leader);
    if (title === mark.title) {
      next = leader.patternId === mark.patternId ? mark : { ...mark, patternId: leader.patternId };
    } else if (mark.switched && mark.switched.toldAt === null) {
      next = { ...mark, patternId: leader.patternId, title, switched: title === mark.switched.fromTitle ? null : mark.switched };
    } else {
      next = { ...mark, patternId: leader.patternId, title, switched: { fromId: mark.patternId, fromTitle: mark.title, toldAt: null } };
    }
  }
  const untold = next?.switched?.toldAt === null ? next.switched : null;
  if (next && untold && isTurnView(view)) {
    const waited = untold.heldAt !== undefined && untold.heldAt !== view.seq;
    if (tells || waited) next = { ...next, switched: { ...untold, toldAt: view.seq } };
    else if (untold.heldAt === undefined) next = { ...next, switched: { ...untold, heldAt: view.seq } };
  }
  return next;
}

/** Whether two marks say the same thing, so a hook can tell when to store the new one. */
export function samePlanMark(a: PlanMark | null, b: PlanMark | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.game === b.game &&
    a.hand === b.hand &&
    a.patternId === b.patternId &&
    a.switched?.fromId === b.switched?.fromId &&
    a.switched?.toldAt === b.switched?.toldAt &&
    a.switched?.heldAt === b.switched?.heldAt
  );
}
