import type { Seat } from '@society/engine';
import { seatOf, type RoomStatus, type SeatEntry, type Seats } from './types';

/**
 * How many times a seat write is tried after someone else's lands first. A
 * third loss means the room is busy right now; the tap can simply be repeated.
 */
export const SEAT_ATTEMPTS = 3;

/** Who is sitting down: their id, and the name the table will call them. */
export interface Joiner {
  readonly userId: string;
  readonly name: string;
}

/** A person's seat entry, stamped with when they sat (`since`, ISO), which says who has sat longest (hostOf) and starts their absence afresh. */
function sitting(joiner: Joiner, now: number): SeatEntry {
  return { kind: 'human', userId: joiner.userId, name: joiner.name, since: new Date(now).toISOString() };
}

function withSeat(seats: Seats, seat: number, entry: SeatEntry): Seats {
  return seats.map((s, i) => (i === seat ? entry : s)) as unknown as Seats;
}

/** Whose seat a bot is keeping, or null for a bot keeping nobody's (or anything that isn't a bot). */
function heldFor(entry: SeatEntry): string | null {
  return entry?.kind === 'bot' && typeof entry.heldFor === 'string' ? entry.heldFor : null;
}

/**
 * The seats with the joiner sat down, or null when there's nowhere for them.
 * Pure, so the lobby's seat-picking has tests; the write itself is in
 * rooms.ts. The new seat is stamped with `since` (sitting).
 *
 * With `pick` (the room's host and who's been seen at it), between games or
 * before the first, R18's order:
 * 1. a bot keeping the joiner's own seat;
 * 2. an empty seat;
 * 3. a bot keeping nobody's seat;
 * 4. a bot keeping someone else's seat, but never the host's (the host
 *    comes back to it: a newcomer never takes the host's seat);
 * 5. the seat of someone who isn't here (isHere), least recently seen first
 *    (nobody seen before anyone seen, then the oldest visit; ties by seat),
 *    but never the room's host's.
 * A `circle` of null means who's here isn't known yet: steps 1 to 4 only,
 * so the caller reads it only when nothing else is free.
 * A room in play seats nobody this way (null): someone arriving then takes a
 * bot's seat over instead (takeSeat).
 *
 * Without it, the order before rooms knew who was here: the first empty seat,
 * or between games (a finished room) the first bot's.
 */
export function seatJoiner(seats: Seats, status: RoomStatus, joiner: Joiner, now: number, pick?: SeatPick): Seats | null {
  const at = pick ? pickSeat(seats, status, joiner, now, pick) : seats.findIndex((s) => s === null || (status === 'finished' && s.kind === 'bot'));
  return at < 0 ? null : withSeat(seats, at, sitting(joiner, now));
}

/** What seatJoiner picks by, between games: the room's host, and who's been seen at the room (null: not read, so R18's last step isn't tried). */
export interface SeatPick {
  readonly hostId: string;
  readonly circle: Circle | null;
}

/** R18's order (seatJoiner): the seat the joiner gets, or -1. */
function pickSeat(seats: Seats, status: RoomStatus, joiner: Joiner, now: number, pick: SeatPick): number {
  if (status === 'playing') return -1;
  const first = (test: (s: SeatEntry) => boolean) => seats.findIndex(test);
  const steps = [
    first((s) => heldFor(s) === joiner.userId),
    first((s) => s === null),
    first((s) => s?.kind === 'bot' && heldFor(s) === null),
    first((s) => s?.kind === 'bot' && heldFor(s) !== pick.hostId),
  ];
  const found = steps.find((i) => i >= 0);
  if (found !== undefined) return found;
  const circle = pick.circle;
  if (circle === null) return -1;
  // Someone else's seat, then: never the host's, and never anyone here. Unseen first, then the longest since they were seen.
  const away = seats.flatMap((s, i) =>
    s?.kind === 'human' && s.userId !== pick.hostId && !isHere(s, circle, now) ? [{ i, seen: circle.seen.get(s.userId) ?? Number.NEGATIVE_INFINITY }] : [],
  );
  away.sort((a, b) => (a.seen === b.seen ? a.i - b.i : a.seen < b.seen ? -1 : 1));
  return away[0]?.i ?? -1;
}

/** The seats with one of them emptied. */
export function vacate(seats: Seats, seat: Seat): Seats {
  return withSeat(seats, seat, null);
}

/** The names a bot is given, so the table reads like company. */
export const BOT_NAMES: readonly string[] = ['Bilal', 'Sana', 'Ayesha', 'Hamza', 'Zara', 'Omar'];

/** Bot names nobody at the table has, nor anyone in `also` (people a bot is about to keep a seat for), in BOT_NAMES' order. */
function freeBotNames(seats: Seats, also: readonly string[] = []): string[] {
  const taken = new Set([...seats.flatMap((s) => (s ? [s.name] : [])), ...also]);
  return BOT_NAMES.filter((n) => !taken.has(n));
}

/** Fill every empty seat with a bot, named so the table reads like company. */
export function withBots(seats: Seats): Seats {
  const names = freeBotNames(seats);
  let i = 0;
  return seats.map((s) => s ?? { kind: 'bot' as const, name: names[i++] ?? `Bot ${i}` }) as unknown as Seats;
}

/**
 * The seats as the game is dealt (R19): an empty seat gets a fresh bot; a
 * person who isn't here (`here` false) gets a bot keeping the seat for them
 * (`kept: 'late'`), so they can take it when they arrive; a bot already
 * keeping someone's seat goes on keeping it, now for someone who wasn't here
 * at the deal (`'late'`). Nobody's seat is given away. A bot keeping a seat is
 * never given its person's name, so the table can tell them apart.
 */
