import 'server-only';
import type { HandState, RulesetId, Seat } from '@society/engine';
import type { CoachStage } from '@/lib/coach';
import { createServiceClient } from '@/lib/supabase/service';
import { HttpError } from './errors';
import { stageFromStats, tallyHand, type ProfileStats } from './stage';
import type { Deadlines, RoomStatus, Seats } from './types';

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

export async function roomByCode(code: string): Promise<RoomRow | null> {
  const { data } = await db().from('rooms').select(ROOM_COLUMNS).eq('code', code.toUpperCase()).maybeSingle();
  return (data as RoomRow | null) ?? null;
}

export async function roomById(id: string): Promise<RoomRow | null> {
  const { data } = await db().from('rooms').select(ROOM_COLUMNS).eq('id', id).maybeSingle();
  return (data as RoomRow | null) ?? null;
}

export async function createRoom(input: { code: string; hostId: string; hostName: string; rulesetId: RulesetId; options: Record<string, unknown> }): Promise<RoomRow> {
  const seats: Seats = [{ kind: 'human', userId: input.hostId, name: input.hostName }, null, null, null];
  const { data, error } = await db()
    .from('rooms')
    .insert({ code: input.code, host_id: input.hostId, ruleset_id: input.rulesetId, options: input.options, seats })
    .select(ROOM_COLUMNS)
    .single();
  if (error) throw error;
  return data as RoomRow;
}

/**
 * Write the seats only if the room is still as the caller read it. Returns
 * the row's new `updated_at`, or null when someone else wrote first: the
 * caller reloads and picks again rather than sitting two people in one seat.
 */
export async function saveSeats(roomId: string, seats: Seats, expectedUpdatedAt: string): Promise<string | null> {
  const { data, error } = await db()
    .from('rooms')
    .update({ seats, updated_at: new Date().toISOString() })
    .eq('id', roomId)
    .eq('updated_at', expectedUpdatedAt)
    .select('updated_at');
  if (error) throw error;
  return data?.length === 1 ? (data[0] as { updated_at: string }).updated_at : null;
}

export async function gameById(id: string): Promise<GameRow | null> {
  const { data } = await db().from('games').select('id, room_id, seed, status, hands_played').eq('id', id).maybeSingle();
  return (data as GameRow | null) ?? null;
}

/** Creates the game and its first live state, and points the room at it. */
export async function startGame(room: RoomRow, seed: string, seats: Seats, state: HandState, deadlines: Deadlines): Promise<GameRow> {
  const client = db();
  const { data: game, error } = await client.from('games').insert({ room_id: room.id, seed }).select('id, room_id, seed, status, hands_played').single();
  if (error) throw error;
  const g = game as GameRow;
  const { error: e2 } = await client.from('live_state').insert({ game_id: g.id, version: 1, state, claim_deadline: toIso(deadlines.claim), turn_deadline: toIso(deadlines.turn) });
  if (e2) throw e2;
  const { error: e3 } = await client.from('hands').insert({ game_id: g.id, hand_index: state.progress.handIndex, dealer: state.dealer, progress: state.progress });
  if (e3) throw e3;
  const { data: rows, error: e4 } = await client
    .from('rooms')
    .update({ status: 'playing', current_game_id: g.id, seats, ledger: [0, 0, 0, 0], updated_at: new Date().toISOString() })
    .eq('id', room.id)
    .eq('updated_at', room.updated_at)
    .select('id');
  if (e4) throw e4;
  if (rows?.length !== 1) {
    // Someone sat down after the host read the seats; dealing now would hand their seat to a bot. Drop the game and ask again.
    await client.from('games').delete().eq('id', g.id);
    throw new HttpError(409, 'someone just sat down; start again');
  }
  return g;
}

export async function loadLive(gameId: string): Promise<LiveRow | null> {
  const { data } = await db().from('live_state').select('version, state, claim_deadline, turn_deadline').eq('game_id', gameId).maybeSingle();
  if (!data) return null;
  const row = data as { version: number; state: HandState; claim_deadline: string | null; turn_deadline: string | null };
  return { version: row.version, state: row.state, deadlines: { claim: fromIso(row.claim_deadline), turn: fromIso(row.turn_deadline) } };
}

/**
 * Write the next version only if nobody else has since we read. Returns false
 * on a lost race, in which case the caller reloads and retries or 409s.
 */
export async function saveLive(gameId: string, expectedVersion: number, state: HandState, deadlines: Deadlines): Promise<boolean> {
  const { data, error } = await db()
    .from('live_state')
    .update({ version: expectedVersion + 1, state, claim_deadline: toIso(deadlines.claim), turn_deadline: toIso(deadlines.turn), updated_at: new Date().toISOString() })
    .eq('game_id', gameId)
    .eq('version', expectedVersion)
    .select('version');
  if (error) throw error;
  return (data?.length ?? 0) === 1;
}

/** Append one player action to the hand's log. Atomic on the database side. */
export async function appendAction(gameId: string, handIndex: number, action: unknown): Promise<void> {
  const { error } = await db().rpc('append_hand_action', { p_game_id: gameId, p_hand_index: handIndex, p_action: action });
  if (error) throw error;
}

