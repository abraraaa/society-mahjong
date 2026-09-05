import 'server-only';
import type { HandState, RulesetId, Seat } from '@society/engine';
import { createServiceClient } from '@/lib/supabase/service';
import type { Deadlines, Seats } from './types';

export type RoomStatus = 'lobby' | 'playing' | 'finished';

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

function toIso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}
function fromIso(s: string | null): number | null {
  return s === null ? null : Date.parse(s);
}

export async function roomByCode(code: string): Promise<RoomRow | null> {
  const { data } = await db().from('rooms').select('id, code, host_id, ruleset_id, options, status, seats, current_game_id, ledger').eq('code', code.toUpperCase()).maybeSingle();
  return (data as RoomRow | null) ?? null;
}

export async function roomById(id: string): Promise<RoomRow | null> {
  const { data } = await db().from('rooms').select('id, code, host_id, ruleset_id, options, status, seats, current_game_id, ledger').eq('id', id).maybeSingle();
  return (data as RoomRow | null) ?? null;
}

export async function createRoom(input: { code: string; hostId: string; hostName: string; rulesetId: RulesetId; options: Record<string, unknown> }): Promise<RoomRow> {
  const seats: Seats = [{ kind: 'human', userId: input.hostId, name: input.hostName }, null, null, null];
  const { data, error } = await db()
    .from('rooms')
    .insert({ code: input.code, host_id: input.hostId, ruleset_id: input.rulesetId, options: input.options, seats })
    .select('id, code, host_id, ruleset_id, options, status, seats, current_game_id, ledger')
    .single();
  if (error) throw error;
  return data as RoomRow;
}

export async function saveSeats(roomId: string, seats: Seats): Promise<void> {
  const { error } = await db().from('rooms').update({ seats, updated_at: new Date().toISOString() }).eq('id', roomId);
  if (error) throw error;
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
  const { error: e4 } = await client
    .from('rooms')
    .update({ status: 'playing', current_game_id: g.id, seats, ledger: [0, 0, 0, 0], updated_at: new Date().toISOString() })
    .eq('id', room.id);
  if (e4) throw e4;
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
  return ledger;
}

export async function finishGame(gameId: string, roomId: string): Promise<void> {
  const client = db();
  await client.from('games').update({ status: 'finished', finished_at: new Date().toISOString(), ended_at: new Date().toISOString() }).eq('id', gameId);
  await client.from('rooms').update({ status: 'finished', updated_at: new Date().toISOString() }).eq('id', roomId);
}

/** The last human stood up: the game ends without a result and the room closes. */
export async function abandonGame(gameId: string, roomId: string): Promise<void> {
  const client = db();
  await client.from('games').update({ status: 'abandoned', ended_at: new Date().toISOString() }).eq('id', gameId);
  await client.from('rooms').update({ status: 'finished', updated_at: new Date().toISOString() }).eq('id', roomId);
}

/** Games whose deadline has passed and nobody has poked since. */
export async function expiredGames(now: number, limit = 50): Promise<string[]> {
  const iso = new Date(now).toISOString();
  const { data } = await db().from('live_state').select('game_id').or(`claim_deadline.lte.${iso},turn_deadline.lte.${iso}`).limit(limit);
  return (data ?? []).map((r) => (r as { game_id: string }).game_id);
}

/** Onboarding stages for the humans at the table, to size the timers. */
export async function stagesFor(seats: Seats): Promise<string[]> {
  const ids = seats.flatMap((s) => (s?.kind === 'human' ? [s.userId] : []));
  if (ids.length === 0) return [];
  const { data } = await db().from('profiles').select('onboarding_stage').in('id', ids);
  return (data ?? []).map((r) => (r as { onboarding_stage: string }).onboarding_stage);
}

export type { Seat };
