import { reduce, startHand, type GameProgress, type HandResult, type HandState, type Ruleset, type Seat } from '@society/engine';
import { tableStateJson, type TableState } from './table-state';
import { isPlayerMove, type AwayReason, type Deadlines, type GameEndHow, type LoggedMove, type Move, type MoveMaker, type PlayerMove, type TableNote } from './types';
import { parseClientAction, parseSeat } from './validate';

/**
 * The hand log's own rules: pure, no database.
 *
 * Every move the table makes (a player's, a bot's, a stand-in's when a clock
 * ran out, the table's own passes) comes out of `step()` in `moves`, in order.
 * Stamped with the version their request produces (`stamp`) and appended to
 * the hand's row in `hands.actions` (`handWrites` says which row), they make
 * the hand's seed plus its log the hand: `replayHand` plays the log from the
 * deal and gets the same table, move for move, whoever or whatever made each.
 *
 * One request's moves are saved by the same commit_table call as its state
 * (`commitArgs` builds that call's arguments), so the log is never missing a
 * move that counted, and each game's commits land in version order.
 */

/** One hand's row, as one request writes it: the hand's identity, the moves this request made on it, and its result once it has ended. */
export interface HandWrite {
  readonly hand: number;
  readonly dealer: Seat;
  readonly progress: GameProgress;
  readonly moves: readonly LoggedMove[];
  readonly result: HandResult | null;
  readonly ended: boolean;
}

/** The moves one request made, each stamped with the live_state version that request produced. */
export function stamp(moves: readonly Move[], v: number): LoggedMove[] {
  return moves.map((m) => ({ ...m, v }));
}

/**
 * One request's hand rows: the new hand it dealt (with its bots' first moves),
 * or the hand it moved (with its result once it ended); [] when it logged
 * nothing and ended nothing. Every move a step makes belongs to the hand it
 * returns (table.ts `step`), so there's never more than one row.
 */
export function handWrites(before: HandState, after: HandState, moves: readonly LoggedMove[]): HandWrite[] {
  const dealt = after.progress.handIndex !== before.progress.handIndex;
  const ended = after.phase === 'finished';
  const endedHere = ended && (dealt || before.phase !== 'finished');
  if (!dealt && !endedHere && moves.length === 0) return [];
  return [{ hand: after.progress.handIndex, dealer: after.dealer, progress: after.progress, moves: [...moves], result: ended ? after.result : null, ended }];
}

/**
 * commit_table's `p_hands`: one entry per hand row, with exactly the keys the
 * function reads (migration 0005): `hand`, `dealer`, `progress`, `moves`,
 * `result`, `settlement` and `ended`. `settlement` is the win's, and null for
 * a washout or a hand still being played. The row's index, dealer and
 * progress can't be null, so a renamed key here would fail every move.
 */
export function commitHands(hands: readonly HandWrite[]): unknown[] {
  return hands.map((h) => ({
    hand: h.hand,
    dealer: h.dealer,
    progress: h.progress,
    moves: h.moves,
    result: h.result,
    settlement: h.result?.type === 'win' ? h.result.settlement : null,
    ended: h.ended,
  }));
}

/** One request's write to a live table: the new hand state, the table's bookkeeping, its clocks and wake time, whether a person moved it, and its hand rows. */
export interface TableWrite {
  readonly state: HandState;
  readonly table: TableState;
  readonly deadlines: Deadlines;
  readonly wakeAt: number | null;
  readonly acted: boolean;
  readonly hands: readonly HandWrite[];
}

function iso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}

/**
 * commit_table's arguments, exactly its nine `p_*` keys: the times as ISO
 * strings or null, the table state as `tableStateJson` writes it, and the hand
 * rows as `commitHands` gives them. The store sends this and nothing else, so
 * a test can build the very argument without a database.
 */
export function commitArgs(
  gameId: string,
  expectedVersion: number,
  w: TableWrite,
): Record<'p_game_id' | 'p_expected' | 'p_state' | 'p_table_state' | 'p_claim_deadline' | 'p_turn_deadline' | 'p_wake_at' | 'p_acted' | 'p_hands', unknown> {
  return {
    p_game_id: gameId,
    p_expected: expectedVersion,
    p_state: w.state,
    p_table_state: tableStateJson(w.table),
    p_claim_deadline: iso(w.deadlines.claim),
    p_turn_deadline: iso(w.deadlines.turn),
    p_wake_at: iso(w.wakeAt),
    p_acted: w.acted,
    p_hands: commitHands(w.hands),
  };
}

