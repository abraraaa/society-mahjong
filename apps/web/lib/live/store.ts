import 'server-only';
import type { HandState, RulesetId, Seat } from '@society/engine';
import type { CoachStage } from '@/lib/coach';
// Relative rather than '@/': vitest runs without the path alias, and the tests load this.
import { createServiceClient } from '../supabase/service';
import { HttpError, must, SupabaseError, type SupabaseFailure } from './errors';
import { finalPlayers, type LastGameRow } from './final';
import { commitArgs, type TableWrite } from './hand-log';
import { presentAtEnd } from './lifecycle';
import { SEAT_ATTEMPTS, SEEN_REFRESH_MS, seatsBack } from './seating';
import { stageFromStats, tallyHand, type ProfileStats } from './stage';
import { NEW_TABLE, parseTableState, tableStateJson, wakeAt, type Absence, type GameOver, type TableState } from './table-state';
import type { Deadlines, GameEndHow, LiveGame, LoggedMove, RoomStatus, SeatEntry, Seats } from './types';
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
   * running totals per seat, as code before table_state kept them. Nothing writes it now; it's read only to seed a legacy
   * table's scores (table-state.ts withLegacyScores)
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
  // The host's name is capped where it enters the room, whoever the caller is; `since` says they've sat there from the start.
  const now = Date.now();
  const seats: Seats = [{ kind: 'human', userId: input.hostId, name: cleanDisplayName(input.hostName) ?? 'Guest', since: new Date(now).toISOString() }, null, null, null];
  const data = must(
    await db().from('rooms').insert({ code: input.code, host_id: input.hostId, ruleset_id: input.rulesetId, options: input.options, seats }).select(ROOM_COLUMNS).single(),
    'create the room',
  );
  const room = data as RoomRow;
  // The host is the room's first member, and here from the start. Best-effort: the lobby's poll checks them in otherwise.
  await touchMember(room.id, input.hostId, now);
  return room;
}

/**
 * Someone has been at the room just now (R17): they opened the invite link,
 * sat down, started a game, or have had the lobby open a while. Their member
 * row's `last_seen_at` moves to `at`, and a first visit makes the row. The
 * upsert sends exactly these three columns, so an existing row keeps its
 * `first_seen_at` and `games_played` (PostgREST updates only what's sent).
 * Never writes `rooms`, so it can't move `updated_at` under a host tapping
 * Start. Best-effort: a failure is logged as member_touch_failed and gives
 * false, and the lobby's next poll tries again; true when it wrote.
 *
 * A person with no profile row can never be checked in (room_members.user_id
 * references profiles). That's logged once as profile_missing, and this
 * server doesn't try that person again for SEEN_REFRESH_MS, so a lobby left
 * open doesn't write, fail and log every five seconds.
 */
export async function touchMember(roomId: string, userId: string, at: number): Promise<boolean> {
  if ((noProfile.get(userId) ?? Number.NEGATIVE_INFINITY) > at) return false;
  try {
    const res = await db()
      .from('room_members')
      .upsert({ room_id: roomId, user_id: userId, last_seen_at: new Date(at).toISOString() }, { onConflict: 'room_id,user_id' });
    if (res.error?.code === NO_SUCH_ROW) {
      if (noProfile.size >= NO_PROFILE_KEPT) noProfile.clear();
      noProfile.set(userId, at + SEEN_REFRESH_MS);
      logError('profile_missing', new SupabaseError('check in at the room', res.error), { roomId });
      return false;
    }
    must(res, 'check in at the room');
    return true;
  } catch (err) {
    logError('member_touch_failed', err, { roomId });
    return false;
  }
}

/** People whose check-in found no profile row, and until when this server leaves them be (touchMember). Kept small: it's only ever a handful. */
const noProfile = new Map<string, number>();
const NO_PROFILE_KEPT = 500;

