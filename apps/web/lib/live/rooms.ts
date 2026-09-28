import 'server-only';
import { isClosedRoom } from '../front-door';
import { lastGameFrom, type LastGameRow } from './final';
import { SEAT_ATTEMPTS, hostOf, isHere, seatJoiner, vacate, type Circle } from './seating';
import { HttpError } from './errors';
import { logError } from './log';
import type { RoomSnapshot } from './snapshot';
import { gameById, lastFinishedGame, lastGameOf, roomByCode, roomMembers, saveSeats, touchMember, type RoomRow } from './store';
import { seatOf, type Seats } from './types';

export type { RoomSnapshot };

/** Who's been seen at a room (Circle), and the room's latest finished game, for the lobby's "Last game". */
export type RoomCircle = Circle & { readonly lastGame: LastGameRow | null };

/**
 * Who's been seen at the room lately (room_members), when its last game
 * ended, and its latest finished game: what the lobby needs to say who's
 * here and who won last time. The members and the current game are read
 * together; `lastEndedAt` is the current game's end whenever the room is
 * between games, an abandoned game's included (nobody was at the table at
 * the end of that one). `lastGame` is that same game when it finished, else
 * (an abandon) the room's latest finished game, read then, so an abandoned
 * game never hides the room's last real result.
 *
 * In 'show' mode (a lobby snapshot) a read that fails is logged as
 * room_circle_failed and gives null: the lobby then tags nobody and shows no
 * last game, and its next poll tries again. In 'decide' mode (the start, and
 * seating a newcomer) it throws, so nobody is dealt out, displaced or turned
 * away on a guess.
 */
export async function roomCircle(room: RoomRow, mode: 'decide'): Promise<RoomCircle>;
export async function roomCircle(room: RoomRow, mode: 'show'): Promise<RoomCircle | null>;
export async function roomCircle(room: RoomRow, mode: 'show' | 'decide'): Promise<RoomCircle | null> {
  try {
    const between = room.status === 'finished' && room.current_game_id !== null;
    const [members, current] = await Promise.all([roomMembers(room.id), between ? lastGameOf(room.current_game_id!) : Promise.resolve(null)]);
    const lastGame = !between ? null : current?.status === 'finished' ? current : await lastFinishedGame(room.id);
    return {
      seen: new Map(members.map((m) => [m.userId, m.lastSeenAt])),
      lastEndedAt: between ? (current?.endedAt ?? null) : null,
      lastGame,
    };
  } catch (err) {
    if (mode === 'decide') throw err;
    logError('room_circle_failed', err, { roomId: room.id });
    return null;
  }
}

/** The circle with one person checked in at `at`, as their touch has just written it: no second read. */
export function withCheckIn<C extends Circle>(circle: C, userId: string, at: number): C {
  return { ...circle, seen: new Map(circle.seen).set(userId, at) };
}

/**
 * Who has the host's powers in the room (hostOf), as the lobby and the start
 * route both work it out: while a game is in play, among everyone seated (the
 * table itself also passes over anyone away); between games, among those who
 * are here (seating.ts isHere). With no circle (it couldn't be read) everyone
 * seated counts, which only picks the lobby's labels: the start reads its own.
 */
export function powersIn(room: Pick<RoomRow, 'host_id' | 'status' | 'seats'>, circle: Circle | null, now: number): string | null {
  const between = room.status !== 'playing' && circle !== null;
  return hostOf(room.host_id, room.seats, (seat) => (between ? isHere(room.seats[seat] ?? null, circle, now) : room.seats[seat]?.kind === 'human'));
}

/**
 * The lobby as the caller sees it. With a circle, between games, a seated
 * person who isn't here (seating.ts isHere) is marked `notHere`, the host's
 * powers go to whoever here should have them (powersIn), and a finished room
 * shows its last game. Without one (it couldn't be read, or the caller had
 * none to give) nobody is marked and there's no last game.
 */
export function roomSnapshot(room: RoomRow, userId: string, now = Date.now(), circle: RoomCircle | null = null): RoomSnapshot {
  const between = room.status !== 'playing' && circle !== null;
  const host = powersIn(room, circle, now);
  return {
    id: room.id,
    code: room.code,
    rulesetId: room.ruleset_id,
    status: room.status,
    seats: room.seats.map((s) =>
      s ? (between && s.kind === 'human' && !isHere(s, circle, now) ? { kind: s.kind, name: s.name, notHere: true as const } : { kind: s.kind, name: s.name }) : null,
    ),
    me: seatOf(room.seats, userId),
    // The same answer the start route gives, so someone the lobby calls host is never refused the start.
    isHost: host !== null && host === userId,
    hostSeat: host === null ? null : seatOf(room.seats, host),
    gameId: room.current_game_id,
    lastGame: room.status === 'finished' && circle !== null ? lastGameFrom(circle.lastGame, userId) : null,
  };
}

