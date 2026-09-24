import 'server-only';
import type { HandState, RulesetId, Seat } from '@society/engine';
import type { CoachStage } from '@/lib/coach';
// Relative rather than '@/': vitest runs without the path alias, and the tests load this.
import { createServiceClient } from '../supabase/service';
import { HttpError, must } from './errors';
import { stageFromStats, tallyHand, type ProfileStats } from './stage';
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
  /** running totals per seat for the current game */
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
}

const db = () => createServiceClient();
const ROOM_COLUMNS = 'id, code, host_id, ruleset_id, options, status, seats, current_game_id, ledger, updated_at';

function toIso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}
function fromIso(s: string | null): number | null {
  return s === null ? null : Date.parse(s);
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

export async function loadLive(gameId: string): Promise<LiveRow | null> {
  const data = must(await db().from('live_state').select('version, state, claim_deadline, turn_deadline').eq('game_id', gameId).maybeSingle(), 'read the table');
  if (!data) return null;
  const row = data as { version: number; state: HandState; claim_deadline: string | null; turn_deadline: string | null };
  return { version: row.version, state: row.state, deadlines: { claim: fromIso(row.claim_deadline), turn: fromIso(row.turn_deadline) } };
}

/**
 * Write the next version only if nobody else has since we read. Returns false
 * on a lost race, in which case the caller reloads and retries or 409s.
 */
export async function saveLive(gameId: string, expectedVersion: number, state: HandState, deadlines: Deadlines): Promise<boolean> {
  const data = must(
    await db()
      .from('live_state')
      .update({ version: expectedVersion + 1, state, claim_deadline: toIso(deadlines.claim), turn_deadline: toIso(deadlines.turn), updated_at: new Date().toISOString() })
      .eq('game_id', gameId)
      .eq('version', expectedVersion)
      .select('version'),
    'save the table',
  );
  return (data?.length ?? 0) === 1;
}

/** Append one player action to the hand's log. Atomic on the database side. */
export async function appendAction(gameId: string, handIndex: number, action: unknown): Promise<void> {
  must(await db().rpc('append_hand_action', { p_game_id: gameId, p_hand_index: handIndex, p_action: action }), 'log the move');
}

export async function openHand(gameId: string, state: HandState): Promise<void> {
  must(
    await db()
      .from('hands')
      .upsert(
        { game_id: gameId, hand_index: state.progress.handIndex, dealer: state.dealer, progress: state.progress },
        { onConflict: 'game_id,hand_index', ignoreDuplicates: true },
      ),
    'open the hand',
  );
}

/*
 * Closing a hand is five writes, and actOnGame runs each as its own step
 * after the move is saved, in this order: settleScores, endHand,
 * recordResult, countHand, recordHand. Each throws if it fails, except the
 * players' tallies, which are best-effort; and one that fails does not stop
 * the rest, so a blip costs that one write, not the hand's whole record.
 */

/**
 * Add a won hand's transfers to the room's running totals, and return the
 * totals as written. A washout moves no points and writes nothing. The
 * write lands only while the room still holds this game, so a room the host
 * has already dealt again keeps its new game's totals. Null means nothing
 * was written: the caller keeps the totals it had.
 */
export async function settleScores(gameId: string, room: RoomRow, state: HandState): Promise<readonly number[] | null> {
  const result = state.result;
  if (result?.type !== 'win') return null;
  const ledger = [...(room.ledger.length === 4 ? room.ledger : [0, 0, 0, 0])];
  for (const t of result.settlement.transfers) {
    ledger[t.from]! -= t.amount;
    ledger[t.to]! += t.amount;
  }
  const rows = must(
    await db().from('rooms').update({ ledger, updated_at: new Date().toISOString() }).eq('id', room.id).eq('current_game_id', gameId).select('id'),
    'settle the scores',
  );
  return rows?.length === 1 ? ledger : null;
}

/** Mark the hand's row as ended, with its result and settlement. */
export async function endHand(gameId: string, state: HandState): Promise<void> {
  const result = state.result;
  must(
    await db()
      .from('hands')
      .update({ result, settlement: result?.type === 'win' ? result.settlement : null, ended_at: new Date().toISOString() })
      .eq('game_id', gameId)
      .eq('hand_index', state.progress.handIndex),
    'close the hand',
  );
}

/** One row per hand in hand_results: the winner and pattern, or none for a washout. */
export async function recordResult(gameId: string, state: HandState): Promise<void> {
  const result = state.result;
  const hand = { game_id: gameId, hand_index: state.progress.handIndex };
  const row: Record<string, unknown> =
    result?.type === 'win'
      ? { ...hand, winner: result.winner, pattern_id: result.patternId, settlement: result.settlement }
      : { ...hand, winner: null, pattern_id: null, settlement: {} };
  must(await db().from('hand_results').insert(row), 'record the result');
}

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
 * The last hand is over. Three writes, ordered so that any one can fail and
 * be run again: the room first, so the lobby offers "Play again"; then the
 * clocks; the game's own status last. Until that last write lands the game
 * is still active, so the next "next hand" runs all three again. The room
 * is written only while it still holds this game: one the host has already
 * dealt again is left alone.
 */
export async function finishGame(gameId: string, roomId: string): Promise<void> {
  const client = db();
  const now = new Date().toISOString();
  await closeRoom(client, gameId, roomId, now);
  await clearDeadlines(client, gameId);
  must(await client.from('games').update({ status: 'finished', finished_at: now, ended_at: now }).eq('id', gameId), 'finish the game');
}

/**
 * The last human stood up: the game ends without a result and the room
 * closes. The same order as finishGame, so a leave that fails part way
 * leaves the game active with the leaver still in their seat, and leaving
 * again finishes the job.
 */
export async function abandonGame(gameId: string, roomId: string): Promise<void> {
  const client = db();
  const now = new Date().toISOString();
  await closeRoom(client, gameId, roomId, now);
  await clearDeadlines(client, gameId);
  must(await client.from('games').update({ status: 'abandoned', ended_at: now }).eq('id', gameId), 'abandon the game');
}

/** The room's game is over: it goes back to the lobby's "finished", unless it has already moved on to another game. */
async function closeRoom(client: ReturnType<typeof db>, gameId: string, roomId: string, now: string): Promise<void> {
  must(await client.from('rooms').update({ status: 'finished', updated_at: now }).eq('id', roomId).eq('current_game_id', gameId), 'close the room');
}

/** A game that is over waits on nobody: clear its clocks so the sweep has no reason to look at it. */
async function clearDeadlines(client: ReturnType<typeof db>, gameId: string): Promise<void> {
  must(await client.from('live_state').update({ claim_deadline: null, turn_deadline: null, updated_at: new Date().toISOString() }).eq('game_id', gameId), 'stop the clocks');
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
 * Player levels for the humans at the table, to size the timers: from what
 * their profiles have recorded. The levels only size the clocks, so a failed
 * read is logged rather than failing the move, tick or deal it was for, and
 * everyone counts as new: the table gets the most patient clocks, never ones
 * too quick for a first-timer. (No levels at all would mean the quickest.)
 */
export async function stagesFor(seats: Seats): Promise<CoachStage[]> {
  const ids = seats.flatMap((s) => (s?.kind === 'human' ? [s.userId] : []));
  if (ids.length === 0) return [];
  let data;
  try {
    data = must(await db().from('profiles').select('stats').in('id', ids), 'read the player levels');
  } catch (err) {
    logError('stages_read_failed', err);
    return ids.map(() => 'new');
  }
  return (data ?? []).map((r) => stageFromStats((r as { stats: ProfileStats | null }).stats ?? {}));
}

export type { Seat };
