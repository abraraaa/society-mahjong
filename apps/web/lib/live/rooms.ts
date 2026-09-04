import 'server-only';
import { HttpError } from './service';
import { roomByCode, saveSeats, type RoomRow } from './store';
import { seatOf, type SeatEntry, type Seats } from './types';

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

/** Sit the user down: their existing seat, else the first empty one. */
export async function joinRoom(room: RoomRow, userId: string, name: string): Promise<{ room: RoomRow; seated: boolean }> {
  const existing = seatOf(room.seats, userId);
  if (existing !== null) return { room, seated: false };
  if (room.status !== 'lobby') throw new HttpError(409, 'this table has already started');
  const free = room.seats.findIndex((s) => s === null);
  if (free < 0) throw new HttpError(409, 'this table is full');
  const seats = [...room.seats] as [SeatEntry, SeatEntry, SeatEntry, SeatEntry];
  seats[free] = { kind: 'human', userId, name };
  await saveSeats(room.id, seats);
  return { room: { ...room, seats: seats as Seats }, seated: true };
}

const BOT_NAMES = ['Bilal', 'Sana', 'Ayesha', 'Hamza', 'Zara', 'Omar'];

/** Fill every empty seat with a bot, named so the table reads like company. */
export function withBots(seats: Seats): Seats {
  const taken = new Set(seats.flatMap((s) => (s ? [s.name] : [])));
  const names = BOT_NAMES.filter((n) => !taken.has(n));
  let i = 0;
  return seats.map((s) => s ?? { kind: 'bot' as const, name: names[i++] ?? `Bot ${i}` }) as unknown as Seats;
}