const MOVE_MAKERS: readonly MoveMaker[] = ['player', 'bot', 'clock', 'away', 'table', 'host'];
const AWAY_REASONS: readonly AwayReason[] = ['clock', 'host', 'self'];
const END_HOWS: readonly GameEndHow[] = ['complete', 'host', 'idle', 'abandoned'];

function isRecord(x: unknown): x is Readonly<Record<string, unknown>> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** A table note, rebuilt from its known keys, or null. */
function parseNote(x: Readonly<Record<string, unknown>>): TableNote | null {
  if (x.type === 'back') return { type: 'back' };
  if (x.type === 'away') return (AWAY_REASONS as readonly unknown[]).includes(x.reason) ? { type: 'away', reason: x.reason as AwayReason } : null;
  if (x.type === 'endGame') return (END_HOWS as readonly unknown[]).includes(x.how) ? { type: 'endGame', how: x.how as GameEndHow } : null;
  return null;
}

/** An engine move, checked as strictly as a client's (validate.ts) and rebuilt from its known keys, or null. */
function parsePlayerMove(x: unknown): PlayerMove | null {
  const a = parseClientAction(x);
  return a === null || a.type === 'nextHand' ? null : a;
}

/**
 * One entry of `hands.actions`, or null when it isn't one this code can read.
 * Tolerant: it never throws, and it keeps only the keys it knows. An action
 * logged before the table logged every move (a bare engine action, with no
 * `v` or `by`) is null, which is why a hand begun then doesn't replay.
 */
export function parseLoggedMove(x: unknown): LoggedMove | null {
  if (!isRecord(x)) return null;
  const { v, by, seat, userId, a } = x;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return null;
  if (!(MOVE_MAKERS as readonly unknown[]).includes(by)) return null;
  const s = seat === undefined ? undefined : parseSeat(seat);
  if (s === null) return null;
  if (userId !== undefined && typeof userId !== 'string') return null;
  if (!isRecord(a)) return null;
  const move = parseNote(a) ?? parsePlayerMove(a);
  if (move === null) return null;
  return { v, by: by as MoveMaker, ...(s === undefined ? {} : { seat: s }), ...(userId === undefined ? {} : { userId }), a: move };
}

/**
 * Seed + start + log = the hand. Deals the hand exactly as the table did
 * (engine `startHand` is seeded by the game's seed and the hand's index),
 * then plays every engine move in the log in array order, skipping table
 * notes. Throws on a `v` that goes down, since the log is appended in version
 * order, and on an entry it can't read (a hand begun before every move was
 * logged). The engine throws on a move that isn't legal where it lands.
 */
export function replayHand(
  ruleset: Ruleset,
  seed: string,
  start: { readonly progress: GameProgress; readonly dealer: Seat; readonly dealerStreak?: number },
  log: readonly unknown[],
): HandState {
  let s = startHand(ruleset, { seed, progress: start.progress, dealer: start.dealer, dealerStreak: start.dealerStreak ?? 0 });
  let last = -1;
  log.forEach((entry, i) => {
    const m = parseLoggedMove(entry);
    if (m === null) throw new Error(`replay: entry ${i} of hand ${start.progress.handIndex} is not a logged move`);
    if (m.v < last) throw new Error(`replay: entry ${i} of hand ${start.progress.handIndex} goes back from version ${last} to ${m.v}`);
    last = m.v;
    if (isPlayerMove(m.a)) s = reduce(s, m.a, ruleset);
  });
  return s;
}

/**
 * How many hands in a row the dealer of `handIndex` had dealt just before it:
 * the run of immediately preceding hand rows with the same dealer. The engine
 * keeps a dealer only on a retained win (streak + 1) and otherwise moves the
 * dealer on and starts again at 0 (reducer.ts `nextHand`), so the run is the
 * streak, and it needn't be stored. 0 when `handIndex` has no row.
 */
export function dealerStreakAt(rows: readonly { readonly hand_index: number; readonly dealer: number }[], handIndex: number): number {
  const dealerOf = new Map(rows.map((r) => [r.hand_index, r.dealer]));
  const dealer = dealerOf.get(handIndex);
  if (dealer === undefined) return 0;
  let n = 0;
  while (dealerOf.get(handIndex - n - 1) === dealer) n++;
  return n;
}