/** Everyone who has sat at the room, and when each was last seen there (room_members). A failed read throws. */
export async function roomMembers(roomId: string): Promise<{ userId: string; lastSeenAt: number }[]> {
  const data = must(await db().from('room_members').select('user_id, last_seen_at').eq('room_id', roomId), 'read who has sat here');
  return ((data ?? []) as { user_id: string; last_seen_at: string }[]).flatMap((r) => {
    const at = fromIso(r.last_seen_at);
    return at === null ? [] : [{ userId: r.user_id, lastSeenAt: at }];
  });
}

/** What the lobby reads of a game: when and how it ended, and who finished where. */
const LAST_GAME_COLUMNS = 'status, ended_at, ended_how, hands_played, game_players(seat, user_id, kind, name, score, place)';
const GAME_END_HOWS: readonly GameEndHow[] = ['complete', 'host', 'idle', 'abandoned'];

function lastGameRow(data: unknown): LastGameRow | null {
  if (!data) return null;
  const row = data as { status: LastGameRow['status']; ended_at: string | null; ended_how: string | null; hands_played: number | null; game_players: unknown };
  const players = Array.isArray(row.game_players)
    ? (row.game_players as { seat: number; user_id: string | null; kind: string; name: string; score: number | null; place: number | null }[])
    : [];
  return {
    status: row.status,
    endedAt: fromIso(row.ended_at),
    how: GAME_END_HOWS.includes(row.ended_how as GameEndHow) ? (row.ended_how as GameEndHow) : null,
    hands: typeof row.hands_played === 'number' ? row.hands_played : 0,
    players: players.map((p) => ({ seat: p.seat, userId: p.user_id ?? null, kind: p.kind, name: p.name, score: p.score ?? null, place: p.place ?? null })),
  };
}

/** A game as the lobby reads it (LastGameRow), or null when there's no such game. A failed read throws. */
export async function lastGameOf(gameId: string): Promise<LastGameRow | null> {
  if (!isUuid(gameId)) return null;
  return lastGameRow(must(await db().from('games').select(LAST_GAME_COLUMNS).eq('id', gameId).maybeSingle(), 'read the last game'));
}

/**
 * The room's latest finished game (LastGameRow), or null when it has none:
 * asked only when its current game didn't finish (an abandon), so the lobby's
 * "Last game" is still the last real result. games has no index on room_id,
 * so this scans it, which is fine at this size and this rarely.
 */
export async function lastFinishedGame(roomId: string): Promise<LastGameRow | null> {
  return lastGameRow(
    must(
      await db().from('games').select(LAST_GAME_COLUMNS).eq('room_id', roomId).eq('status', 'finished').order('ended_at', { ascending: false }).limit(1).maybeSingle(),
      'read the last game',
    ),
  );
}

/**
 * Each member's count of games played at the room (room_members.games_played),
 * worked out again from game_players: the finished games (complete, ended by
 * the host or idle; never abandoned) they sat at the end of. A recount rather
 * than an increment, so a finish run again counts nothing twice. Per person,
 * the database counts (one row asked for, the total in the answer's count)
 * and then their row is set, so the count never stops at the most rows the
 * API will return in one answer. A member row that doesn't exist isn't made.
 */
export async function recountMemberGames(roomId: string, userIds: readonly string[]): Promise<void> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return;
  const client = db();
  for (const userId of ids) {
    // A GET that asks for one row, not a HEAD, so a refusal comes back with the database's reason.
    const { count, error } = await client
      .from('game_players')
      .select('game_id, games!inner(room_id, status)', { count: 'exact' })
      .eq('user_id', userId)
      .eq('games.room_id', roomId)
      .eq('games.status', 'finished')
      .limit(1);
    must({ data: null, error }, 'count the games played');
    must(await client.from('room_members').update({ games_played: count ?? 0 }).eq('room_id', roomId).eq('user_id', userId), 'count the games played');
  }
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

/** Postgres's code for a foreign key that points at nothing: here, a person with no profile row. */
const NO_SUCH_ROW = '23503';

