import type { CoachStage } from './types';

/**
 * How much the coach should say. The profile carries this as `onboarding_stage`
 * (docs/PLAN.md §3); a solo table has no profile, so it counts what it has seen.
 *
 * ⚠ "Unaided" is currently "won at all". Once the table records whether the
 * player took the coach's suggested discard, this should only count the hands
 * they won without it.
 */
export function stageFor({ handsFinished, wins, discardsMade }: { handsFinished: number; wins: number; discardsMade: number }): CoachStage {
  if (wins >= 3) return 'solid';
  if (handsFinished >= 1) return 'learning';
  if (discardsMade > 0) return 'first_hand';
  return 'new';
}
