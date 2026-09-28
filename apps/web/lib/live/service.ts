import 'server-only';
import { HttpError } from './errors';
export { HttpError };
import { withBots } from './rooms';
import { getRuleset, publicView, viewFor, type HandState, type Seat } from '@society/engine';
import type { CoachStage } from '../coach/types';
import type { GameSnapshot } from './snapshot';
import { broadcast, gamePoke, roomPoke } from './broadcast';
import { afterCommit, type CommitStep } from './commit';
import { handWrites, stamp } from './hand-log';
import { STALE_GAME_MS, presentAtEnd, publicGameOver } from './lifecycle';
import { logError } from './log';
import { emptySeatBots, humanLevels, policyFor } from './policy';
import { SEAT_ATTEMPTS, vacate } from './seating';
import { commitTable, countHand, finishGame, gameById, liveMeta, loadLive, recordHand, roomById, saveSeats, stagesBySeat, type GameRow, type LiveRow, type RoomRow } from './store';
import { rejectionStatus, step } from './table';
import { TABLE_STATE_V, lastActed, wakeAt, withLegacyScores, type GameOver, type TableState } from './table-state';
import { seatOf, type ClientAction, type Deadlines, type GameEnd, type Seats } from './types';
import { isUuid, parseClientAction } from './validate';

export type { GameSnapshot };

function publicSeats(seats: Seats): GameSnapshot['seats'] {
  return seats.map((s) => (s ? { kind: s.kind, name: s.name } : null));
}

async function loadGame(gameId: string): Promise<{ game: GameRow; room: RoomRow }> {
  // A truncated or hand-edited link is a game that isn't there, not a database failure: answer it before any query.
  if (!isUuid(gameId)) throw new HttpError(404, 'no such game');
  const game = await gameById(gameId);
  if (!game) throw new HttpError(404, 'no such game');
  const room = await roomById(game.room_id);
  if (!room) throw new HttpError(404, 'no such room');
  return { game, room };
}

/** Who is asking about which game, and each seat's level: everything a snapshot needs besides the table itself. */
interface Caller {
  readonly game: GameRow;
  readonly room: RoomRow;
  readonly me: Seat | null;
  readonly userId: string | null;
  readonly levels: readonly (CoachStage | null)[];
}

/** The table as a snapshot shows it. */
interface Shown {
  readonly version: number;
  readonly deadlines: Deadlines;
  readonly state: HandState;
  readonly table: TableState;
}

/**
 * The table's bookkeeping as the game reads it. A legacy table, last saved by
 * code before table_state, still has its running totals in rooms.ledger: they
 * are seeded from there here, and saved with the table's next change (R13).
 * Nothing else reads the ledger.
 */
function tableOf(live: LiveRow, room: RoomRow): TableState {
  return live.legacy ? withLegacyScores(live.table, room.ledger) : live.table;
}

function shownOf(live: LiveRow, room: RoomRow): Shown {
  return { version: live.version, deadlines: live.deadlines, state: live.state, table: tableOf(live, room) };
}

/**
 * The table as the caller sees it. A game that has ended (table_state.over)
 * is shown as it ended: its status, its seats and final totals, the caller's
 * seat in it, and whether they had the host's powers then (the host, still at
 * the table at the end), whatever the room has done since, such as deal
 * again. The final table's button says "Play again" or "Back to the room" by
 * that, and both lead to the lobby, which works the powers out afresh.
 */
function snapshot(c: Caller, shown: Shown, now: number): GameSnapshot {
  const { game, room, userId, levels } = c;
  const ruleset = getRuleset(room.ruleset_id);
  const over = shown.table.over;
  const me = over ? (userId === null ? null : seatOf(over.seats, userId)) : c.me;
  // Levels are read by the room's seats.
  const roomSeat = userId === null ? null : seatOf(room.seats, userId);
  return {
    gameId: game.id,
    roomId: room.id,
    roomCode: room.code,
    isHost: userId !== null && room.host_id === userId && (over === null || presentAtEnd(over).includes(userId)),
    rulesetId: room.ruleset_id,
    version: shown.version,
    deadlines: shown.deadlines,
    seats: publicSeats(over ? over.seats : room.seats),
    scores: over ? over.scores : (shown.table.scores ?? [0, 0, 0, 0]),
    me,
    view: me === null ? publicView(shown.state) : viewFor(shown.state, ruleset, me),
    status: over ? (over.how === 'abandoned' ? 'abandoned' : 'finished') : game.status,
    now,
    stage: me === null ? null : ((roomSeat === null ? null : levels[roomSeat]) ?? 'new'),
    ended: over ? publicGameOver(over, userId) : null,
  };
}