/**
 * Deal a new game, in an order that can't leave half a table:
 *   1. the game's own row;
 *   2. its first hand, with the moves the bots made at the deal (stamped
 *      version 1, the live table's first), so a live table never exists
 *      without its hand;
 *   3. who sat where (game_players, one row per seat as dealt);
 *   4. the live table, with fresh bookkeeping (nobody has any points) and its
 *      wake time; acted_at is the database's now, since the host just acted;
 *   5. the room, pointed at the game, only if its seats are as the host read
 *      them.
 * Any failure after the first step deletes the game, and its hand, players
 * and live table go with it, so the room is never pointed at a game that
 * isn't all there. The error thrown is always the one that stopped the deal:
 * a delete that fails as well is logged as drop_game_failed and nothing more.
 */
export async function startGame(room: RoomRow, seed: string, seats: Seats, first: LiveGame & { readonly moves: readonly LoggedMove[] }): Promise<GameRow> {
  const client = db();
  const g = must(await client.from('games').insert({ room_id: room.id, seed }).select('id, room_id, seed, status, hands_played').single(), 'create the game') as GameRow;
  try {
    const { state, deadlines } = first;
    must(
      await client.from('hands').insert({ game_id: g.id, hand_index: state.progress.handIndex, dealer: state.dealer, progress: state.progress, actions: first.moves }),
      'open the first hand',
    );
    await seatPlayers(client, g.id, seats);
    must(
      await client.from('live_state').insert({
        game_id: g.id,
        version: 1,
        state,
        table_state: tableStateJson(NEW_TABLE),
        claim_deadline: toIso(deadlines.claim),
        turn_deadline: toIso(deadlines.turn),
        wake_at: toIso(wakeAt({ deadlines, table: NEW_TABLE, actedAt: Date.now() })),
      }),
      'deal the first hand',
    );
    const rows = must(
      await client
        .from('rooms')
        .update({ status: 'playing', current_game_id: g.id, seats, updated_at: new Date().toISOString() })
        .eq('id', room.id)
        .eq('updated_at', room.updated_at)
        .select('id'),
      'point the room at the game',
    );
    // The seats moved after the host read them (someone sat down or stood up); dealing now could hand a seat to a bot. Drop the game and ask again.
    if (rows?.length !== 1) throw new HttpError(409, 'the seats changed; start again');
  } catch (err) {
    await dropGame(client, g.id);
    throw err;
  }
  return g;
}

/**
 * game_players at the deal: one row per seat, with the person's id on a
 * human's row (the start route has put a bot in every empty seat, so there
 * are four). Every signed-in person gets a profile row when they sign up,
 * but a seat whose person has none would refuse the whole insert, so on that
 * refusal it's logged as profile_missing and written once more without ids:
 * the rows still say who sat where, by name, and nobody is kept from playing.
 */
async function seatPlayers(client: ReturnType<typeof db>, gameId: string, seats: Seats): Promise<void> {
  const rows = seats.flatMap((s, seat) => (s === null ? [] : [{ game_id: gameId, seat, user_id: s.kind === 'human' ? s.userId : null, kind: s.kind, name: s.name }]));
  const res = await client.from('game_players').insert(rows);
  if (res.error?.code !== NO_SUCH_ROW) {
    must(res, 'seat the players');
    return;
  }
  logError('profile_missing', new SupabaseError('seat the players', res.error), { gameId });
  must(await client.from('game_players').insert(rows.map((r) => ({ ...r, user_id: null }))), 'seat the players');
}

/**
 * A seat changed hands at a game in play (someone left and a bot keeps it for
 * them, or someone took a bot's seat over): the game's record of who sits
 * where (game_players) follows, so it says who holds each seat now. Best-
 * effort: the seat has already changed, and the game's finish writes all four
 * rows again from who sat where at the end, so a failure is only logged, as
 * seat_follow_failed.
 */
