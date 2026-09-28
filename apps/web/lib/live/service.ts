import 'server-only';
import { HttpError } from './errors';
export { HttpError };
import { withBots } from './rooms';
import { getRuleset, publicView, viewFor, type HandState, type Seat } from '@society/engine';
import type { CoachStage } from '../coach/types';
import { isAway, presentHumans } from './absence';
import { ownAbsence, publicSeats, type GameSnapshot } from './snapshot';
import { broadcast, gamePoke, roomPoke } from './broadcast';
import { afterCommit, type CommitStep } from './commit';
import { gameEnded, recordEvent } from './events';
import { handWrites, stamp } from './hand-log';
import { STALE_GAME_MS, VOTE_ATTEMPTS, isStale, nextHandWait, presentAtEnd, publicGameOver } from './lifecycle';
import { logError } from './log';
import { emptySeatBots, policyFor, presentLevels } from './policy';
import { SEAT_ATTEMPTS, hostOf, vacate } from './seating';
import { commitTable, countHand, finishGame, gameById, liveMeta, loadLive, recordHand, roomById, saveSeats, stagesBySeat, type GameRow, type LiveRow, type RoomRow } from './store';
import { JustPlayed, rejectionStatus, step } from './table';
import { TABLE_STATE_V, lastActed, wakeAt, withLegacyScores, type Absence, type GameOver, type TableState } from './table-state';
import { isHuman, seatOf, type ClientAction, type Deadlines, type GameEnd, type SeatChange } from './types';
import { isUuid, parseClientAction, parseSeat } from './validate';