/**
 * A game whose end is saved (table_state.over) but whose bookkeeping isn't
 * all written yet, because the finish after that commit failed part way: the
 * game still reads active. Any request that finds one runs the finish again
 * from `over` alone (R12), at most once per request. It's safe to repeat
 * (store.ts finishGame), a failure is only logged, as after the commit, and
 * the next request tries again. The poke carries the version the table is
 * already at, so pages that have it look no further, and the room hears
 * too, for a lobby open on it. A heal never counts as the game's end: the
 * request that ended the game did that.
 */
async function healFinish(gameId: string, room: RoomRow, over: GameOver, version: number): Promise<void> {
  await afterCommit(
    [{ what: 'finish the game', run: () => finishGame(gameId, room, over) }],
    () => broadcast([gamePoke(gameId, version, { gameOver: true }), roomPoke(room.id, 'seats', {})]),
    { gameId, version, heal: true },
  );
}

/**
 * A room that says it's playing, as requireRoom reads it (its game still
 * active), whose game has in fact ended: the finish is run again (healFinish)
 * before the room is joined or dealt again, and the room comes back as that
 * left it. If the finish didn't get as far as the room, the room still reads
 * as finished, as one left "playing" by a game that has ended always does
 * (rooms.ts withGameOver). Any other room comes back as it was.
 */
export async function settleRoomGame(room: RoomRow): Promise<RoomRow> {
  const gameId = room.current_game_id;
  if (room.status !== 'playing' || gameId === null) return room;
  const meta = await liveMeta(gameId);
  if (!meta?.table.over) return room;
  await healFinish(gameId, room, meta.table.over, meta.version);
  const fresh = (await roomById(room.id)) ?? room;
  return fresh.status === 'playing' && fresh.current_game_id === gameId ? { ...fresh, status: 'finished' } : fresh;
}

/** The caller's current view. Spectators (seated nowhere) get the public view. */
export async function viewGame(gameId: string, userId: string, now = Date.now()): Promise<GameSnapshot> {
  const { game, room } = await loadGame(gameId);
  const me = seatOf(room.seats, userId);
  if (me === null && room.host_id !== userId) throw new HttpError(403, 'not at this table');
  const [live, levels] = await Promise.all([loadLive(gameId), stagesBySeat(room.seats)]);
  if (!live) throw new HttpError(404, 'game has no live state');
  if (live.table.over && game.status === 'active') await healFinish(gameId, room, live.table.over, live.version);
  return snapshot({ game, room, me, userId, levels }, shownOf(live, room), now);
}

/**
 * Apply one request to the table: the caller's action, or none for a sweep.
 * Optimistic versioning: the client says which version it acted on; a
 * mismatch is a 409 carrying the current snapshot so the client can catch up.
 *
 * `userId` null is the server itself (the cron sweep, a bot taking a seat).
 * A person needs a seat to act; to tick (resolve expired clocks and read the
 * table back) they need a seat or the host's chair, as viewing does, so a
 * stranger holding a game id can neither move the table nor watch it.
 *
 * The commit point is one commit_table call (applyStep): the state, the
 * running totals, the clocks and every move the request made, with the
 * hand's result once it ends, and the game's end once it has, all saved
 * together or not at all. Before it, a failure goes back to the caller and
 * nothing has changed. After it, the move counts: the rest of the
 * bookkeeping (the game's hand count, the players' tallies, the game's
 * finish) is attempted and any failure logged, the others are always poked,
 * and the caller always gets the new table, never a 500 for a move that
 * landed.
 *
 * A game that has ended but isn't all recorded yet is finished again here
 * (healFinish): a tick, the sweep included, then gets the final table, and a
 * move gets 409 "game is over" with it.
 */