export async function followSeat(gameId: string, seat: Seat, entry: SeatEntry): Promise<void> {
  if (entry === null) return;
  try {
    must(
      await db()
        .from('game_players')
        .update({ user_id: entry.kind === 'human' ? entry.userId : null, kind: entry.kind, name: entry.name })
        .eq('game_id', gameId)
        .eq('seat', seat),
      'follow the seat',
    );
  } catch (err) {
    logError('seat_follow_failed', err, { gameId, seat });
  }
}

/** Delete a game the deal gave up on. Best-effort: the caller is already throwing the error that matters, so a failure here is only logged. */
async function dropGame(client: ReturnType<typeof db>, gameId: string): Promise<void> {
  try {
    must(await client.from('games').delete().eq('id', gameId), 'drop the unstarted game');
  } catch (err) {
    logError('drop_game_failed', err, { gameId });
  }
}

/** What the room routes read of a live table: its bookkeeping and stamps, and where the hand stands, but never the hand itself. */
export interface LiveMeta {
  readonly version: number;
  readonly table: TableState;
  readonly legacy: boolean;
  readonly actedAt: number;
  readonly updatedAt: number;
  /** the hand being played (its index), and how far into it (the state's seq) */
  readonly hand: number;
  readonly seq: number;
}

/**
 * A live table's bookkeeping, for a room route that needs to know whether its
 * game is over, or idle, without loading every seat's tiles: the
 * state is the biggest column, so only two small paths into it are read.
 * Null when the game has no live table.
 */
export async function liveMeta(gameId: string): Promise<LiveMeta | null> {
  const data = must(
    await db().from('live_state').select('version, table_state, acted_at, updated_at, hand:state->progress->handIndex, seq:state->seq').eq('game_id', gameId).maybeSingle(),
    'read the table',
  );
  if (!data) return null;
  const row = data as { version: number; table_state: unknown; acted_at: string; updated_at: string; hand: unknown; seq: unknown };
  const { table, legacy } = parseTableState(row.table_state);
  const updatedAt = fromIso(row.updated_at) ?? 0;
  const whole = (n: unknown) => (typeof n === 'number' && Number.isInteger(n) ? n : 0);
  return { version: row.version, table, legacy, actedAt: fromIso(row.acted_at) ?? updatedAt, updatedAt, hand: whole(row.hand), seq: whole(row.seq) };
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
 * table's clocks quicken as it learns. A seat flagged in `away` (a bot was
 * playing it for its person when the hand ended) isn't counted: the bot's
 * play, and above all its win, isn't theirs. Read-modify-write: the one way
 * to lose a count is the same person finishing two hands at once, which a
 * timer can bear.
 */