export type { GameSnapshot };

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
 * Who has the host's powers at this table (hostOf): while it's in play, among
 * the people seated in the room who are here (a bot isn't playing for them);
 * once it has ended, among who sat where at the end and was still at the
 * table then, whatever the room has done since.
 */
function powersAt(room: RoomRow, over: GameOver | null, absence: Absence): string | null {
  if (over === null) return hostOf(room.host_id, room.seats, (seat) => isHuman(room.seats, seat) && !isAway(absence, room.seats, seat));
  const present = presentAtEnd(over, absence);
  return hostOf(room.host_id, over.seats, (seat) => {
    const entry = over.seats[seat];
    return entry?.kind === 'human' && present.includes(entry.userId);
  });
}

/**
 * The table as the caller sees it. A game that has ended (table_state.over)
 * is shown as it ended: its status, its seats and final totals, the caller's
 * seat in it, and whether they had the host's powers then, whatever the room
 * has done since, such as deal again. The final table's button says "Play
 * again" or "Back to the room" by that, and both lead to the lobby, which
 * works the powers out afresh.
 */
function snapshot(c: Caller, shown: Shown, now: number): GameSnapshot {
  const { game, room, userId, levels } = c;
  const ruleset = getRuleset(room.ruleset_id);
  const over = shown.table.over;
  const absence = shown.table.absence;
  const me = over ? (userId === null ? null : seatOf(over.seats, userId)) : c.me;
  // Levels are read by the room's seats.
  const roomSeat = userId === null ? null : seatOf(room.seats, userId);
  return {
    gameId: game.id,
    roomId: room.id,
    roomCode: room.code,
    // hostOf only ever names someone seated, so an unseated caller never has the powers.
    isHost: userId !== null && powersAt(room, over, absence) === userId,
    rulesetId: room.ruleset_id,
    version: shown.version,
    deadlines: shown.deadlines,
    // Who's away is news only while the game is in play; the final table shows who sat where.
    seats: over ? publicSeats(over.seats, undefined) : publicSeats(room.seats, absence),
    scores: over ? over.scores : (shown.table.scores ?? [0, 0, 0, 0]),
    me,
    view: me === null ? publicView(shown.state) : viewFor(shown.state, ruleset, me),
    status: over ? (over.how === 'abandoned' ? 'abandoned' : 'finished') : game.status,
    now,
    stage: me === null ? null : ((roomSeat === null ? null : levels[roomSeat]) ?? 'new'),
    ended: over ? publicGameOver(over, userId) : null,
    mine: over ? null : ownAbsence(room.seats, absence, me),
    // Who the next hand waits on: the people here, in the room's seats as they are now.
    nextHand: over || game.status !== 'active' ? null : nextHandWait(shown.state, room.seats, presentHumans(room.seats, absence), shown.table),
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
 * active), whose game has in fact ended, or should: a game whose end is
 * saved has its finish run again (healFinish), and one nobody has played for
 * STALE_GAME_MS is ended as idle (endIfStale), before the room is joined or
 * dealt again. The room then comes back as that left it. If the finish didn't
 * get as far as the room, the room still reads as finished, as one left
 * "playing" by a game that has ended always does (rooms.ts withGameOver).
 *
 * So does a room already closed whose game still reads active: its finish
 * closed the room and stopped before the game's own row, most likely at the
 * seat it had to give back to someone who left as the last hand was scored
 * (store.ts closeRoom). A final table doesn't poll, so nobody may look at
 * that game again before the host deals: it's finished here, and the seat
 * given back, before the room is joined or dealt again. Any other room comes
 * back as it was.
 */
export async function settleRoomGame(room: RoomRow, now = Date.now()): Promise<RoomRow> {
  const gameId = room.current_game_id;
  if (room.status === 'finished' && gameId !== null) return finishClosedRoomGame(room, gameId);
  if (room.status !== 'playing' || gameId === null) return room;
  const meta = await liveMeta(gameId);
  if (!meta) return room;
  if (meta.table.over) await healFinish(gameId, room, meta.table.over, meta.version);
  // Stale by this quick read; endIfStale reads the table again, and does nothing if someone has just played.
  else if (!isStale(lastActed(meta), now) || !(await endIfStale(gameId, now))) return room;
  const fresh = (await roomById(room.id)) ?? room;
  return fresh.status === 'playing' && fresh.current_game_id === gameId ? { ...fresh, status: 'finished' } : fresh;
}

/** settleRoomGame for a room already closed: its game's finish run again when the game still reads active and its end is saved. */
async function finishClosedRoomGame(room: RoomRow, gameId: string): Promise<RoomRow> {
  const game = await gameById(gameId);
  if (game?.status !== 'active') return room;
  const meta = await liveMeta(gameId);
  if (!meta?.table.over) return room;
  await healFinish(gameId, room, meta.table.over, meta.version);
  return (await roomById(room.id)) ?? room;
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
 * finish and the funnel's count of its end) is attempted and any failure
 * logged, the others are always poked, and the caller always gets the new
 * table, never a 500 for a move that landed.
 *
 * A game that has ended but isn't all recorded yet is finished again here
 * (healFinish): a tick, the sweep included, then gets the final table, and a
 * move gets 409 "game is over" with it.
 *
 * A Next hand tap that names its hand (R16) is a vote, and a vote needs no
 * particular version: it skips the version check, and a commit that loses
 * is tried again on a fresh read, up to VOTE_ATTEMPTS, so four people
 * tapping together while their phones tick never bounce off each other. One
 * for a hand that has already started changes nothing but its person's
 * presence. A tap without a hand (a page loaded before votes) is judged
 * against its version, as any move is.
 */
export async function actOnGame(gameId: string, userId: string | null, clientAction: ClientAction | null, expectedVersion: number | null, now = Date.now()): Promise<GameSnapshot> {
  // Rebuilt from its checked fields whoever the caller is, so the table and the hand log only ever see a validated move.
  const action = clientAction === null ? null : parseClientAction(clientAction);
  if (clientAction !== null && action === null) throw new HttpError(400, 'that is not a move a player can make');
  if (action?.type === 'nextHand' && action.hand !== undefined) {
    return retryOnLost(VOTE_ATTEMPTS, async () => {
      const out = await actOnce(gameId, userId, action, null, now);
      return out.kind === 'done' ? out.snap : 'lost';
    });
  }
  const out = await actOnce(gameId, userId, action, expectedVersion, now);
  if (out.kind === 'done') return out.snap;
  // Someone else saved first, and nothing of this request was written: the caller gets the table as it now stands.
  const fresh = await loadLive(gameId);
  throw new HttpError(409, 'lost the race', fresh ? snapshot(out.caller, shownOf(fresh, out.caller.room), now) : undefined);
}

/**
 * One go at actOnGame's request, on a fresh read: the checks, a heal, the
 * version check (unless `expectedVersion` is null), then the step and its
 * commit. 'lost' when someone else saved first, with the caller it was
 * judged as, for the table the loser is shown.
 */
async function actOnce(
  gameId: string,
  userId: string | null,
  action: ClientAction | null,
  expectedVersion: number | null,
  now: number,
): Promise<{ readonly kind: 'done'; readonly snap: GameSnapshot } | { readonly kind: 'lost'; readonly caller: Caller }> {
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
    return { kind: 'done', snap };
  }
  if (expectedVersion !== null && live.version !== expectedVersion) throw new HttpError(409, 'stale version', snapshot(caller, shownOf(live, room), now));

  const out = await applyStep(caller, live, { action }, now);
  return out === 'lost' ? { kind: 'lost', caller } : { kind: 'done', snap: out };
}

/**
 * One request's step, saved as one commit_table call, then the bookkeeping
 * that follows it and the poke. Gives the new snapshot, or 'lost' when
 * someone else saved first, in which case nothing was written, no step after
 * the commit ran and nobody was poked.
 */
async function applyStep(
  c: Caller,
  live: LiveRow,
  input: { readonly action: ClientAction | null; readonly end?: GameEnd; readonly change?: SeatChange },
  now: number,
): Promise<GameSnapshot | 'lost'> {
  const { game, room, me, userId, levels } = c;
  const { action, end, change } = input;
  // A newer deploy wrote this table's bookkeeping in a shape this code can't read. Saving over it would lose what it
  // can't see, so the table waits for that deploy to come back.
  if (live.table.v > TABLE_STATE_V) {
    logError('table_state_newer', new Error(`table_state is v${live.table.v}, and this deploy writes v${TABLE_STATE_V}`), { gameId: game.id, version: live.version });
    throw new HttpError(503, 'something went wrong');
  }

  const ruleset = getRuleset(room.ruleset_id);
  const table = tableOf(live, room);
  const strict = room.options['strict'] === true;
  // The clocks are sized by the people who'll be here once the step is done (it works that out from the levels); this is
  // the same answer for the table as it was read.
  const policy = policyFor(presentLevels(levels, room.seats, table.absence), strict);
  // The filler bots go by everyone seated, away or not: a first-timer a bot is playing for is still at this table.
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
      ...(change ? { change } : {}),
      ...(me !== null ? { actor: me } : {}),
      seed: game.seed,
      bots,
      levels,
      strict,
      // What this step saves as if its commit lands; a commit that loses is stepped again on a fresh read, with that one's.
      version: live.version + 1,
    });
  } catch (err) {
    // Refused with the table attached, so the host's sheet shows who's just played.
    if (err instanceof JustPlayed) throw new HttpError(409, 'that player has just played', snapshot(c, shownOf(live, room), now));
    const status = rejectionStatus(err);
    if (status) throw new HttpError(status, (err as Error).message);
    throw err;
  }

  // Nothing moved (a tick before any clock ran out): nothing to save.
  if (!result.changed) return snapshot(c, { version: live.version, deadlines: live.deadlines, state: live.state, table }, now);

  const version = live.version + 1;
  const hands = handWrites(live.state, result.state, stamp(result.moves, version));
  // acted_at says when a person last moved the table at all, so a pass counts, and so do ending it, coming back and handing a
  // seat to a bot. (Whether a seat's person is here is absence's business, where a pass never counts, R4.) A legacy table's first
  // commit also counts when its last save was recent: older code never wrote acted_at, and a game being played across the
  // deploy mustn't read as idle for its age (R23).
  const acted = (userId !== null && (action !== null || end !== undefined || change !== undefined)) || (live.legacy && now - lastActed(live) <= STALE_GAME_MS);
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
    // Not the seats a bot was playing for when the hand ended: a bot's win mustn't count towards a first-timer's level.
    const away = result.awayAtEnd ?? [];
    steps.push({ what: 'tally the players', run: () => recordHand(room.seats, next, away) });
  }
  if (result.gameOver && over) {
    // The game's own status is finishGame's last write, so a finish that fails part way leaves the game active, and the next
    // request that looks at it finishes it again (healFinish). The game is over either way: its end is committed.
    steps.push({ what: 'finish the game', run: () => finishGame(game.id, room, over) });
    // Counted here, by the request that ended the game, whether or not its finish landed, and never by a heal: each end once.
    // recordEvent never throws; a failed write is its own event_write_failed line.
    steps.push({ what: 'count the end', run: () => recordEvent(gameEnded({ roomId: room.id, gameId: game.id, over, leaver: userId })) });
  }
  const poke = gamePoke(game.id, version, {
    phase: next.phase,
    turn: next.turn,
    seq: next.seq,
    gameOver: result.gameOver,
    ...(over?.how === 'abandoned' ? { abandoned: true } : {}),
  });
  // A game's end closes its room, and may give a seat back to someone whose leave landed as the last hand was scored (their
  // leave has already told the room a bot has it), so a lobby open on the room hears too, as it does from a heal.
  const pokes = result.gameOver ? [poke, roomPoke(room.id, 'seats', {})] : [poke];
  await afterCommit(steps, () => broadcast(pokes), { gameId: game.id, version });

  // What a clock did for the caller rides in their own `mine`, on whichever phone's request resolved it; another seat's stays theirs.
  return snapshot(c, { version, deadlines: result.deadlines, state: next, table: result.tableState }, now);
}