export async function openHand(gameId: string, state: HandState): Promise<void> {
  const { error } = await db()
    .from('hands')
    .upsert(
      { game_id: gameId, hand_index: state.progress.handIndex, dealer: state.dealer, progress: state.progress },
      { onConflict: 'game_id,hand_index', ignoreDuplicates: true },
    );
  if (error) throw error;
}

/** Close the hand's row, record the result, and settle the room's ledger. Returns the settled ledger. */
export async function closeHand(gameId: string, room: RoomRow, state: HandState): Promise<readonly number[]> {
  const result = state.result;
  const client = db();
  const ledger = [...(room.ledger.length === 4 ? room.ledger : [0, 0, 0, 0])];
  if (result?.type === 'win') {
    for (const t of result.settlement.transfers) {
      ledger[t.from]! -= t.amount;
      ledger[t.to]! += t.amount;
    }
    await client.from('rooms').update({ ledger, updated_at: new Date().toISOString() }).eq('id', room.id);
  }
  const { error } = await client
    .from('hands')
    .update({ result, settlement: result?.type === 'win' ? result.settlement : null, ended_at: new Date().toISOString() })
    .eq('game_id', gameId)
    .eq('hand_index', state.progress.handIndex);
  if (error) throw error;
  if (result?.type === 'win') {
    await client
      .from('hand_results')
      .insert({ game_id: gameId, hand_index: state.progress.handIndex, winner: result.winner, pattern_id: result.patternId, settlement: result.settlement });
  } else {
    await client.from('hand_results').insert({ game_id: gameId, hand_index: state.progress.handIndex, winner: null, pattern_id: null, settlement: {} });
  }
  await client.rpc('bump_hands_played', { p_game_id: gameId });
  await recordHand(client, room.seats, result?.type === 'win' ? result.winner : null);
  return ledger;
}

/**
 * Count the hand on each human's profile and move their stage with it, so a
 * table's clocks quicken as it learns. Read-modify-write: the one way to
 * lose a count is the same person finishing two hands at once, which a
 * timer can bear.
 */
async function recordHand(client: ReturnType<typeof db>, seats: Seats, winner: Seat | null): Promise<void> {
  const humans = seats.flatMap((s, i) => (s?.kind === 'human' ? [{ id: s.userId, won: i === winner }] : []));
  if (humans.length === 0) return;
  const ids = humans.map((h) => h.id);
  const { data } = await client.from('profiles').select('id, stats').in('id', ids);
  await Promise.all(
    (data ?? []).map((row) => {
      const { id, stats } = row as { id: string; stats: ProfileStats | null };
      const won = humans.some((h) => h.id === id && h.won);
      const next = tallyHand(stats ?? {}, won);
      return client
        .from('profiles')
        .update({ stats: next, onboarding_stage: stageFromStats(next) })
        .eq('id', id);
    }),
  );
}

export async function finishGame(gameId: string, roomId: string): Promise<void> {
  const client = db();
  await client.from('games').update({ status: 'finished', finished_at: new Date().toISOString(), ended_at: new Date().toISOString() }).eq('id', gameId);
  await client.from('rooms').update({ status: 'finished', updated_at: new Date().toISOString() }).eq('id', roomId);
  await clearDeadlines(client, gameId);
}

/** The last human stood up: the game ends without a result and the room closes. */
export async function abandonGame(gameId: string, roomId: string): Promise<void> {
  const client = db();
  await client.from('games').update({ status: 'abandoned', ended_at: new Date().toISOString() }).eq('id', gameId);
  await client.from('rooms').update({ status: 'finished', updated_at: new Date().toISOString() }).eq('id', roomId);
  await clearDeadlines(client, gameId);
}

/** A game that is over waits on nobody: clear its clocks so the sweep has no reason to look at it. */
async function clearDeadlines(client: ReturnType<typeof db>, gameId: string): Promise<void> {
  await client.from('live_state').update({ claim_deadline: null, turn_deadline: null, updated_at: new Date().toISOString() }).eq('game_id', gameId);
}

/**
 * Active games whose deadline has passed and nobody has poked since. The
 * status filter matters: a finished or abandoned game keeps its live_state
 * row, and one left with a deadline would be swept, and fail, every day.
 */
export async function expiredGames(now: number, limit = 50): Promise<string[]> {
  const iso = new Date(now).toISOString();
  const { data } = await db()
    .from('live_state')
    .select('game_id, games!inner(status)')
    .eq('games.status', 'active')
    .or(`claim_deadline.lte.${iso},turn_deadline.lte.${iso}`)
    .limit(limit);
  return (data ?? []).map((r) => (r as { game_id: string }).game_id);
}

/** Player levels for the humans at the table, to size the timers: from what their profiles have recorded. */
export async function stagesFor(seats: Seats): Promise<CoachStage[]> {
  const ids = seats.flatMap((s) => (s?.kind === 'human' ? [s.userId] : []));
  if (ids.length === 0) return [];
  const { data } = await db().from('profiles').select('stats').in('id', ids);
  return (data ?? []).map((r) => stageFromStats((r as { stats: ProfileStats | null }).stats ?? {}));
}

export type { Seat };
