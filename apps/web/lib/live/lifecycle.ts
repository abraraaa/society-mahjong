import { SEATS, nextHand, type HandState, type PublicGameView, type Ruleset, type Seat } from '@society/engine';
import { isAway } from './absence';
import type { Absence, GameOver, NextHandVotes, Scores4, TableState } from './table-state';
import type { GameEndHow, Seats } from './types';

/**
 * A game's life beyond one move: its hands, its running totals and how it
 * ends. Pure, and safe to load in the browser.
 */

/**
 * How long nobody may move a table before the game ends by itself, as idle
 * (R23): no person has sent it a move or an end in that time. It also decides
 * whether the first commit over a legacy row carries its last activity
 * forward (service.ts), so a game being played across a deploy isn't ended
 * for its age.
 */
export const STALE_GAME_MS = 6 * 60 * 60 * 1000;

/** Whether a game last moved by a person at `actedAt` has gone unplayed for longer than STALE_GAME_MS. */
export function isStale(actedAt: number, now: number): boolean {
  return now - actedAt > STALE_GAME_MS;
}

/**
 * How long the table waits after the first Next hand tap before it starts the
 * next hand without the rest (R15). It starts sooner, at once, when everyone
 * here has tapped.
 */
export const NEXT_HAND_WAIT_MS = 20_000;

/**
 * How many times a Next hand tap that names its hand is tried against a fresh
 * read when someone else's request saves first (R16): a vote needs no
 * particular version, so the server tries again itself rather than send the
 * tap back. Four phones tapping while each ticks at the start time is the
 * busiest it gets.
 */
export const VOTE_ATTEMPTS = 5;

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
 * Who was at the table when the game ended: the people in its seats then,
 * less anyone a bot was playing for (`absence`, the table's at the end). An
 * abandoned game had nobody left (that's what ended it), and nor does one
 * that ended because nobody was playing.
 */
export function presentAtEnd(over: GameOver, absence: Absence | undefined): string[] {
  if (over.how === 'abandoned' || over.how === 'idle') return [];
  return SEATS.flatMap((seat) => {
    const s = over.seats[seat];
    return s?.kind === 'human' && !isAway(absence, over.seats, seat) ? [s.userId] : [];
  });
}

/**
 * A Next hand tap on finished hand `hand`, as a vote (R15). The first vote
 * sets when the next hand starts regardless, NEXT_HAND_WAIT_MS from now, and
 * later ones never move it. The same person twice (a second phone, or a
 * second tap) counts once, and gives back `t` itself. Votes left over from
 * another hand don't count: this hand's wait starts afresh.
 */
export function voteNextHand(t: TableState, hand: number, userId: string, now: number): TableState {
  const votes = t.ready?.hand === hand ? t.ready : null;
  if (votes?.userIds.includes(userId)) return t;
  return { ...t, ready: { hand, userIds: [...(votes?.userIds ?? []), userId], dealAt: votes?.dealAt ?? now + NEXT_HAND_WAIT_MS } };
}

/** Whether everyone here (`present`, by id) has tapped Next hand on `hand`. Never with nobody here: somebody has to be ready. */
export function everyoneReady(votes: NextHandVotes | null, hand: number, present: readonly string[]): boolean {
  return votes !== null && votes.hand === hand && present.length > 0 && present.every((id) => votes.userIds.includes(id));
}

/**
 * Where the wait for the next hand stands, as the table shows it: the people
 * here who have tapped Next hand (`ready`) and who haven't (`waiting`), by
 * seat, and when it starts regardless (`startsAt`, set by the first tap).
 * Only the people here count: a bot, or a person a bot is playing for, is
 * never waited on. Null while a hand is being played.
 */
export interface NextHandWait {
  readonly ready: readonly Seat[];
  readonly waiting: readonly Seat[];
  readonly startsAt: number | null;
}

export function nextHandWait(state: Pick<HandState, 'phase' | 'progress'>, seats: Seats, present: readonly Seat[], t: TableState): NextHandWait | null {
  if (state.phase !== 'finished') return null;
  const votes = t.ready?.hand === state.progress.handIndex ? t.ready : null;
  const voted = (seat: Seat) => {
    const s = seats[seat];
    return s?.kind === 'human' && !!votes?.userIds.includes(s.userId);
  };
  const here = SEATS.filter((seat) => present.includes(seat) && seats[seat]?.kind === 'human');
  return { ready: here.filter(voted), waiting: here.filter((seat) => !voted(seat)), startsAt: votes?.dealAt ?? null };
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
