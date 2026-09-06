import 'server-only';
import { SEAT_ATTEMPTS, seatJoiner, vacate } from './seating';
import { HttpError } from './errors';
import { roomByCode, saveSeats, type RoomRow } from './store';
import { seatOf, type Seats } from './types';

/** What the lobby shows. Seat entries carry names only; user ids stay on the server. */
export interface RoomSnapshot {
  readonly id: string;
  readonly code: string;
  readonly rulesetId: string;
  readonly status: RoomRow['status'];
  readonly seats: readonly ({ readonly kind: 'human' | 'bot'; readonly name: string } | null)[];
  readonly me: number | null;
  readonly isHost: boolean;
  readonly gameId: string | null;
}

export function roomSnapshot(room: RoomRow, userId: string): RoomSnapshot {
  return {
    id: room.id,
    code: room.code,
    rulesetId: room.ruleset_id,
    status: room.status,
    seats: room.seats.map((s) => (s ? { kind: s.kind, name: s.name } : null)),
    me: seatOf(room.seats, userId),
    isHost: room.host_id === userId,
    gameId: room.current_game_id,
  };
}

export async function requireRoom(code: string): Promise<RoomRow> {
  const room = await roomByCode(code);
  if (!room) throw new HttpError(404, 'no room with that code');
  return room;
}

/**
 * Sit the user down: their existing seat, else the first empty one (see
 * seatJoiner). The write is optimistic on the room's `updated_at`: two
 * friends who tap the link in the same instant both sit, the second of them
 * on a fresh read, and nobody ends up in someone else's seat.
 */
export async function joinRoom(room: RoomRow, userId: string, name: string): Promise<{ room: RoomRow; seated: boolean }> {
  let current = room;
  for (let attempt = 1; ; attempt++) {
    if (seatOf(current.seats, userId) !== null) return { room: current, seated: false };
    if (current.status === 'playing') throw new HttpError(409, 'this table has already started');
    const seats = seatJoiner(current.seats, current.status, { userId, name });
    if (!seats) throw new HttpError(409, 'this table is full');
    const updated_at = await saveSeats(current.id, seats, current.updated_at);
    if (updated_at) return { room: { ...current, seats, updated_at }, seated: true };
    if (attempt >= SEAT_ATTEMPTS) throw new HttpError(409, 'that seat was just taken; try again');
    current = await requireRoom(current.code);
  }
}

/** Stand up from the lobby. The seat empties; the room stays open for the others. */
export async function leaveRoom(room: RoomRow, userId: string): Promise<RoomRow> {
  let current = room;
  for (let attempt = 1; ; attempt++) {
    const me = seatOf(current.seats, userId);
    if (me === null) return current;
    if (current.status !== 'lobby') throw new HttpError(409, 'the table has started; leave it from the game');
    const seats = vacate(current.seats, me);
    const updated_at = await saveSeats(current.id, seats, current.updated_at);
    if (updated_at) return { ...current, seats, updated_at };
    if (attempt >= SEAT_ATTEMPTS) throw new HttpError(409, 'the table changed under you; try again');
    current = await requireRoom(current.code);
  }
}

const BOT_NAMES = ['Bilal', 'Sana', 'Ayesha', 'Hamza', 'Zara', 'Omar'];

/** Fill every empty seat with a bot, named so the table reads like company. */
export function withBots(seats: Seats): Seats {
  const taken = new Set(seats.flatMap((s) => (s ? [s.name] : [])));
  const names = BOT_NAMES.filter((n) => !taken.has(n));
  let i = 0;
  return seats.map((s) => s ?? { kind: 'bot' as const, name: names[i++] ?? `Bot ${i}` }) as unknown as Seats;
}
