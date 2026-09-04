import type { Action, HandState, Seat } from '@society/engine';

/** Who is in a seat. Bots are seats too, so the engine never has to know the difference. */
export type SeatEntry = { readonly kind: 'human'; readonly userId: string; readonly name: string } | { readonly kind: 'bot'; readonly name: string } | null;
export type Seats = readonly [SeatEntry, SeatEntry, SeatEntry, SeatEntry];

/** How long humans get. Bots act inline and never wait. */
export interface TimerPolicy {
  readonly claimSeconds: number;
  readonly turnSeconds: number;
}

/** Epoch milliseconds, or null when nothing is waiting on a human. */
export interface Deadlines {
  readonly claim: number | null;
  readonly turn: number | null;
}

export interface LiveGame {
  readonly state: HandState;
  readonly deadlines: Deadlines;
}

/**
 * What a client may send: an engine action for its own seat, or a request to
 * deal the next hand. `resolveClaims` is the server's own move and never a client's.
 */
export type ClientAction = Exclude<Action, { type: 'resolveClaims' }> | { readonly type: 'nextHand' };

/** Seat index of a user, or null when they are not seated. */
export function seatOf(seats: Seats, userId: string): Seat | null {
  const i = seats.findIndex((s) => s?.kind === 'human' && s.userId === userId);
  return i < 0 ? null : (i as Seat);
}

export function isBot(seats: Seats, seat: Seat): boolean {
  return seats[seat]?.kind === 'bot';
}

export function isHuman(seats: Seats, seat: Seat): boolean {
  return seats[seat]?.kind === 'human';
}
