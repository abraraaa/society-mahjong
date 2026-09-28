import 'server-only';
import type { Seat } from '@society/engine';
import { isClosedRoom } from '../front-door';
import { recordEvent } from './events';
import { lastGameFrom, type LastGameRow } from './final';
import { SEAT_ATTEMPTS, hostOf, isHere, seatJoiner, seatOffer, takeSeat, vacate, type Circle, type SeatOffer } from './seating';
import { HttpError } from './errors';
import { logError } from './log';
import type { RoomSnapshot } from './snapshot';
import { followSeat, gameById, lastFinishedGame, lastGameOf, liveMeta, roomByCode, roomMembers, saveSeats, touchMember, type RoomRow } from './store';
import { withLegacyScores } from './table-state';
import { seatOf } from './types';

export type { RoomSnapshot };
export { withBots } from './seating';

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
 * none to give) nobody is marked and there's no last game. `offer` is a
 * bot's seat the caller, not seated, may take over at the game in play
 * (joinRoom).
 */
export function roomSnapshot(room: RoomRow, userId: string, now = Date.now(), circle: RoomCircle | null = null, offer: SeatOffer | null = null): RoomSnapshot {
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
    offer,
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

/** What opening the invite link came to (joinRoom). */
export interface Joined {
  readonly room: RoomRow;
  /** newly seated by this join */
  readonly seated: boolean;
  /** the seat they were given was someone's who isn't here (R18's last step) */
  readonly displaced: boolean;
  readonly circle: RoomCircle | null;
  /** at a game in play, the bot's seat they may take over (seating.ts seatOffer); null otherwise */
  readonly offer: SeatOffer | null;
}

/**
 * The running totals of the game a room is playing, for the seat offered to
 * someone arriving mid-game, read without loading the hand (liveMeta). A
 * table last saved by older code still has them in the room's ledger.
 */
async function playingScores(room: RoomRow): Promise<readonly number[] | null> {
  const meta = room.current_game_id === null ? null : await liveMeta(room.current_game_id);
  if (!meta || meta.table.over) return null;
  return (meta.legacy ? withLegacyScores(meta.table, room.ledger) : meta.table).scores;
}

/**
 * Open the invite link: check in, and sit down if not seated yet. Someone
 * already seated just checks in (touchMember), in any status, and nothing is
 * written to the room. A newcomer between games (or before the first) is
 * seated by R18's order (seating.ts seatJoiner): a bot keeping their own seat,
 * an empty seat, a bot's, then the seat of someone who isn't here (never the
 * host's), unless the room has been quiet for six weeks and they've never
 * been part of it (R24); then they're checked in. Someone arriving at a game
 * in play is offered a bot's seat to take over (`offer`, R21), with nothing
 * written: the seat is theirs only once they take it (sitDown). With no bot
 * playing, they're turned away. The seat write is optimistic on the room's
 * `updated_at`: two friends who tap the link in the same instant both sit,
 * the second of them on a fresh read, and nobody ends up in someone else's
 * seat.
 *
 * `circle` is who's been seen at the room, for the lobby snapshot, with the
 * caller's own check-in in it only when it was written: after a failed touch
 * it says what the next poll will say, and that poll checks them in. It's
 * null for a room in play (the lobby doesn't show one), or when it couldn't
 * be read for someone already seated.
 */
export async function joinRoom(room: RoomRow, userId: string, name: string, now = Date.now()): Promise<Joined> {
  const checkIn = async (r: RoomRow, circle: RoomCircle | null) => {
    const touched = await touchMember(r.id, userId, now);
    return touched && circle !== null ? withCheckIn(circle, userId, now) : circle;
  };
  const none = { seated: false, displaced: false, offer: null } as const;
  let current = room;
  if (seatOf(current.seats, userId) !== null) {
    const circle = current.status === 'playing' ? null : await roomCircle(current, 'show');
    return { ...none, room: current, circle: await checkIn(current, circle) };
  }
  if (current.status === 'playing') return offered(current, userId);
  // Read for real: whether the room is closed to this person depends on it, and so may whose seat they're given, and a blip
  // mustn't turn anyone away for good, or displace anyone on a guess.
  let circle = await roomCircle(current, 'decide');
  for (let attempt = 1; ; attempt++) {
    if (seatOf(current.seats, userId) !== null) return { ...none, room: current, circle: await checkIn(current, circle) };
    if (current.status === 'playing') return offered(current, userId);
    // A code is enough to sit down, so a room doesn't stay open to strangers forever: after six quiet weeks only its own people get in.
    const lastSeen = Math.max(Number.NEGATIVE_INFINITY, ...circle.seen.values());
    if (!circle.seen.has(userId) && isClosedRoom(current, now, Number.isFinite(lastSeen) ? lastSeen : null)) throw new HttpError(410, 'this table has closed');
    const seats = seatJoiner(current.seats, current.status, { userId, name }, now, { hostId: current.host_id, circle });
    if (!seats) throw new HttpError(409, 'this table is full');
    const updated_at = await saveSeats(current.id, seats, current.updated_at);
    if (updated_at) {
      const seated = { ...current, seats, updated_at };
      const at = seatOf(seats, userId);
      const displaced = at !== null && current.seats[at]?.kind === 'human';
      return { room: seated, seated: true, displaced, offer: null, circle: await checkIn(seated, circle) };
    }
    if (attempt >= SEAT_ATTEMPTS) throw new HttpError(409, 'that seat was just taken; try again');
    current = await requireRoom(current.code);
    // The room may have been dealt again, or a game finished, since: who's here is judged against it as it now is.
    if (current.status !== 'playing') circle = await roomCircle(current, 'decide');
  }
}

/** joinRoom at a game in play: the bot's seat the caller may take over, or 409 when no bot is playing (or the game has just ended). */
async function offered(room: RoomRow, userId: string): Promise<Joined> {
  const scores = await playingScores(room);
  const offer = scores === null ? null : seatOffer(room.seats, userId, scores);
  if (!offer) throw new HttpError(409, 'this table has already started');
  return { room, seated: false, displaced: false, circle: null, offer };
}

/** How someone came to take a seat mid-game, as the funnel counts it: back in the seat kept since they left, the seat kept since the deal they missed, or another. */
export type TakeHow = 'sit_back' | 'kept_seat' | 'take_over';

/** What sitting down came to (sitDown). */
export interface SatDown {
  readonly room: RoomRow;
  /** a bot's seat was taken over at the game in play */
  readonly took: boolean;
  /** how, when it was (TakeHow) */
  readonly how: TakeHow | null;
  /** the room wasn't playing, so it was a join (joinRoom), and the caller was newly seated by it */
  readonly joined: boolean;
  /** that join put them in the seat of someone who isn't here */
  readonly displaced: boolean;
  /** the join's circle, for the lobby's snapshot; null when it wasn't a join */
  readonly circle: RoomCircle | null;
}

/**
 * Sit down in `seat` from the take-over screen (R21): at a game in play, take
 * that seat over from its bot, carrying on with its tiles and points. Only
 * a bot's seat, and only one the caller may take (seating.ts takeSeat): a
 * seat kept for someone else isn't, while a bot keeping nobody's is free. The
 * write is optimistic, like a join's; a third loss asks for another tap. Once
 * it's taken they're checked in, the game's record of who sits where follows
 * (followSeat), and the funnel counts it. (The table notes the take-over with
 * a commit of its own: service.ts noteTakeOver.)
 *
 * Someone already seated takes nothing. A room that isn't playing (the game
 * ended since the offer was made) is joined instead, as the invite link would.
 */
export async function sitDown(room: RoomRow, userId: string, name: string, seat: Seat, now = Date.now()): Promise<SatDown> {
  const quiet = { took: false, how: null, joined: false, displaced: false, circle: null } as const;
  let current = room;
  for (let attempt = 1; ; attempt++) {
    if (seatOf(current.seats, userId) !== null) return { ...quiet, room: current };
    if (current.status !== 'playing') {
      const j = await joinRoom(current, userId, name, now);
      return { ...quiet, room: j.room, joined: j.seated, displaced: j.displaced, circle: j.circle };
    }
    const seats = takeSeat(current.seats, seat, { userId, name }, now);
    if (!seats) {
      const s = current.seats[seat];
      if (s?.kind === 'human') throw new HttpError(409, 'that seat is taken');
      if (s?.kind === 'bot') throw new HttpError(409, 'that seat is kept for someone');
      throw new HttpError(409, 'that is not a seat to sit in');
    }
    const updated_at = await saveSeats(current.id, seats, current.updated_at);
    if (updated_at) {
      const was = current.seats[seat];
      const how: TakeHow = was?.kind === 'bot' && was.heldFor === userId ? (was.kept === 'late' ? 'kept_seat' : 'sit_back') : 'take_over';
      const taken = { ...current, seats, updated_at };
      await touchMember(taken.id, userId, now);
      if (taken.current_game_id !== null) await followSeat(taken.current_game_id, seat, seats[seat] ?? null);
      await recordEvent({ type: 'seat_taken', roomId: taken.id, ...(taken.current_game_id ? { gameId: taken.current_game_id } : {}), userId, data: { how, status: taken.status } });
      return { ...quiet, room: taken, took: true, how };
    }
    if (attempt >= SEAT_ATTEMPTS) throw new HttpError(409, 'that seat was just taken; try again');
    current = await requireRoom(current.code);
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