export async function actOnGame(gameId: string, userId: string | null, clientAction: ClientAction | null, expectedVersion: number | null, now = Date.now()): Promise<GameSnapshot> {
  // Rebuilt from its checked fields whoever the caller is, so the table and the hand log only ever see a validated move.
  const action = clientAction === null ? null : parseClientAction(clientAction);
  if (clientAction !== null && action === null) throw new HttpError(400, 'that is not a move a player can make');
  const { game, room } = await loadGame(gameId);
  const me = userId === null ? null : seatOf(room.seats, userId);
  if (action && me === null) throw new HttpError(403, 'not seated at this table');
  if (userId !== null && me === null && room.host_id !== userId) throw new HttpError(403, 'not at this table');
  if (game.status !== 'active') throw new HttpError(409, 'game is over');

  // The players' levels size the clocks and pick how the filler bots play; read alongside the table, not after it.
  const [live, levels] = await Promise.all([loadLive(gameId), stagesBySeat(room.seats)]);
  if (!live) throw new HttpError(404, 'game has no live state');
  const caller: Caller = { game, room, me, userId, levels };
  const over = live.table.over;
  if (over) {
    await healFinish(game.id, room, over, live.version);
    const snap = snapshot(caller, shownOf(live, room), now);
    if (action) throw new HttpError(409, 'game is over', snap);
    return snap;
  }
  if (expectedVersion !== null && live.version !== expectedVersion) throw new HttpError(409, 'stale version', snapshot(caller, shownOf(live, room), now));

  const out = await applyStep(caller, live, { action }, now);
  if (out !== 'lost') return out;
  // Someone else saved first, and nothing of this request was written: the caller gets the table as it now stands.
  const fresh = await loadLive(gameId);
  throw new HttpError(409, 'lost the race', fresh ? snapshot(caller, shownOf(fresh, room), now) : undefined);
}

/**
 * One request's step, saved as one commit_table call, then the bookkeeping
 * that follows it and the poke. Gives the new snapshot, or 'lost' when
 * someone else saved first, in which case nothing was written, no step after
 * the commit ran and nobody was poked.
 */
async function applyStep(c: Caller, live: LiveRow, input: { readonly action: ClientAction | null; readonly end?: GameEnd }, now: number): Promise<GameSnapshot | 'lost'> {
  const { game, room, me, userId, levels } = c;
  const { action, end } = input;
  // A newer deploy wrote this table's bookkeeping in a shape this code can't read. Saving over it would lose what it
  // can't see, so the table waits for that deploy to come back.
  if (live.table.v > TABLE_STATE_V) {
    logError('table_state_newer', new Error(`table_state is v${live.table.v}, and this deploy writes v${TABLE_STATE_V}`), { gameId: game.id, version: live.version });
    throw new HttpError(503, 'something went wrong');
  }

  const ruleset = getRuleset(room.ruleset_id);
  const table = tableOf(live, room);
  const strict = room.options['strict'] === true;
  const policy = policyFor(humanLevels(levels), strict);
  const bots = emptySeatBots(levels, strict);
  let result;
  try {
    result = step({
      game: { state: live.state, deadlines: live.deadlines, tableState: table },
      ruleset,
      seats: room.seats,
      policy,
      now,
      ...(action ? { action } : {}),
      ...(end ? { end } : {}),
      ...(me !== null ? { actor: me } : {}),
      seed: game.seed,
      bots,
    });
  } catch (err) {
    const status = rejectionStatus(err);
    if (status) throw new HttpError(status, (err as Error).message);
    throw err;
  }

  // Nothing moved (a tick before any clock ran out): nothing to save.
  if (!result.changed) return snapshot(c, { version: live.version, deadlines: live.deadlines, state: live.state, table }, now);

  const version = live.version + 1;
  const hands = handWrites(live.state, result.state, stamp(result.moves, version));
  // acted_at says when a person last moved the table at all, so a pass counts. A legacy table's first commit also counts
  // when its last save was recent: older code never wrote acted_at, and a game being played across the deploy mustn't read
  // as idle for its age (R23).
  const acted = (userId !== null && action !== null) || (live.legacy && now - lastActed(live) <= STALE_GAME_MS);
  const wake = wakeAt({ deadlines: result.deadlines, table: result.tableState, actedAt: acted ? now : lastActed(live) });
  const saved = await commitTable(game.id, live.version, { state: result.state, table: result.tableState, deadlines: result.deadlines, wakeAt: wake, acted, hands });
  if (saved === null) return 'lost';

  // Committed: from here the move counts, and so does the hand's result with its points, and the game's end.
  const next = result.state;
  const over = result.tableState.over;
  const steps: CommitStep[] = [];
  if (result.finishedHand) {
    // Not when the hand ended the game: the finish writes the game's hand count itself, and bump_hands_played adds one
    // where the finish sets it, so a heal that got there first would leave it one too many.
    if (!result.gameOver) steps.push({ what: 'count the hand', run: () => countHand(game.id) });
    steps.push({ what: 'tally the players', run: () => recordHand(room.seats, next) });
  }
  if (result.gameOver && over) {
    // The game's own status is finishGame's last write, so a finish that fails part way leaves the game active, and the next
    // request that looks at it finishes it again (healFinish). The game is over either way: its end is committed.
    steps.push({ what: 'finish the game', run: () => finishGame(game.id, room, over) });
  }
  const poke = gamePoke(game.id, version, {
    phase: next.phase,
    turn: next.turn,
    seq: next.seq,
    gameOver: result.gameOver,
    ...(over?.how === 'abandoned' ? { abandoned: true } : {}),
  });
  await afterCommit(steps, () => broadcast([poke]), { gameId: game.id, version });

  const snap = snapshot(c, { version, deadlines: result.deadlines, state: next, table: result.tableState }, now);
  // Only the caller's own stand-in moves: another seat's exchange carries the tiles it passed, which stay private.
  const mine = me === null ? [] : result.standIns.filter((x) => x.seat === me);
  return mine.length > 0 ? { ...snap, standIns: mine } : snap;
}

