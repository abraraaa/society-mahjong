import type { Seat } from '@society/engine';
import { seatOf, type RoomStatus, type SeatEntry, type Seats } from './types';

/**
 * How many times a seat write is tried after someone else's lands first. A
 * third loss means the room is busy right now; the tap can simply be repeated.
 */
export const SEAT_ATTEMPTS = 3;

/**
 * The seats with the joiner in the first free one, or null when there is
 * none. Between games (a finished room) a bot's seat counts as free, so a
 * friend who turns up late can take one before the host deals again. The new
 * seat is stamped with when they sat (`since`, ISO), which says who has sat
 * longest (hostOf) and starts their absence afresh. Pure, so the lobby's
 * seat-picking has tests; the write itself is in rooms.ts.
 */
export function seatJoiner(seats: Seats, status: RoomStatus, joiner: { readonly userId: string; readonly name: string }, now: number): Seats | null {
  const free = seats.findIndex((s) => s === null || (status === 'finished' && s.kind === 'bot'));
  if (free < 0) return null;
  const taken: SeatEntry = { kind: 'human', userId: joiner.userId, name: joiner.name, since: new Date(now).toISOString() };
  return seats.map((s, i) => (i === free ? taken : s)) as unknown as Seats;
}

/** The seats with one of them emptied. */
export function vacate(seats: Seats, seat: Seat): Seats {
  return seats.map((s, i) => (i === seat ? null : s)) as unknown as Seats;
}

/**
 * The room's seats as a game that has just ended leaves them: anyone the game
 * ended with (`atEnd`, its final seats) whose seat has since gone to a bot
 * gets it back. That happens only when someone leaves as the last hand is
 * scored, their leave landing after the move that ended the game had read
 * the seats: the final table has them seated, so the room keeps their seat
 * for the next deal, as it does for anyone who leaves once the end is saved
 * (service.ts leaveGame). Only a bot's seat is given back, and only to someone
 * not sitting elsewhere, so a seat a person has taken since stays theirs.
 * Null when there's nothing to give back.
 */
export function seatsBack(room: Seats, atEnd: Seats): Seats | null {
  let given = false;
  const seats = room.map((s, i) => {
    const was = atEnd[i];
    if (s?.kind !== 'bot' || was?.kind !== 'human' || seatOf(room, was.userId) !== null) return s;
    given = true;
    return was;
  });
  return given ? (seats as unknown as Seats) : null;
}

/** When a person sat down, for who has sat longest: a seat with no readable `since` counts as the longest held. */
function sittingSince(entry: SeatEntry): number {
  const at = entry?.kind === 'human' && typeof entry.since === 'string' ? Date.parse(entry.since) : Number.NaN;
  return Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at;
}

/**
 * Who has the host's powers (R14): starting a game, ending one, and handing
 * a seat to a bot for someone who's stepped away. Worked
 * out from the seats, never stored:
 * 1. the room's host (`hostId`), if seated and present;
 * 2. otherwise the present person who has sat longest (earliest `since`; a
 *    seat without one counts as earliest; ties by seat order);
 * 3. otherwise the room's host, if seated;
 * 4. otherwise nobody.
 * `present` says whether the person in a seat is here (at a game in play,
 * not away: service.ts); anyone not seated is never the answer, whatever
 * their id.
 */
export function hostOf(hostId: string, seats: Seats, present: (seat: Seat) => boolean): string | null {
  const people = seats.flatMap((entry, i) => (entry?.kind === 'human' ? [{ seat: i as Seat, entry }] : []));
  const host = people.find((p) => p.entry.userId === hostId);
  if (host && present(host.seat)) return hostId;
  // The sort is stable, so equal times stay in seat order.
  const byTime = (a: (typeof people)[number], b: (typeof people)[number]) => {
    const x = sittingSince(a.entry);
    const y = sittingSince(b.entry);
    return x === y ? 0 : x < y ? -1 : 1;
  };
  const longest = people.filter((p) => present(p.seat)).sort(byTime)[0];
  if (longest) return longest.entry.userId;
  return host ? hostId : null;
}