/**
 * One go at a versioned request (read the table, step it, commit), again on a
 * fresh read each time someone else's commit lands first, up to `attempts`.
 * The last loss is 409 'the table changed under you; try again', which the
 * page reads as the table having moved on. Nothing of a lost attempt was
 * written, so trying again is always safe.
 */
async function retryOnLost<T>(attempts: number, attempt: () => Promise<T | 'lost'>): Promise<T> {
  for (let n = 1; ; n++) {
    const out = await attempt();
    if (out !== 'lost') return out;
    if (n >= attempts) throw new HttpError(409, 'the table changed under you; try again');
  }
}

/**
 * The host ends the game for everyone (R22): between hands from the result
 * sheet, or mid-hand from the Leave sheet. The end is saved with the table,
 * like any other, and everyone gets the final table. Mid-hand, the hand being
 * played doesn't count: no points move, and its log says the host ended it.
 * A finished last hand is recorded as played out. Only whoever has the host's
 * powers (hostOf) may; a second tap, or one that meets a game already over
 * but not all recorded, finishes the record and gets the final table.
 */
export async function endGame(gameId: string, userId: string, now = Date.now()): Promise<GameSnapshot> {
  return retryOnLost(SEAT_ATTEMPTS, async () => {
    const { game, room } = await loadGame(gameId);
    if (game.status !== 'active') throw new HttpError(409, 'game is over');
    const me = seatOf(room.seats, userId);
    if (me === null) throw new HttpError(403, 'only the host can end the game');
    const [live, levels] = await Promise.all([loadLive(gameId), stagesBySeat(room.seats)]);
    if (!live) throw new HttpError(404, 'game has no live state');
    const caller: Caller = { game, room, me, userId, levels };
    if (live.table.over) {
      await healFinish(gameId, room, live.table.over, live.version);
      return snapshot(caller, shownOf(live, room), now);
    }
    if (powersAt(room, null, tableOf(live, room).absence) !== userId) throw new HttpError(403, 'only the host can end the game');
    const name = room.seats[me]?.name ?? '';
    return applyStep(caller, live, { action: null, end: { how: 'host', by: { userId, name } } }, now);
  });
}

