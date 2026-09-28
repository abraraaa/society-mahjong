import { EVERYONE_HERE, isFresh, parseAbsence, sameAbsence } from './absence';
import { STALE_GAME_MS } from './lifecycle';
import type { AwayReason, Deadlines, GameEndHow, Move, SeatEntry, Seats } from './types';

/**
 * live_state.table_state: the table's own bookkeeping, as one JSON document
 * the app owns (docs/DATA-MODEL.md). It's saved by the same commit_table call
 * as the hand, so the two can never disagree.
 *
 * Each part arrives with the code that first uses it. Today that's the
 * running scores, who's away and how the game ended; the next-hand ready
 * check comes later. Parsing is tolerant, and it keeps every top-level key it
 * doesn't know in `extra` and writes it back untouched, so an older deploy
 * never erases a newer one's bookkeeping. A row whose `v` is newer than this
 * code knows isn't saved over at all (service.ts).
 */

/** The version this code writes. */
export const TABLE_STATE_V = 1;

/** One number per seat, in seat order. */
export type Scores4 = readonly [number, number, number, number];

/**
 * How the game ended, saved by the request that ended it (R12). Once it's
 * set the game is over, whatever games.status still says: step() refuses
 * every move, and the rest of the bookkeeping (who finished where, the game's
 * and the room's status) is written from this alone, again if need be.
 */
export interface GameOver {
  readonly how: GameEndHow;
  /** who ended it, when someone did; null for a last hand scored, or a game everyone left */
  readonly by: { readonly userId: string; readonly name: string } | null;
  /** when it ended, in epoch ms */
  readonly at: number;
  /** how many hands finished: an unfinished hand doesn't count */
  readonly hands: number;
  /** the final totals, as the table had them at the end */
  readonly scores: Scores4;
  /** who sat where at the end, so a finished game's page never reads another game's seats */
  readonly seats: Seats;
}

/** What a bot has done for an away seat since its person went: shown to them when they look again (presence.ts awaySummary). */
export interface AwayPlayed {
  readonly turns: number;
  readonly sets: number;
  readonly exchanges: number;
  readonly wins: number;
  readonly hands: number;
}

/**
 * One seat's absence (absence.ts): whose it is (the person's id, and the
 * `since` of the sitting), how many clocks in a row have run out on them,
 * whether a bot is playing their tiles and why, the clock moves made for
 * them (a count, and the last, for the notice), when they last tapped (for
 * the host's hand-over, R8), and what the bot has played for them while away.
 */
export interface SeatAbsence {
  readonly userId: string | null;
  readonly since: string | null;
  readonly misses: number;
  readonly away: AwayReason | null;
  readonly clockMoves: number;
  /** unstamped: the notice needs the move, not its version; it can hold the tiles passed, so only its own person ever sees it */
  readonly lastClockMove: Move | null;
  readonly lastTap: number | null;
  readonly played: AwayPlayed;
}

export type Absence = readonly [SeatAbsence, SeatAbsence, SeatAbsence, SeatAbsence];

export interface TableState {
  readonly v: number;
  /** the game's running totals, a finished hand's points already in; null only on a legacy row, whose totals are still in rooms.ledger */
  readonly scores: Scores4 | null;
  /** how the game ended; null while it's in play */
  readonly over: GameOver | null;
  /** who's away, per seat; everyone here on a fresh or legacy table */
  readonly absence: Absence;
  /** top-level keys this code doesn't know, written back untouched */
  readonly extra: Readonly<Record<string, unknown>>;
}

/** A game that has just been dealt: nobody has any points yet, and it's in play. */
export const NEW_TABLE: TableState = { v: TABLE_STATE_V, scores: [0, 0, 0, 0], over: null, absence: EVERYONE_HERE, extra: {} };

/** The keys this code reads. Everything else goes in `extra`, and so does an `over` it can't read (parseOver), and anything a legacy row holds besides. */
const KNOWN: readonly string[] = ['v', 'scores', 'over', 'absence'];

const END_HOWS: readonly GameEndHow[] = ['complete', 'host', 'idle', 'abandoned'];

function isRecord(x: unknown): x is Readonly<Record<string, unknown>> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function scores4(x: unknown): Scores4 | null {
  if (!Array.isArray(x) || x.length !== 4) return null;
  const [a, b, c, d] = x as unknown[];
  return isFiniteNumber(a) && isFiniteNumber(b) && isFiniteNumber(c) && isFiniteNumber(d) ? [a, b, c, d] : null;
}

/** A seat as rooms.seats keeps it, with any keys this code doesn't read left on; anything else is an empty seat. */
function seatEntry(x: unknown): SeatEntry {
  if (!isRecord(x) || typeof x['name'] !== 'string') return null;
  if (x['kind'] === 'human' && typeof x['userId'] === 'string') return x as unknown as SeatEntry;
  return x['kind'] === 'bot' ? (x as unknown as SeatEntry) : null;
}

function seats4(x: unknown): Seats {
  if (!Array.isArray(x) || x.length !== 4) return [null, null, null, null];
  const [a, b, c, d] = x as unknown[];
  return [seatEntry(a), seatEntry(b), seatEntry(c), seatEntry(d)];
}

/**
 * How the game ended, read tolerantly: anything missing gets its default
 * (nobody, the epoch, no hands, the table's own totals, empty seats). One whose
 * `how` this code doesn't know isn't read at all: it stays in `extra`, written
 * back as it was, rather than being taken for an end this code can't describe.
 */
