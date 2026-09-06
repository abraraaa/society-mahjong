import type { Seat } from '@society/engine';
import type { RoomStatus, SeatEntry, Seats } from './types';

/**
 * How many times a seat write is tried after someone else's lands first. A
 * third loss means the room is busy right now; the tap can simply be repeated.
 */
export const SEAT_ATTEMPTS = 3;

/**
 * The seats with the joiner in the first free one, or null when there is
 * none. Between games (a finished room) a bot's seat counts as free, so a
 * friend who turns up late can take one before the host deals again. Pure,
 * so the lobby's seat-picking has tests; the write itself is in rooms.ts.
 */
export function seatJoiner(seats: Seats, status: RoomStatus, joiner: { readonly userId: string; readonly name: string }): Seats | null {
  const free = seats.findIndex((s) => s === null || (status === 'finished' && s.kind === 'bot'));
  if (free < 0) return null;
  const taken: SeatEntry = { kind: 'human', userId: joiner.userId, name: joiner.name };
  return seats.map((s, i) => (i === free ? taken : s)) as unknown as Seats;
}

/** The seats with one of them emptied. */
export function vacate(seats: Seats, seat: Seat): Seats {
  return seats.map((s, i) => (i === seat ? null : s)) as unknown as Seats;
}