export async function recordHand(seats: Seats, state: HandState, away: readonly boolean[] = []): Promise<void> {
  const winner: Seat | null = state.result?.type === 'win' ? state.result.winner : null;
  const humans = seats.flatMap((s, i) => (s?.kind === 'human' && !away[i] ? [{ id: s.userId, won: i === winner }] : []));
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
 * The bookkeeping around a game that has ended, written from how it ended
 * (table_state.over), which the commit that ended it already saved. So the
 * game is over whatever happens here, and this can run again, as often as it
 * takes: every write sets values and never adds to them.
 *   1. who finished where (game_players: every seat's final score and place),
 *      one row per seat, overwriting the rows the deal wrote;
 *   2. who was there at the end (presentAtEnd: seated then, and not away in
 *      `absence`; nobody after an idle end or an abandon): their member rows'
 *      `last_seen_at` moves to the end's moment, never back, so the lobby
 *      has them here for the next six hours (seating.ts isHere);
 *   3. the room, back to the lobby's "finished", only while it still holds
 *      this game and is playing it; then, while it's between games after
 *      this one, the seat given back to anyone who left as the last hand was
 *      scored, on a repeat finish too (closeRoom);
 *   4. the game's own row: its status, when and how it ended, who ended it,
 *      and how many hands were played.
 * The game's status is last because it's what tells a later request the job
 * is done: until it lands the game reads active, and the next request that
 * looks at it finishes it again. Each write throws when it fails, so nothing
 * after it runs until then. A person with no profile row can't stop it: the
 * rows are written again without ids (profile_missing), as the deal does.
 */
export async function finishGame(gameId: string, room: Pick<RoomRow, 'id'>, over: GameOver, absence: Absence | undefined): Promise<void> {
  const client = db();
  const endedAt = new Date(over.at).toISOString();
  const rows = finalPlayers(over).map((p) => ({ game_id: gameId, ...p }));
  if (rows.length > 0) {
    const players = (r: typeof rows) => client.from('game_players').upsert(r, { onConflict: 'game_id,seat' });
    const res = await players(rows);
    if (res.error?.code === NO_SUCH_ROW) {
      logError('profile_missing', new SupabaseError('record how everyone finished', res.error), { gameId });
      must(await players(rows.map((r) => ({ ...r, user_id: null }))), 'record how everyone finished');
    } else must(res, 'record how everyone finished');
  }
  const there = presentAtEnd(over, absence);
  if (there.length > 0) {
    must(await client.from('room_members').update({ last_seen_at: endedAt }).eq('room_id', room.id).in('user_id', there).lt('last_seen_at', endedAt), 'mark who was there');
  }
  await closeRoom(client, gameId, room.id, over.seats, new Date().toISOString());
  const finished = over.how !== 'abandoned';
  const game = (endedBy: string | null) =>
    client
      .from('games')
      .update({
        status: finished ? 'finished' : 'abandoned',
        ended_at: endedAt,
        ...(finished ? { finished_at: endedAt } : {}),
        ended_how: over.how,
        ended_by: endedBy,
        hands_played: over.hands,
      })
      .eq('id', gameId);
  const res = await game(over.by?.userId ?? null);
  if (res.error?.code === NO_SUCH_ROW && over.by !== null) {
    logError('profile_missing', new SupabaseError('finish the game', res.error), { gameId });
    must(await game(null), 'finish the game');
  } else must(res, 'finish the game');
}

/**
 * The room's game is over: it goes back to the lobby's "finished". Only while
 * the room still holds this game and is still playing it: one the host has
 * dealt again keeps its new game, and a repeat finish doesn't close it again,
 * so it never moves `updated_at` under a host who is about to tap Start.
 *
 * Then anyone who left as the last hand was scored gets their seat back
 * (giveSeatsBack). A leave reads the table, then saves the seats on the
 * room's `updated_at`, and the commit that ends the game doesn't touch the
 * room, so a leave can land after the end and give the seat to a bot.
 * Closing moves `updated_at`, so a leave that hasn't landed by then loses,
 * reads again and finds the game over; one that has landed is in the seats
 * the close reads back, and is undone there.
 */
async function closeRoom(client: ReturnType<typeof db>, gameId: string, roomId: string, atEnd: Seats, now: string): Promise<void> {
  const closed = must(
    await client.from('rooms').update({ status: 'finished', updated_at: now }).eq('id', roomId).eq('current_game_id', gameId).eq('status', 'playing').select(BETWEEN_GAMES),
    'close the room',
  );
  await giveSeatsBack(client, gameId, roomId, atEnd, (closed as BetweenGames[] | null)?.[0] ?? null);
}

/** What giveSeatsBack reads of the room: whether it's still between games after this one, its seats, and its last write. */
const BETWEEN_GAMES = 'status, current_game_id, seats, updated_at';
type BetweenGames = Pick<RoomRow, 'status' | 'current_game_id' | 'seats' | 'updated_at'>;

/**
 * Anyone the game ended with (`atEnd`, its final seats) whose room seat has
 * gone to a bot since gets it back (seating.ts seatsBack). Worked out afresh
 * from each read of the room, and written on that read's `updated_at`, so a
 * write the give-back loses to (someone sitting in another seat, say) only
 * means reading again: the seat a person has taken since stays theirs, and
 * the rest is still given back. Up to SEAT_ATTEMPTS reads; the last loss
 * throws, like any failed write, so the game's own row isn't written yet and
 * the next request that finishes it tries again.
 *
 * Only while the room is between games after this one (finished, and still
 * pointed at it), so a room dealt again is never touched. That's also what
 * makes it safe on a repeat finish, when `closed` is null (the room was
 * closed before) and the room is read here instead: between games nothing
 * but a leave that lost to the end puts a bot where the final table has a
 * person, so a finish run again recovers a give-back that failed.
 */
async function giveSeatsBack(client: ReturnType<typeof db>, gameId: string, roomId: string, atEnd: Seats, closed: BetweenGames | null): Promise<void> {
  let row = closed;
  for (let attempt = 1; ; attempt++) {
    row ??= must(await client.from('rooms').select(BETWEEN_GAMES).eq('id', roomId).maybeSingle(), 'read the room') as BetweenGames | null;
    if (!row || row.status !== 'finished' || row.current_game_id !== gameId) return;
    const seats = seatsBack(row.seats, atEnd);
    if (!seats) return;
    const wrote = must(
      await client
        .from('rooms')
        .update({ seats, updated_at: new Date().toISOString() })
        .eq('id', roomId)
        .eq('current_game_id', gameId)
        .eq('status', 'finished')
        .eq('updated_at', row.updated_at)
        .select('id'),
      'give back the seats',
    );
    if (wrote?.length === 1) return;
    if (attempt >= SEAT_ATTEMPTS) throw new Error('could not give back the seats: the room kept changing');
    row = null;
  }
}

/**
 * The games the sweep should visit, asked of `live_state.wake_at` alone (the
 * next moment the server has to act on a table unasked), as two questions
 * within one limit:
 * 1. active games whose wake time has passed, earliest first, which the
 *    partial index live_state_wake_at serves;
 * 2. only if that left room, active games with no wake time at all, least
 *    recently saved first: a table last saved before 0005 or by older code,
 *    or a game whose end is saved but whose finish didn't all land. (A
 *    finished hand waiting for someone to deal the next has a wake time: the
 *    moment it would end as idle.)
 * Due tables come first, so however many tables are parked, they can never
 * crowd out one whose clock has run out. The status filter matters: a
 * finished or abandoned game keeps its live_state row, and one left with a
 * wake time would be swept, and fail, every day.
 */
export async function dueGames(now: number, limit = 50): Promise<string[]> {
  const iso = new Date(now).toISOString();
  const active = () => db().from('live_state').select('game_id, games!inner(status)').eq('games.status', 'active');
  const ids = (res: { data: unknown[] | null; error: SupabaseFailure | null }) => (must(res, 'find tables past their clocks') ?? []).map((r) => (r as { game_id: string }).game_id);
  const due = ids(await active().lte('wake_at', iso).order('wake_at', { ascending: true }).limit(limit));
  const left = limit - due.length;
  if (left <= 0) return due;
  return [...due, ...ids(await active().is('wake_at', null).order('updated_at', { ascending: true }).limit(left))];
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
  return (await seatStages(seats)).levels;
}

/**
 * The levels as stagesBySeat gives them, and whether they were read: `read`
 * is false only when the profiles couldn't be read and every person was taken
 * as new, which a deal's count for the funnel mustn't pass off as a table of
 * first-timers (events.ts gameDealt).
 */
export async function seatStages(seats: Seats): Promise<{ readonly levels: (CoachStage | null)[]; readonly read: boolean }> {
  const ids = seats.flatMap((s) => (s?.kind === 'human' ? [s.userId] : []));
  if (ids.length === 0) return { levels: seats.map(() => null), read: true };
  let byId: Map<string, CoachStage>;
  let read = true;
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
    read = false;
  }
  return { levels: seats.map((s) => (s?.kind === 'human' ? (byId.get(s.userId) ?? 'new') : null)), read };
}

export type { Seat };
