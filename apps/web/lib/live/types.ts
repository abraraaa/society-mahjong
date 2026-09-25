import type { Action, HandState, Seat } from '@society/engine';

/** Where a room is in its life: waiting for people, at the table, or between games. */
export type RoomStatus = 'lobby' | 'playing' | 'finished';

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
 * The engine actions a player may send for their own seat. This is an
 * allowlist on purpose: `resolveClaims` is the server's own move and never a
 * client's, and any action the engine grows later stays server-only until
 * it is added here.
 */
export const PLAYER_ACTION_TYPES = ['exchange', 'discard', 'declareKong', 'declareWin', 'claim', 'pass'] as const satisfies readonly Action['type'][];

/** What a client may send: an engine action for its own seat, or a request to deal the next hand. */
export type ClientAction = Extract<Action, { type: (typeof PLAYER_ACTION_TYPES)[number] }> | { readonly type: 'nextHand' };

export const CLIENT_ACTION_TYPES: readonly ClientAction['type'][] = [...PLAYER_ACTION_TYPES, 'nextHand'];

/** Whether `type` names a move a client may make at all (the shape is checked in validate.ts, legality by the engine). */
export function isClientActionType(type: unknown): type is ClientAction['type'] {
  return (CLIENT_ACTION_TYPES as readonly unknown[]).includes(type);
}

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