/**
 * The idle end (R23): a game no person has moved for STALE_GAME_MS, by
 * lastActed (so a legacy table's last save counts too), ends as idle, by
 * nobody. 'ended' when this request ended it; 'healed' when it had already
 * ended and its finish was run again; null when it's still being played, or
 * isn't active. A commit that loses reads the table again, so a person's move
 * that lands first makes it fresh, and it does nothing.
 */
async function idleEnd(gameId: string, now: number): Promise<'ended' | 'healed' | null> {
  return retryOnLost<'ended' | 'healed' | null>(SEAT_ATTEMPTS, async () => {
    const { game, room } = await loadGame(gameId);
    if (game.status !== 'active') return null;
    const live = await loadLive(gameId);
    if (!live) return null;
    if (live.table.over) {
      await healFinish(gameId, room, live.table.over, live.version);
      return 'healed';
    }
    if (!isStale(lastActed(live), now)) return null;
    // The levels only matter to a table that's about to move, so a fresh one (most of what the sweep finds) never reads them.
    const levels = await stagesBySeat(room.seats);
    const out = await applyStep({ game, room, me: null, userId: null, levels }, live, { action: null, end: { how: 'idle', by: null } }, now);
    return out === 'lost' ? 'lost' : 'ended';
  });
}

/** End a game nobody has played for STALE_GAME_MS (idleEnd). True when the game is over now, ended here or before; false when it's still in play. */
export async function endIfStale(gameId: string, now = Date.now()): Promise<boolean> {
  return (await idleEnd(gameId, now)) !== null;
}

/** What a page asks of changeSeat, before it's checked: its own person back, or (the host) a bot for someone else's seat. */
export type SeatChangeRequest = { readonly type: 'back' } | { readonly type: 'letBotPlay'; readonly seat: unknown; readonly sawAt: unknown; readonly sawVersion?: unknown };