/** The room with this code, as it stands: see withGameOver. */
export async function requireRoom(code: string): Promise<RoomRow> {
  const room = await roomByCode(code);
  if (!room) throw new HttpError(404, 'no room with that code');
  return withGameOver(room);
}

/**
 * A room whose row says "playing" but whose game is over, or gone, reads as
 * finished. finishGame writes the room before the game, so it no longer
 * leaves one behind; but a room left before it did would otherwise send
 * everyone from the lobby back to a final table, and its host could never
 * deal again. (A game whose end is saved but whose finish never ran still
 * reads active here: service.ts settleRoomGame finishes that one.)
 */
async function withGameOver(room: RoomRow): Promise<RoomRow> {
  if (room.status !== 'playing') return room;
  const game = room.current_game_id === null ? null : await gameById(room.current_game_id);
  return game?.status === 'active' ? room : { ...room, status: 'finished' };
}

/**
 * Open the invite link: check in, and sit down if not seated yet. Someone
 * already seated just checks in (touchMember), in any status, and nothing is
 * written to the room. A newcomer between games (or before the first) gets
 * the first free seat (seatJoiner), unless the room has been quiet for six
 * weeks and they've never been part of it (R24), then checks in. A newcomer
 * to a game in play is turned away. The seat write is optimistic on the
 * room's `updated_at`: two friends who tap the link in the same instant both
 * sit, the second of them on a fresh read, and nobody ends up in someone
 * else's seat.
 *
 * `circle` is who's been seen at the room, for the lobby snapshot, with the
 * caller's own check-in in it only when it was written: after a failed touch
 * it says what the next poll will say, and that poll checks them in. It's
 * null for a room in play (the lobby doesn't show one), or when it couldn't
 * be read for someone already seated.
 */
export async function joinRoom(room: RoomRow, userId: string, name: string, now = Date.now()): Promise<{ room: RoomRow; seated: boolean; circle: RoomCircle | null }> {
  const checkIn = async (r: RoomRow, circle: RoomCircle | null) => {
    const touched = await touchMember(r.id, userId, now);
    return touched && circle !== null ? withCheckIn(circle, userId, now) : circle;
  };
  let current = room;
  if (seatOf(current.seats, userId) !== null) {
    const circle = current.status === 'playing' ? null : await roomCircle(current, 'show');
    return { room: current, seated: false, circle: await checkIn(current, circle) };
  }
  if (current.status === 'playing') throw new HttpError(409, 'this table has already started');
  // Read for real: whether the room is closed to this person depends on it, and a blip mustn't turn anyone away for good.
  let circle = await roomCircle(current, 'decide');
  for (let attempt = 1; ; attempt++) {
    if (seatOf(current.seats, userId) !== null) return { room: current, seated: false, circle: await checkIn(current, circle) };
    if (current.status === 'playing') throw new HttpError(409, 'this table has already started');
    // A code is enough to sit down, so a room doesn't stay open to strangers forever: after six quiet weeks only its own people get in.
    const lastSeen = Math.max(Number.NEGATIVE_INFINITY, ...circle.seen.values());
    if (!circle.seen.has(userId) && isClosedRoom(current, now, Number.isFinite(lastSeen) ? lastSeen : null)) throw new HttpError(410, 'this table has closed');
    const seats = seatJoiner(current.seats, current.status, { userId, name }, now);
    if (!seats) throw new HttpError(409, 'this table is full');
    const updated_at = await saveSeats(current.id, seats, current.updated_at);
    if (updated_at) {
      const seated = { ...current, seats, updated_at };
      return { room: seated, seated: true, circle: await checkIn(seated, circle) };
    }
    if (attempt >= SEAT_ATTEMPTS) throw new HttpError(409, 'that seat was just taken; try again');
    current = await requireRoom(current.code);
    // The room may have been dealt again, or a game finished, since: who's here is judged against it as it now is.
    if (current.status !== 'playing') circle = await roomCircle(current, 'decide');
  }
}

/** Stand up from the lobby, before the first game or between games. The seat empties; the room stays open for the others. */
export async function leaveRoom(room: RoomRow, userId: string): Promise<RoomRow> {
  let current = room;
  for (let attempt = 1; ; attempt++) {
    const me = seatOf(current.seats, userId);
    if (me === null) return current;
    if (current.status === 'playing') throw new HttpError(409, 'the table has started; leave it from the game');
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
