import type { HandState, PublicGameView } from '@society/engine';
import type { Scores4 } from './table-state';

/**
 * A game's life beyond one move: its hands, its running totals and, later,
 * how it ends. Pure, and safe to load in the browser.
 */

/**
 * How long nobody may move a table before it counts as idle (R23). The idle
 * end arrives later; for now this only decides whether the first commit over
 * a legacy row carries its last activity forward (service.ts).
 */
export const STALE_GAME_MS = 6 * 60 * 60 * 1000;

/** How many hands of the game have finished: every hand before this one, and this one too once it's over. */
export function handsPlayed(v: Pick<PublicGameView, 'phase' | 'progress'>): number {
  return v.progress.handIndex + (v.phase === 'finished' ? 1 : 0);
}

/** The running totals with a finished hand's points added: a win's transfers, seat to seat. A washout moves nothing, and gives back `scores` itself. */
export function addHandScores(scores: Scores4, state: HandState): Scores4 {
  const result = state.result;
  if (result?.type !== 'win') return scores;
  const next: [number, number, number, number] = [...scores];
  for (const t of result.settlement.transfers) {
    next[t.from] -= t.amount;
    next[t.to] += t.amount;
  }
  return next;
}