/**
 * Who plays a seat (R4, R8): "I'm back" from someone a bot has been playing
 * for, or the host handing another person's seat to a bot straight away,
 * after they've stepped away. Saved with the table, like a move, on a fresh
 * read each time someone else's commit lands first (three tries). The host's
 * hand-over is refused when its person has tapped since the host's table was
 * sent (`sawVersion`, that table's version; `sawAt`, the server's clock on
 * it, for a page that sends no version): 409 with the table, so the host
 * sees them still playing. One that changes nothing (back when already here,
 * a seat already away) writes nothing and gives the table as it is.
 */
export async function changeSeat(gameId: string, userId: string, request: SeatChangeRequest, now = Date.now()): Promise<GameSnapshot> {
  return retryOnLost(SEAT_ATTEMPTS, async () => {
    const { game, room } = await loadGame(gameId);
    const me = seatOf(room.seats, userId);
    if (request.type === 'back' && me === null) throw new HttpError(403, 'not seated at this table');
    if (request.type === 'letBotPlay' && me === null) throw new HttpError(403, 'only the host can hand a seat to a bot');
    if (game.status !== 'active') throw new HttpError(409, 'game is over');
    const [live, levels] = await Promise.all([loadLive(gameId), stagesBySeat(room.seats)]);
    if (!live) throw new HttpError(404, 'game has no live state');
    const caller: Caller = { game, room, me, userId, levels };
    if (live.table.over) {
      // Ended, its bookkeeping not all written: write it, and say the game's over.
      await healFinish(gameId, room, live.table.over, live.version);
      throw new HttpError(409, 'game is over', snapshot(caller, shownOf(live, room), now));
    }
    const seat = me!;
    let change: SeatChange;
    if (request.type === 'back') {
      change = { type: 'back', seat };
    } else {
      if (powersAt(room, null, tableOf(live, room).absence) !== userId) throw new HttpError(403, 'only the host can hand a seat to a bot');
      const target = parseSeat(request.seat);
      if (target === null) throw new HttpError(400, 'that is not a seat');
      if (target === seat) throw new HttpError(400, 'that is your own seat');
      // Here, before the step, whose own check would call it someone else's seat (403).
      if (!isHuman(room.seats, target)) throw new HttpError(409, 'a bot already plays that seat');
      const sawAt = typeof request.sawAt === 'number' && Number.isFinite(request.sawAt) ? request.sawAt : null;
      const sawVersion = typeof request.sawVersion === 'number' && Number.isSafeInteger(request.sawVersion) && request.sawVersion >= 0 ? request.sawVersion : null;
      change = { type: 'letBotPlay', seat: target, bySeat: seat, sawAt, sawVersion };
    }
    return applyStep(caller, live, { action: null, change }, now);
  });
}

/**
 * Stand up from a live table. A bot takes the seat for the rest of the game
 * so the others can carry on. When the last human leaves, the game ends as
 * abandoned, saved with the table like any other end (an unfinished hand
 * doesn't count, and there's no final table), and is finished: the room
 * closes. A game whose end is already saved has nothing left to leave: its
 * finish is run again (healFinish) and the seat stays where it is, whoever
 * else is seated. Idempotent for someone already gone.
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
    // The others are still playing, unless the game ended just now (its last hand scored) and the finish hasn't landed yet:
    // then there's no game left to leave, and the seat stays theirs for the host's next deal. Record the end instead.
    const meta = await liveMeta(gameId);
    if (meta?.table.over) {
      await healFinish(gameId, room, meta.table.over, meta.version);
      return { abandoned: meta.table.over.how === 'abandoned' };
    }
    const seats = withBots(vacated);
    // Optimistic on the room's updated_at: two people standing up at once means the second reads again and empties only their own seat.
    // An end committed after the read above doesn't move updated_at, so this can still land after it; the finish then gives the seat
    // back once it has closed the room (store.ts closeRoom), on a fresh read of the room, and a finish run again does the same if
    // that failed. A close that lands first makes this lose, and the loop finds the game over.
    if (await saveSeats(room.id, seats, room.updated_at)) {
      await broadcast([roomPoke(room.id, 'seats', { seats: publicSeats(seats, meta?.table.absence) })]);
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
 * so one stuck table never stops the rest. A game nobody has played for
 * STALE_GAME_MS is ended as idle first ('ended'), rather than having its
 * clocks run for nobody; otherwise a clock that has run out is resolved, a
 * game whose end didn't fully record is finished, and a table with nothing
 * due yet (one with no wake time, last saved by older code) is left as it
 * is, with nothing written: each of those is 'ok'. Returns what happened to
 * each.
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
      const idle = await idleEnd(id, now);
      if (idle === null) await actOnGame(id, null, null, null, now);
      results[id] = idle === 'ended' ? 'ended' : 'ok';
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
