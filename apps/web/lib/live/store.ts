import 'server-only';
import type { HandState, RulesetId, Seat } from '@society/engine';
import type { CoachStage } from '@/lib/coach';
// Relative rather than '@/': vitest runs without the path alias, and the tests load this.
import { createServiceClient } from '../supabase/service';
import { HttpError, must } from './errors';
import { commitArgs, type TableWrite } from './hand-log';
import { stageFromStats, tallyHand, type ProfileStats } from './stage';
import { parseTableState, type TableState } from './table-state';
import type { Deadlines, RoomStatus, Seats } from './types';
import { logError } from './log';
import { cleanDisplayName, isUuid } from './validate';

export type { RoomStatus } from './types';

export interface RoomRow {
  readonly id: string;
  readonly code: string;
  readonly host_id: string;
  readonly ruleset_id: RulesetId;
  readonly options: Record<string, unknown>;
  readonly status: RoomStatus;
  readonly seats: Seats;
  readonly current_game_id: string | null;
  /**
   * running totals per seat, as code before table_state kept them. Nothing writes it now but startGame's reset; it's read
   * only to seed a legacy table's scores (table-state.ts withLegacyScores)
   */
  readonly ledger: readonly number[];
  /** the row's last write, as the database formats it; a seat write compares against it so a lost race is not a lost seat */
  readonly updated_at: string;
}

export interface GameRow {
  readonly id: string;
  readonly room_id: string;
  readonly seed: string;
  readonly status: 'active' | 'finished' | 'abandoned';
  readonly hands_played: number;
}

export interface LiveRow {
  readonly version: number;
  readonly state: HandState;
  readonly deadlines: Deadlines;
  /** live_state.table_state, parsed */
  readonly table: TableState;
  /** the table has no "v" yet: it was last saved by code before table_state, so its scores are still in rooms.ledger (R13) and its last activity is in updated_at too (R23) */
  readonly legacy: boolean;
  /** live_state.wake_at: when the server next has to act on the table unasked */
  readonly wakeAt: number | null;
  /** live_state.acted_at: when a person last moved the table */
  readonly actedAt: number;
  /** live_state.updated_at: the last save of any kind */
  readonly updatedAt: number;
}

const db = () => createServiceClient();
const ROOM_COLUMNS = 'id, code, host_id, ruleset_id, options, status, seats, current_game_id, ledger, updated_at';

function toIso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}
/** A time as the database formats it, in epoch ms; null for none, or for anything that isn't a time. */
function fromIso(s: unknown): number | null {
  if (typeof s !== 'string') return null;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : ms;
}

/** The room with this code, or null when there is none. A read that fails throws: a blip is not "no room with that code". */
export async function roomByCode(code: string): Promise<RoomRow | null> {
  const data = must(await db().from('rooms').select(ROOM_COLUMNS).eq('code', code.toUpperCase()).maybeSingle(), 'read the room');
  return (data as RoomRow | null) ?? null;
}

export async function roomById(id: string): Promise<RoomRow | null> {
  const data = must(await db().from('rooms').select(ROOM_COLUMNS).eq('id', id).maybeSingle(), 'read the room');
  return (data as RoomRow | null) ?? null;
}

export async function createRoom(input: { code: string; hostId: string; hostName: string; rulesetId: RulesetId; options: Record<string, unknown> }): Promise<RoomRow> {
  // The host's name is capped where it enters the room, whoever the caller is.
  const seats: Seats = [{ kind: 'human', userId: input.hostId, name: cleanDisplayName(input.hostName) ?? 'Guest' }, null, null, null];
  const data = must(
    await db().from('rooms').insert({ code: input.code, host_id: input.hostId, ruleset_id: input.rulesetId, options: input.options, seats }).select(ROOM_COLUMNS).single(),
    'create the room',
  );
  return data as RoomRow;
}

/**
 * Write the seats only if the room is still as the caller read it. Returns
 * the row's new `updated_at`, or null when someone else wrote first: the
 * caller reloads and picks again rather than sitting two people in one seat.
 */
export async function saveSeats(roomId: string, seats: Seats, expectedUpdatedAt: string): Promise<string | null> {
  const data = must(
    await db().from('rooms').update({ seats, updated_at: new Date().toISOString() }).eq('id', roomId).eq('updated_at', expectedUpdatedAt).select('updated_at'),
    'save the seats',
  );
  return data?.length === 1 ? (data[0] as { updated_at: string }).updated_at : null;
}