export function seatsForDeal(seats: Seats, here: (seat: Seat) => boolean): Seats {
  const late = seats.flatMap((s, i) => (s?.kind === 'human' && !here(i as Seat) ? [s.name] : []));
  const names = freeBotNames(seats, late);
  let n = 0;
  const next = () => names[n++] ?? `Bot ${n}`;
  return seats.map((s, i) => {
    if (s === null) return { kind: 'bot' as const, name: next() };
    if (s.kind === 'human') return here(i as Seat) ? s : { kind: 'bot' as const, name: next(), heldFor: s.userId, keptName: s.name, kept: 'late' as const };
    return heldFor(s) === null ? s : { ...s, kept: 'late' as const };
  }) as unknown as Seats;
}

/** How many bots the deal will seat (seatsForDeal): the empty seats, the bots, and a bot for each person who isn't here. */
export function botsAtDeal(seats: Seats, here: (seat: Seat) => boolean): number {
  return seatsForDeal(seats, here).filter((s) => s?.kind === 'bot').length;
}

/**
 * Someone gets up from a game in play (R20): a bot takes their seat so the
 * others can carry on, and keeps it for them (`kept: 'left'`), so they can
 * sit back down whenever they open the link again. Named afresh, never with
 * their own name.
 */
export function standIn(seats: Seats, seat: Seat, leaver: Joiner): Seats {
  const vacated = vacate(seats, seat);
  const name = freeBotNames(vacated, [leaver.name])[0] ?? 'Bot 1';
  return withSeat(vacated, seat, { kind: 'bot', name, heldFor: leaver.userId, keptName: leaver.name, kept: 'left' });
}

/**
 * A seat someone who isn't seated may take over from its bot at a game in
 * play (R21): which, the bot's name, why it's theirs to take (`left`: a bot
 * has kept it since they left; `late`: a bot has kept it since the deal,
 * which they missed; `other`: someone else's seat, or nobody's), and its
 * running total, which they carry on with.
 */
export interface SeatOffer {
  readonly seat: Seat;
  readonly botName: string;
  readonly why: 'left' | 'late' | 'other';
  readonly score: number;
}

/**
 * The seat to offer someone at a game in play (R21), or null when they're
 * seated already or no bot is playing: a seat kept for them first; otherwise
 * a bot keeping nobody's seat, then one keeping someone else's (ties by
 * seat). An away person's seat is a person's, so it's never offered.
 */
export function seatOffer(seats: Seats, userId: string, scores: readonly number[]): SeatOffer | null {
  if (seatOf(seats, userId) !== null) return null;
  const bots = seats.flatMap((s, i) => (s?.kind === 'bot' ? [{ seat: i as Seat, bot: s, keeps: heldFor(s) }] : []));
  const mine = bots.find((b) => b.keeps === userId);
  const pick = mine ?? bots.find((b) => b.keeps === null) ?? bots[0];
  if (!pick) return null;
  const score = scores[pick.seat];
  return {
    seat: pick.seat,
    botName: pick.bot.name,
    why: mine ? (pick.bot.kept === 'late' ? 'late' : 'left') : 'other',
    score: typeof score === 'number' && Number.isFinite(score) ? score : 0,
  };
}

/**
 * The seats with the joiner in `seat`, taken over from its bot at a game in
 * play (R21), or null when it isn't theirs to take: the joiner is seated
 * already, the seat isn't a bot's, or its bot is keeping it for someone else
 * while a bot keeping nobody's seat is free. The new entry is stamped with
 * `since` (sitting), so they start afresh.
 */
export function takeSeat(seats: Seats, seat: Seat, joiner: Joiner, now: number): Seats | null {
  if (seatOf(seats, joiner.userId) !== null) return null;
  const s = seats[seat];
  if (s?.kind !== 'bot') return null;
  const keeps = heldFor(s);
  if (keeps !== null && keeps !== joiner.userId && seats.some((x) => x?.kind === 'bot' && heldFor(x) === null)) return null;
  return withSeat(seats, seat, sitting(joiner, now));
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

/**
 * How long someone stays "here" between games after they were last seen at
 * the room (R17): opening the invite link, sitting down, starting a game, or
 * being at the table when a game ended.
 */
export const HERE_FOR_MS = 6 * 60 * 60 * 1000;

/**
 * How stale a seated person's check-in may get while they have the lobby
 * open before its poll checks them in again: at most two writes an hour
 * each, and someone who sits in the lobby for hours stays here.
 */
export const SEEN_REFRESH_MS = 30 * 60 * 1000;

/**
 * Who's been seen at a room, from room_members (user id to `last_seen_at`,
 * epoch ms), and when the room's last game ended (null unless the room is
 * between games after one). Read afresh for each request, never stamped on
 * the seats.
 */
export interface Circle {
  readonly seen: ReadonlyMap<string, number>;
  readonly lastEndedAt: number | null;
}

/**
 * Whether the person in a seat is here between games (R17): a human with a
 * member row whose `last_seen_at` is within HERE_FOR_MS and no earlier than
 * the end of the room's last game. So whoever was at the table when a game
 * ended stays here for six hours, someone a bot was playing for at the end
 * (or everyone, after an idle end or an abandon) isn't until they open the
 * link, and a seat with no member row (from before rooms kept them) isn't
 * either. A bot or an empty seat is never here.
 */
export function isHere(entry: SeatEntry, circle: Circle, now: number): boolean {
  if (entry?.kind !== 'human') return false;
  const seen = circle.seen.get(entry.userId);
  if (seen === undefined || now - seen > HERE_FOR_MS) return false;
  return circle.lastEndedAt === null || seen >= circle.lastEndedAt;
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
 * `present` says whether the person in a seat is here: at a game in play,
 * not away (service.ts); between games, seen lately (isHere, rooms.ts).
 * Anyone not seated is never the answer, whatever their id.
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
