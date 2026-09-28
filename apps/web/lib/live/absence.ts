import { SEATS, type HandState, type Seat } from '@society/engine';
import type { Absence, AwayPlayed, SeatAbsence } from './table-state';
import { isHuman, type AwayReason, type Move, type SeatEntry, type Seats } from './types';
import { parseClientAction, parseSeat } from './validate';

/**
 * Who's at the table and who's away (R1-R5), kept per seat in
 * live_state.table_state.absence and saved with the hand.
 *
 * A seat's person is *away* when a bot plays their tiles instantly, with no
 * clock: after two missed turns or passes in a row (`'clock'`), when the host
 * handed their seat over (`'host'`), or while they take a break (`'self'`).
 * A miss is a turn or a pass of tiles whose clock ran out on them; a claim
 * window that runs out never counts, either way. Any request of their own
 * that reaches the table brings them back, except letting a tile go: a pass
 * is what their clock would have done anyway, and a page left open with
 * nobody at it sends one by itself.
 *
 * Each entry belongs to one sitting: the person's id and the `since` their
 * seat was stamped with when they sat down. A seat that's someone else's
 * now, or the same person sat down afresh, or a bot, starts from a fresh
 * entry. Pure, and safe to load in the browser.
 */

/** Missed turns in a row that make a seat away. */
export const AWAY_AFTER_MISSES = 2;

const NOTHING_PLAYED: AwayPlayed = { turns: 0, sets: 0, exchanges: 0, wins: 0, hands: 0 };

/** A seat nobody has missed a turn in, with nothing to tell: whose it is doesn't matter yet. */
const FRESH: SeatAbsence = { userId: null, since: null, misses: 0, away: null, clockMoves: 0, lastClockMove: null, lastTap: null, tapVersion: null, played: NOTHING_PLAYED };

/** Everyone here, as a game starts. */
export const EVERYONE_HERE: Absence = [FRESH, FRESH, FRESH, FRESH];

const REASONS: readonly AwayReason[] = ['clock', 'host', 'self'];

function isRecord(x: unknown): x is Readonly<Record<string, unknown>> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** A count as stored: a whole number, never below nought. */
function count(x: unknown): number {
  return typeof x === 'number' && Number.isInteger(x) && x > 0 ? x : 0;
}

function played(x: unknown): AwayPlayed {
  if (!isRecord(x)) return NOTHING_PLAYED;
  return { turns: count(x['turns']), sets: count(x['sets']), exchanges: count(x['exchanges']), wins: count(x['wins']), hands: count(x['hands']) };
}

/** The move a clock last made for the seat: always a stand-in's engine move, rebuilt from its checked fields. */
function clockMove(x: unknown): Move | null {
  if (!isRecord(x) || x['by'] !== 'clock') return null;
  const seat = parseSeat(x['seat']);
  const a = parseClientAction(x['a']);
  if (seat === null || a === null || a.type === 'nextHand') return null;
  return { by: 'clock', seat, a };
}

function entry(x: unknown): SeatAbsence {
  if (!isRecord(x)) return FRESH;
  const lastTap = x['lastTap'];
  return {
    userId: typeof x['userId'] === 'string' ? x['userId'] : null,
    since: typeof x['since'] === 'string' ? x['since'] : null,
    misses: count(x['misses']),
    away: (REASONS as readonly unknown[]).includes(x['away']) ? (x['away'] as AwayReason) : null,
    clockMoves: count(x['clockMoves']),
    lastClockMove: clockMove(x['lastClockMove']),
    lastTap: typeof lastTap === 'number' && Number.isFinite(lastTap) ? lastTap : null,
    tapVersion: count(x['tapVersion']) || null,
    played: played(x['played']),
  };
}