/** The game with this id, or null when there is none. An id that is not a uuid finds nothing without asking. A read that fails throws. */
export async function gameById(id: string): Promise<GameRow | null> {
  if (!isUuid(id)) return null;
  const data = must(await db().from('games').select('id, room_id, seed, status, hands_played').eq('id', id).maybeSingle(), 'read the game');
  return (data as GameRow | null) ?? null;
}

/** Creates the game and its first live state, and points the room at it. */
export async function startGame(room: RoomRow, seed: string, seats: Seats, state: HandState, deadlines: Deadlines): Promise<GameRow> {
  const client = db();
  const g = must(await client.from('games').insert({ room_id: room.id, seed }).select('id, room_id, seed, status, hands_played').single(), 'create the game') as GameRow;
  must(
    await client.from('live_state').insert({ game_id: g.id, version: 1, state, claim_deadline: toIso(deadlines.claim), turn_deadline: toIso(deadlines.turn) }),
    'deal the first hand',
  );
  must(await client.from('hands').insert({ game_id: g.id, hand_index: state.progress.handIndex, dealer: state.dealer, progress: state.progress }), 'open the first hand');
  const rows = must(
    await client
      .from('rooms')
      .update({ status: 'playing', current_game_id: g.id, seats, ledger: [0, 0, 0, 0], updated_at: new Date().toISOString() })
      .eq('id', room.id)
      .eq('updated_at', room.updated_at)
      .select('id'),
    'point the room at the game',
  );
  if (rows?.length !== 1) {
    // The seats moved after the host read them (someone sat down or stood up); dealing now could hand a seat to a bot. Drop the game and ask again.
    must(await client.from('games').delete().eq('id', g.id), 'drop the unstarted game');
    throw new HttpError(409, 'the seats changed; start again');
  }
  return g;
}

/** The live table, with its bookkeeping parsed (table-state.ts), or null when the game has none. */
export async function loadLive(gameId: string): Promise<LiveRow | null> {
  const data = must(
    await db().from('live_state').select('version, state, claim_deadline, turn_deadline, table_state, wake_at, acted_at, updated_at').eq('game_id', gameId).maybeSingle(),
    'read the table',
  );
  if (!data) return null;
  const row = data as {
    version: number;
    state: HandState;
    claim_deadline: string | null;
    turn_deadline: string | null;
    table_state: unknown;
    wake_at: string | null;
    acted_at: string;
    updated_at: string;
  };
  const { table, legacy } = parseTableState(row.table_state);
  const updatedAt = fromIso(row.updated_at) ?? 0;
  return {
    version: row.version,
    state: row.state,
    deadlines: { claim: fromIso(row.claim_deadline), turn: fromIso(row.turn_deadline) },
    table,
    legacy,
    wakeAt: fromIso(row.wake_at),
    actedAt: fromIso(row.acted_at) ?? updatedAt,
    updatedAt,
  };
}

/**
 * One request against the table, as one transaction (commit_table): the new
 * state, the table's bookkeeping, its clocks and wake time, and every move
 * the request made, appended to its hand's log with the hand's result once it
 * has ended. All of it or none of it. Returns the new version, or null when
 * someone else saved first, in which case nothing was written and the caller
 * reads again. A failure throws, and nothing was written then either. This is
 * the only write to a live table after the deal.
 */
export async function commitTable(gameId: string, expectedVersion: number, w: TableWrite): Promise<number | null> {
  const data = must(await db().rpc('commit_table', commitArgs(gameId, expectedVersion, w)), 'save the table');
  return typeof data === 'number' ? data : null;
}

/*
 * When a hand ends, its result, its settlement and the running totals are
 * already saved, by the commit that ended it. Two writes follow, each run by
 * actOnGame as its own step after that commit: countHand, then recordHand.
 * The first throws if it fails; the players' tallies are best-effort. One
 * that fails does not stop the other.
 */

/** Add one to the game's count of hands played. Atomic on the database side. */
export async function countHand(gameId: string): Promise<void> {
  must(await db().rpc('bump_hands_played', { p_game_id: gameId }), 'count the hand');
}

/**
 * Count the hand on each human's profile and move their stage with it, so a
 * table's clocks quicken as it learns. Read-modify-write: the one way to
 * lose a count is the same person finishing two hands at once, which a
 * timer can bear.
 */
