'use client';
import { useMemo } from 'react';
import type { PrivatePlayerView, Ruleset, Seat } from '@society/engine';
import { analyseFor, coachFor } from './coach';
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
  /** what makes a new game: solo's round counter, a live gameId. Nothing the tutor says reads it yet: it's here so anything the tutor comes to carry from one view to the next starts afresh with a new game. */
  readonly game: string | number;
  /** someone who has just taken this seat over in a hand under way, and hasn't moved since (`firstLookFor`) */
  readonly firstLook?: boolean;
}

/**
 * What the tutor says on this view. The analysis is the expensive part (a
 * bounded search per pattern), so it's kept for as long as the view is the
 * same, and the tutor's words for as long as nothing they depend on changes.
 * Null in, null out, so a table still waiting for its first view can call it
 * before any early return.
 */
export function useCoach(source: CoachSource): CoachState;
export function useCoach(source: CoachSource | null): CoachState | null;
export function useCoach(source: CoachSource | null): CoachState | null {
  const view = source?.view ?? null;
  const ruleset = source?.ruleset ?? null;
  const stage = source?.stage ?? null;
  const names = source?.names ?? null;
  const firstLook = source?.firstLook ?? false;
  const analysis = useMemo(() => (view && ruleset ? analyseFor(view, ruleset) : null), [view, ruleset]);
  return useMemo(
    () => (view && ruleset && analysis && stage && names ? coachFor({ view, ruleset, analysis, stage, names, firstLook }) : null),
    [view, ruleset, analysis, stage, names, firstLook],
  );
}