/** The stored list, read tolerantly: never throws; anything that isn't four entries is everyone here, and a count that isn't a whole number from nought up is nought. */
export function parseAbsence(x: unknown): Absence {
  if (!Array.isArray(x) || x.length !== 4) return EVERYONE_HERE;
  const [a, b, c, d] = x as unknown[];
  return [entry(a), entry(b), entry(c), entry(d)];
}

function samePlayed(a: AwayPlayed, b: AwayPlayed): boolean {
  return a.turns === b.turns && a.sets === b.sets && a.exchanges === b.exchanges && a.wins === b.wins && a.hands === b.hands;
}

function sameMove(a: Move | null, b: Move | null): boolean {
  return a === b || (a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b));
}

/** Whether an entry has nothing to say about its seat (whoever's it is, and whenever they last tapped). */
export function isFresh(e: SeatAbsence): boolean {
  return e.misses === 0 && e.away === null && e.clockMoves === 0 && e.lastClockMove === null && samePlayed(e.played, NOTHING_PLAYED);
}

/**
 * Whether two lists would tell the table the same thing. When each person
 * last tapped doesn't count (it rides along with whatever else is saved), nor
 * does whose an entry is while both have nothing else to say.
 */
export function sameAbsence(a: Absence, b: Absence): boolean {
  return SEATS.every((seat) => {
    const x = a[seat];
    const y = b[seat];
    if (isFresh(x) && isFresh(y)) return true;
    return (
      x.userId === y.userId &&
      x.since === y.since &&
      x.misses === y.misses &&
      x.away === y.away &&
      x.clockMoves === y.clockMoves &&
      sameMove(x.lastClockMove, y.lastClockMove) &&
      samePlayed(x.played, y.played)
    );
  });
}

/** An entry that's nobody's and says nothing, as a fresh table's are: it goes with any seat. */
function isBlank(e: SeatAbsence): boolean {
  return isFresh(e) && e.userId === null && e.since === null && e.lastTap === null && e.tapVersion === null;
}

/** Whether an entry is this seat's person's, for this sitting. */
function belongs(e: SeatAbsence, seat: SeatEntry): boolean {
  return seat?.kind === 'human' && e.userId === seat.userId && e.since === (seat.since ?? null);
}

/** The entry that goes with a seat as it's filled now: its own, or a fresh one. */
function entryAt(a: Absence | undefined, seats: Seats, seat: Seat): SeatAbsence {
  const e = a?.[seat] ?? FRESH;
  return belongs(e, seats[seat]) ? e : FRESH;
}

/** The entry, now this seat's person's: stamped with who they are and when they sat. */
function own(a: Absence, seats: Seats, seat: Seat): SeatAbsence {
  const s = seats[seat];
  const e = entryAt(a, seats, seat);
  return s?.kind === 'human' ? { ...e, userId: s.userId, since: s.since ?? null } : e;
}

function withEntry(a: Absence, seat: Seat, e: SeatAbsence): Absence {
  return a.map((x, i) => (i === seat ? e : x)) as unknown as Absence;
}

/**
 * Every entry matched against the seats as they are: one whose seat isn't
 * that person's any more (they left and a bot has it, someone else sat down,
 * or they sat down again) starts afresh. Gives back `a` itself when nothing
 * had to change.
 */
export function reconcileAbsence(a: Absence, seats: Seats): Absence {
  let changed = false;
  const out = SEATS.map((seat) => {
    const e = a[seat];
    if (isBlank(e) || belongs(e, seats[seat])) return e;
    changed = true;
    return FRESH;
  });
  return changed ? (out as unknown as Absence) : a;
}

/** Whether a bot is playing this seat's tiles for its person. */
export function isAway(a: Absence | undefined, seats: Seats, seat: Seat): boolean {
  return isHuman(seats, seat) && entryAt(a, seats, seat).away !== null;
}

/** The seats whose person is here: human, and not away. */
export function presentHumans(seats: Seats, a: Absence | undefined): Seat[] {
  return SEATS.filter((seat) => isHuman(seats, seat) && !isAway(a, seats, seat));
}