export async function recordHand(seats: Seats, state: HandState): Promise<void> {
  const winner: Seat | null = state.result?.type === 'win' ? state.result.winner : null;
  const humans = seats.flatMap((s, i) => (s?.kind === 'human' ? [{ id: s.userId, won: i === winner }] : []));
  if (humans.length === 0) return;
  const client = db();
  const ids = humans.map((h) => h.id);
  const { data, error } = await client.from('profiles').select('id, stats').in('id', ids);
  // The hand is already settled, so a failed tally is logged, not thrown: the clocks just stay where they were.
  if (error) {
    console.error('recordHand: could not read profiles', error.message);
    return;
  }
  await Promise.all(
    (data ?? []).map(async (row) => {
      const { id, stats } = row as { id: string; stats: ProfileStats | null };
      const won = humans.some((h) => h.id === id && h.won);
      const next = tallyHand(stats ?? {}, won);
      const { error: e } = await client
        .from('profiles')
        .update({ stats: next, onboarding_stage: stageFromStats(next) })
        .eq('id', id);
      if (e) console.error('recordHand: could not write profile', id, e.message);
    }),
  );
}

/**
 * The last hand is over. Two writes, ordered so that either can fail and be
 * run again: the room first, so the lobby offers "Play again"; the game's own
 * status last. Until that last write lands the game is still active, so the
 * next "next hand" runs both again. The commit that ended the game has
 * already stopped its clocks, and the sweep only looks at active games.
 */
export async function finishGame(gameId: string, roomId: string): Promise<void> {
  const client = db();
  const now = new Date().toISOString();
  await closeRoom(client, gameId, roomId, now);
  must(await client.from('games').update({ status: 'finished', finished_at: now, ended_at: now }).eq('id', gameId), 'finish the game');
}

/**
 * The last human stood up: the game ends without a result and the room
 * closes. The same order as finishGame, so a leave that fails part way
 * leaves the game active with the leaver still in their seat, and leaving
 * again finishes the job. Its clocks are left as they were: nothing reads a
 * game that isn't active.
 */
export async function abandonGame(gameId: string, roomId: string): Promise<void> {
  const client = db();
  const now = new Date().toISOString();
  await closeRoom(client, gameId, roomId, now);
  must(await client.from('games').update({ status: 'abandoned', ended_at: now }).eq('id', gameId), 'abandon the game');
}

/**
 * The room's game is over: it goes back to the lobby's "finished". Only while
 * the room still holds this game and is still playing it: one the host has
 * dealt again keeps its new game, and a repeat finish writes nothing, so it
 * never moves `updated_at` under a host who is about to tap Start.
 */
async function closeRoom(client: ReturnType<typeof db>, gameId: string, roomId: string, now: string): Promise<void> {
  must(await client.from('rooms').update({ status: 'finished', updated_at: now }).eq('id', roomId).eq('current_game_id', gameId).eq('status', 'playing'), 'close the room');
}

/**
 * Active games whose deadline has passed and nobody has poked since. The
 * status filter matters: a finished or abandoned game keeps its live_state
 * row, and one left with a deadline would be swept, and fail, every day.
 */
export async function expiredGames(now: number, limit = 50): Promise<string[]> {
  const iso = new Date(now).toISOString();
  const data = must(
    await db().from('live_state').select('game_id, games!inner(status)').eq('games.status', 'active').or(`claim_deadline.lte.${iso},turn_deadline.lte.${iso}`).limit(limit),
    'find tables past their clocks',
  );
  return (data ?? []).map((r) => (r as { game_id: string }).game_id);
}

/**
 * Each seat's player level, from what their profile has recorded: in seat
 * order, null for a bot or an empty seat, and `new` for a human with no
 * profile row yet. The levels size the clocks, pick how the filler bots play
 * and set each player's own tutor, so a failed read is logged rather than
 * failing the move, tick or deal it was for, and every human counts as new:
 * the table gets the most patient clocks and the gentlest bots, never ones
 * too quick for a first-timer. Rows come back in no particular order, so they
 * are matched to seats by id.
 */
export async function stagesBySeat(seats: Seats): Promise<(CoachStage | null)[]> {
  const ids = seats.flatMap((s) => (s?.kind === 'human' ? [s.userId] : []));
  if (ids.length === 0) return seats.map(() => null);
  let byId: Map<string, CoachStage>;
  try {
    const data = must(await db().from('profiles').select('id, stats').in('id', ids), 'read the player levels');
    byId = new Map(
      (data ?? []).map((r) => {
        const row = r as { id: string; stats: ProfileStats | null };
        return [row.id, stageFromStats(row.stats ?? {})] as const;
      }),
    );
  } catch (err) {
    logError('stages_read_failed', err);
    byId = new Map();
  }
  return seats.map((s) => (s?.kind === 'human' ? (byId.get(s.userId) ?? 'new') : null));
}

export type { Seat };
