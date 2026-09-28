import type { Deadlines } from './types';

/**
 * live_state.table_state: the table's own bookkeeping, as one JSON document
 * the app owns (docs/DATA-MODEL.md). It's saved by the same commit_table call
 * as the hand, so the two can never disagree.
 *
 * Each part arrives with the code that first uses it. Today that's the
 * running scores; how the game ended, who's away and the next-hand ready
 * check come later. Parsing is tolerant, and it keeps every top-level key it
 * doesn't know in `extra` and writes it back untouched, so an older deploy
 * never erases a newer one's bookkeeping. A row whose `v` is newer than this
 * code knows isn't saved over at all (service.ts).
 */

/** The version this code writes. */
export const TABLE_STATE_V = 1;

/** One number per seat, in seat order. */
export type Scores4 = readonly [number, number, number, number];

export interface TableState {
  readonly v: number;
  /** the game's running totals, a finished hand's points already in; null only on a legacy row, whose totals are still in rooms.ledger */
  readonly scores: Scores4 | null;
  /** top-level keys this code doesn't know, written back untouched */
  readonly extra: Readonly<Record<string, unknown>>;
}

/** A game that has just been dealt: nobody has any points yet. */
export const NEW_TABLE: TableState = { v: TABLE_STATE_V, scores: [0, 0, 0, 0], extra: {} };

/** The keys this code reads. Everything else goes in `extra`. */
const KNOWN: readonly string[] = ['v', 'scores'];

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
  const extra = Object.fromEntries(Object.entries(doc).filter(([key]) => !KNOWN.includes(key)));
  const v = doc['v'];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) return { table: { v: TABLE_STATE_V, scores: null, extra }, legacy: true };
  return { table: { v, scores: scores4(doc['scores']) ?? [0, 0, 0, 0], extra }, legacy: false };
}

/** The document to store: written as this code's version, with the keys it doesn't know put back as they were. */
export function tableStateJson(t: TableState): Record<string, unknown> {
  return { ...t.extra, v: TABLE_STATE_V, scores: [...(t.scores ?? [0, 0, 0, 0])] };
}

/** JSON values compared by what they hold, whatever order an object's keys are in. */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && sameJson(a[k], b[k]));
}

/** Whether two documents would store the same thing, so a step that changes neither the hand nor this writes nothing. */
export function sameTableState(a: TableState, b: TableState): boolean {
  return a.v === b.v && sameJson(a.scores, b.scores) && sameJson(a.extra, b.extra);
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
 * the server has to act on this table unasked. For now that's the earlier of
 * its two clocks, or null when nothing is waiting on anyone. (`table` and
 * `actedAt` are for what's still to come here: no wake once the game is
 * over, and the hour a table nobody plays ends by itself.)
 */
export function wakeAt(x: { readonly deadlines: Deadlines; readonly table: TableState; readonly actedAt: number }): number | null {
  const clocks = [x.deadlines.claim, x.deadlines.turn].filter((t): t is number => t !== null);
  return clocks.length === 0 ? null : Math.min(...clocks);
}
