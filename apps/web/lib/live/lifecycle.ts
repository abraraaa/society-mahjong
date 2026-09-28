import { nextHand, type HandState, type PublicGameView, type Ruleset } from '@society/engine';
import type { GameOver, Scores4, TableState } from './table-state';
import type { GameEndHow, Seats } from './types';

/**
 * A game's life beyond one move: its hands, its running totals and how it
 * ends. Pure, and safe to load in the browser.
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

/** Whether this hand is the game's last, and over: it has its result, and the ruleset deals nothing after it. */
export function isLastHand(state: HandState, ruleset: Ruleset): boolean {
  return state.phase === 'finished' && state.result !== null && nextHand(state, ruleset) === null;
}

/**
 * How the game ended, as the request that ends it saves it (table_state.over):
 * the totals and the seats are the table's at that moment, so a finished
 * game's page never reads another game's, and the hands counted are the ones
 * that finished (a hand cut short doesn't count).
 */
export function endOfGame(how: GameEndHow, state: HandState, t: TableState, seats: Seats, by: GameOver['by'], now: number): GameOver {
  return { how, by, at: now, hands: handsPlayed(state), scores: t.scores ?? [0, 0, 0, 0], seats };
}

/**
 * Who was at the table when the game ended: the people in its seats then. An
 * abandoned game had nobody left (that's what ended it), and nor, later, does
 * one that ended because nobody was playing.
 */
export function presentAtEnd(over: GameOver): string[] {
  if (over.how === 'abandoned' || over.how === 'idle') return [];
  return over.seats.flatMap((s) => (s?.kind === 'human' ? [s.userId] : []));
}

/** How the game ended, as a player may see it: no ids, only whether it was them who ended it. */
export interface PublicGameOver {
  readonly how: GameEndHow;
  readonly hands: number;
  /** the name of whoever ended it, when someone did */
  readonly byName: string | null;
  /** the one asking ended it */
  readonly byMe: boolean;
}

export function publicGameOver(o: GameOver, userId: string | null): PublicGameOver {
  return { how: o.how, hands: o.hands, byName: o.by?.name ?? null, byMe: userId !== null && o.by?.userId === userId };
}
