'use client';
import { useMemo, useState } from 'react';
import type { PrivatePlayerView, Ruleset, Seat } from '@society/engine';
import { analyseFor, coachFor, tellsSwitch } from './coach';
import { nextPlanMark, preferFor, samePlanMark, type PlanMark } from './plan-mark';
import type { CoachStage, CoachState } from './types';

/**
 * The tutor for a table, solo or live, as a hook: one place both tables get
 * their tutor from. Not re-exported from `lib/coach/index.ts`, so the server's
 * imports of the coach never pull in React.
 */

export interface CoachSource {
  readonly view: PrivatePlayerView;
  readonly ruleset: Ruleset;
  readonly stage: CoachStage;
  readonly names: Readonly<Record<Seat, string>>;
  /** what makes a new game: solo's round counter, a live gameId. The plan the tutor holds the player to starts afresh with each. */
  readonly game: string | number;
  /** someone who has just taken this seat over in a hand under way, and hasn't moved since (`firstLookFor`) */
  readonly firstLook?: boolean;
}

/**
 * What the tutor says on this view. The analysis is the expensive part (a
 * bounded search per pattern), so it's kept for as long as the view and the
 * plan are the same, and the tutor's words for as long as nothing they depend
 * on changes. Null in, null out, so a table still waiting for its first view
 * can call it before any early return.
 *
 * The plan holds steady from one view to the next: the one the player is on
 * (plan-mark.ts) goes back to the analysis as `prefer`. When the analysis
 * moves to a new plan, the mark is stored during render, the "store what you
 * saw" pattern plan-strip.tsx uses, and React renders again at once with the
 * new plan in front: one extra analysis on a switch, before anything is
 * painted. The mark lasts as long as the page: a reload starts without it.
 */
export function useCoach(source: CoachSource): CoachState;
export function useCoach(source: CoachSource | null): CoachState | null;
export function useCoach(source: CoachSource | null): CoachState | null {
  const view = source?.view ?? null;
  const ruleset = source?.ruleset ?? null;
  const stage = source?.stage ?? null;
  const names = source?.names ?? null;
  const game = source?.game ?? null;
  const firstLook = source?.firstLook ?? false;
  const [mark, setMark] = useState<PlanMark | null>(null);
  const prefer = view && game !== null ? preferFor(mark, game, view) : undefined;
  const analysis = useMemo(() => (view && ruleset ? analyseFor(view, ruleset, prefer) : null), [view, ruleset, prefer]);
  // A switch is told on the next turn whose bubble can say it: not one whose tip is a kong.
  const tells = useMemo(
    () => (view && ruleset && analysis && stage ? tellsSwitch({ view, ruleset, analysis, stage, firstLook }) : false),
    [view, ruleset, analysis, stage, firstLook],
  );
  const next = view && game !== null && analysis ? nextPlanMark(mark, game, view, analysis.candidates[0], tells) : mark;
  if (!samePlanMark(next, mark)) setMark(next);
  return useMemo(
    () => (view && ruleset && analysis && stage && names ? coachFor({ view, ruleset, analysis, stage, names, firstLook, mark: next }) : null),
    [view, ruleset, analysis, stage, names, firstLook, next],
  );
}