/**
 * Stand up from a live table. A bot takes the seat for the rest of the game
 * so the others can carry on. When the last human leaves, the game ends as
 * abandoned, saved with the table like any other end (an unfinished hand
 * doesn't count, and there's no final table), and is finished: the room
 * closes. Idempotent for someone already gone.
 */
export async function leaveGame(gameId: string, userId: string, now = Date.now()): Promise<{ abandoned: boolean }> {
  for (let attempt = 1; ; attempt++) {
    const { game, room } = await loadGame(gameId);
    const me = seatOf(room.seats, userId);
    if (me === null) return { abandoned: game.status === 'abandoned' };
    if (game.status !== 'active') return { abandoned: game.status === 'abandoned' };
    // The host has dealt a newer game since this one, whose end did not fully record. The seats are that game's now, and
    // not this one's to give up.
    if (room.current_game_id !== gameId) return { abandoned: false };
    const vacated = vacate(room.seats, me);
    if (!vacated.some((s) => s?.kind === 'human')) {
      const [live, levels] = await Promise.all([loadLive(gameId), stagesBySeat(room.seats)]);
      if (!live) throw new HttpError(404, 'game has no live state');
      // Already over, its end not all recorded: record it, rather than end it twice.
      if (live.table.over) {
        await healFinish(gameId, room, live.table.over, live.version);
        return { abandoned: live.table.over.how === 'abandoned' };
      }
      // The leaver keeps their seat in the room: the game they're leaving is over, and the room is between games.
      const out = await applyStep({ game, room, me, userId, levels }, live, { action: null, end: { how: 'abandoned', by: null } }, now);
      if (out !== 'lost') return { abandoned: out.status === 'abandoned' };
      if (attempt >= SEAT_ATTEMPTS) throw new HttpError(409, 'the table changed under you; try again');
      continue;
    }
    const seats = withBots(vacated);
    // Optimistic on the room's updated_at: two people standing up at once means the second reads again and empties only their own seat.
    if (await saveSeats(room.id, seats, room.updated_at)) {
      await broadcast([roomPoke(room.id, 'seats', { seats: publicSeats(seats) })]);
      // The bot now in the seat may owe the table a move: settle it straight away. The seat is already given up, so a failure
      // here is logged, not handed to the leaver; the next tick or the sweep plays the bot's move instead.
      try {
        await actOnGame(gameId, null, null, null, now);
      } catch (err) {
        // A 409 means someone else moved the table first, and settled the bot as they did.
        if (!(err instanceof HttpError && err.status < 500)) logError('leave_settle_failed', err, { gameId });
      }
      return { abandoned: false };
    }
    if (attempt >= SEAT_ATTEMPTS) throw new HttpError(409, 'the table changed under you; try again');
  }
}

/**
 * The daily sweep: settle each table it's given (dueGames), one at a time,
 * so one stuck table never stops the rest: a clock that has run out is
 * resolved, and a game whose end didn't fully record is finished (actOnGame).
 * Returns what happened to each.
 *
 * A refusal (a 4xx) means the table moved on its own between the query and
 * the settle: a player or a tick saved first, or the game ended. That is
 * the sweep having nothing left to do, so it is recorded as 'already moved'
 * and not logged. Anything else is logged as sweep_game_failed.
 */
export async function sweepGames(gameIds: readonly string[], now = Date.now()): Promise<Record<string, string>> {
  const results: Record<string, string> = {};
  for (const id of gameIds) {
    try {
      await actOnGame(id, null, null, null, now);
      results[id] = 'ok';
    } catch (err) {
      if (err instanceof HttpError && err.status < 500) {
        results[id] = 'already moved';
      } else {
        logError('sweep_game_failed', err, { route: '/api/cron/sweep', gameId: id });
        results[id] = err instanceof Error ? err.message : String(err);
      }
    }
  }
  return results;
}