/** Who's here, by id: the people in presentHumans. */
export function presentUserIds(seats: Seats, a: Absence | undefined): string[] {
  return presentHumans(seats, a).flatMap((seat) => {
    const s = seats[seat];
    return s?.kind === 'human' ? [s.userId] : [];
  });
}

/** Per seat, whether its person is away. */
export function awaySeats(seats: Seats, a: Absence | undefined): boolean[] {
  return SEATS.map((seat) => isAway(a, seats, seat));
}

/**
 * The seat's person tapped something at the table (R4): no misses, not away,
 * nothing to tell them about what the bot did, and the moment noted, with
 * the version of the table that saves it (`version`, when known), so the
 * host's hand-over can't overrule a tap it never saw (R8). How many clock
 * moves they've had stays, so a notice is never shown twice. A seat without
 * a person is left as it is.
 */
export function markPresent(a: Absence, seats: Seats, seat: Seat, now: number, version: number | null = null): Absence {
  if (!isHuman(seats, seat)) return a;
  return withEntry(a, seat, { ...own(a, seats, seat), misses: 0, away: null, lastTap: now, tapVersion: version, played: NOTHING_PLAYED });
}

/** A bot plays the seat for its person from now, for `reason`, with nothing played for them yet. Nothing changes for a seat already away, or one without a person. */
export function markAway(a: Absence, seats: Seats, seat: Seat, reason: AwayReason): Absence {
  if (!isHuman(seats, seat) || isAway(a, seats, seat)) return a;
  return withEntry(a, seat, { ...own(a, seats, seat), away: reason, played: NOTHING_PLAYED });
}

/**
 * A clock ran out on the seat's person and a bot made `move` for them. It's
 * always told to them (`clockMoves`, `lastClockMove`). When it `counts` (a
 * turn or a pass of tiles), it's a miss too, and the second in a row makes
 * them away, with that move the first thing the bot has played for them.
 */
export function noteClockMove(a: Absence, seats: Seats, move: Move, counts: boolean): Absence {
  const seat = move.seat;
  if (seat === undefined || !isHuman(seats, seat)) return a;
  const e = own(a, seats, seat);
  let next: SeatAbsence = { ...e, clockMoves: e.clockMoves + 1, lastClockMove: move };
  if (counts) next = { ...next, misses: next.misses + 1 };
  const out = withEntry(a, seat, next);
  if (!counts || next.misses < AWAY_AFTER_MISSES || next.away !== null) return out;
  return notePlayed(withEntry(out, seat, { ...next, away: 'clock', played: NOTHING_PLAYED }), move);
}

/** What the bot has done for an away seat so far: a discard is a turn, a set picked up or four of a kind put down is a set, three tiles passed is an exchange. */
export function notePlayed(a: Absence, move: Move): Absence {
  const seat = move.seat;
  if (seat === undefined) return a;
  const e = a[seat];
  const m = move.a;
  const p = e.played;
  const next =
    m.type === 'discard'
      ? { ...p, turns: p.turns + 1 }
      : (m.type === 'claim' && m.claim.type !== 'win') || m.type === 'declareKong'
        ? { ...p, sets: p.sets + 1 }
        : m.type === 'exchange'
          ? { ...p, exchanges: p.exchanges + 1 }
          : null;
  return next ? withEntry(a, seat, { ...e, played: next }) : a;
}

/** A hand finished: each away seat has one more hand played for it, and a win if its bot won it. */
export function noteHandEnd(a: Absence, seats: Seats, state: HandState): Absence {
  const winner = state.result?.type === 'win' ? state.result.winner : null;
  let out = a;
  for (const seat of SEATS) {
    if (!isAway(out, seats, seat)) continue;
    const e = out[seat];
    out = withEntry(out, seat, { ...e, played: { ...e.played, hands: e.played.hands + 1, wins: e.played.wins + (winner === seat ? 1 : 0) } });
  }
  return out;
}