function parseOver(x: unknown, scores: Scores4): GameOver | null {
  if (!isRecord(x) || !(END_HOWS as readonly unknown[]).includes(x['how'])) return null;
  const by = x['by'];
  const hands = x['hands'];
  return {
    how: x['how'] as GameEndHow,
    by: isRecord(by) && typeof by['userId'] === 'string' && typeof by['name'] === 'string' ? { userId: by['userId'], name: by['name'] } : null,
    at: isFiniteNumber(x['at']) ? x['at'] : 0,
    hands: typeof hands === 'number' && Number.isInteger(hands) && hands >= 0 ? hands : 0,
    scores: scores4(x['scores']) ?? scores,
    seats: seats4(x['seats']),
  };
}

/**
 * The document as stored, read tolerantly: it never throws, and whatever is
 * missing or unreadable gets its default. `legacy` means it has no `"v"`
 * (0005's default `'{}'`, or anything that isn't a document): a game dealt by
 * code that didn't keep this, so it's in play with everyone here, and its
 * running totals are still in rooms.ledger (`withLegacyScores`). A `v` newer
 * than TABLE_STATE_V is read as given, parts and all.
 */
export function parseTableState(x: unknown): { readonly table: TableState; readonly legacy: boolean } {
  const doc = isRecord(x) ? x : {};
  const v = doc['v'];
  const legacy = typeof v !== 'number' || !Number.isInteger(v) || v < 1;
  const scores = legacy ? null : (scores4(doc['scores']) ?? [0, 0, 0, 0]);
  // A legacy row is a game in play, whatever else it holds.
  const over = scores === null ? null : parseOver(doc['over'], scores);
  // So is everyone at it here.
  const absence = legacy ? EVERYONE_HERE : parseAbsence(doc['absence']);
  const extra = Object.fromEntries(Object.entries(doc).filter(([key]) => !KNOWN.includes(key) || (key === 'over' && over === null) || (key === 'absence' && legacy)));
  return { table: { v: legacy ? TABLE_STATE_V : (v as number), scores, over, absence, extra }, legacy };
}

/**
 * The document to store: written as this code's version, with the keys it
 * doesn't know put back as they were. `absence` is written only once some
 * seat has something in it, and `over` only once it's set.
 */
export function tableStateJson(t: TableState): Record<string, unknown> {
  const over = t.over && { ...t.over, by: t.over.by && { ...t.over.by }, scores: [...t.over.scores], seats: [...t.over.seats] };
  const absence = t.absence.every((e) => isFresh(e) && e.lastTap === null) ? null : t.absence.map((e) => ({ ...e, played: { ...e.played } }));
  return { ...t.extra, v: TABLE_STATE_V, scores: [...(t.scores ?? [0, 0, 0, 0])], ...(absence ? { absence } : {}), ...(over ? { over } : {}) };
}

/** JSON values compared by what they hold, whatever order an object's keys are in. */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && sameJson(a[k], b[k]));
}

/**
 * Whether two documents would tell the table the same thing, so a step that
 * changes neither the hand nor this writes nothing. When each person last
 * tapped isn't news by itself (sameAbsence): it's saved with whatever else is.
 */
export function sameTableState(a: TableState, b: TableState): boolean {
  return a.v === b.v && sameJson(a.scores, b.scores) && sameJson(a.over, b.over) && sameAbsence(a.absence, b.absence) && sameJson(a.extra, b.extra);
}

/**
 * A legacy row's running totals, seeded from rooms.ledger, which is where the
 * code before this kept them: normalised to four numbers, anything missing or
 * not a number read as 0. That's the only read of rooms.ledger left, and
 * nothing writes it any more: the next commit saves the totals here. A row
 * that already has its scores is given back as it is.
 */
export function withLegacyScores(t: TableState, ledger: readonly unknown[] | null | undefined): TableState {
  if (t.scores !== null) return t;
  const at = (i: number): number => {
    const n = Array.isArray(ledger) ? ledger[i] : undefined;
    return isFiniteNumber(n) ? n : 0;
  };
  return { ...t, scores: [at(0), at(1), at(2), at(3)] };
}

/**
 * When a person last moved the table (R23). live_state.acted_at says, except
 * on a legacy row: code before this never wrote acted_at (the migration gave
 * existing rows its own time), but it did stamp updated_at on every save, so
 * there the later of the two is the truth.
 */
export function lastActed(row: { readonly legacy: boolean; readonly actedAt: number; readonly updatedAt: number }): number {
  return row.legacy ? Math.max(row.actedAt, row.updatedAt) : row.actedAt;
}

/**
 * live_state.wake_at, the one thing the sweep asks (R27): the next moment
 * the server has to act on this table unasked. That's the earliest of its two
 * clocks and the moment it ends as idle, STALE_GAME_MS after a person last
 * moved it (`actedAt`, as lastActed reads it), so a table parked where no
 * clock runs is still found. Null once the game is over.
 */
export function wakeAt(x: { readonly deadlines: Deadlines; readonly table: TableState; readonly actedAt: number }): number | null {
  if (x.table.over) return null;
  const times = [x.deadlines.claim, x.deadlines.turn, x.actedAt + STALE_GAME_MS].filter((t): t is number => t !== null && Number.isFinite(t));
  return times.length === 0 ? null : Math.min(...times);
}
