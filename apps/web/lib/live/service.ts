import 'server-only';
import { HttpError } from './errors';
export { HttpError };
import { withBots } from './rooms';
import { getRuleset, publicView, viewFor, type Seat } from '@society/engine';
import type { GameSnapshot } from './snapshot';
import { broadcast, gamePoke, roomPoke } from './broadcast';
import { afterCommit, type CommitStep } from './commit';
import { logError } from './log';
import { policyFor } from './policy';
import { SEAT_ATTEMPTS, vacate } from './seating';
import { abandonGame, appendAction, closeHand, finishGame, gameById, loadLive, openHand, roomById, saveLive, saveSeats, stagesFor, type GameRow, type RoomRow } from './store';
import { rejectionStatus, step } from './table';
import { seatOf, type ClientAction, type Deadlines, type Seats } from './types';
import { parseClientAction } from './validate';

export type { GameSnapshot };

function publicSeats(seats: Seats): GameSnapshot['seats'] {
  return seats.map((s) => (s ? { kind: s.kind, name: s.name } : null));
}

async function loadGame(gameId: string): Promise<{ game: GameRow; room: RoomRow }> {
  const game = await gameById(gameId);
  if (!game) throw new HttpError(404, 'no such game');
  const room = await roomById(game.room_id);
  if (!room) throw new HttpError(404, 'no such room');
  return { game, room };
}

function snapshot(
  game: GameRow,
  room: RoomRow,
  version: number,
  deadlines: Deadlines,
  state: Parameters<typeof publicView>[0],
  me: Seat | null,
  now: number,
  userId: string | null = null,
): GameSnapshot {
  const ruleset = getRuleset(room.ruleset_id);
  return {
    gameId: game.id,
    roomId: room.id,
    roomCode: room.code,
    isHost: userId !== null && room.host_id === userId,
    rulesetId: room.ruleset_id,
    version,
    deadlines,
    seats: publicSeats(room.seats),
    scores: room.ledger.length === 4 ? room.ledger : [0, 0, 0, 0],
    me,
    view: me === null ? publicView(state) : viewFor(state, ruleset, me),
    status: game.status,
    now,
  };
}

/** The caller's current view. Spectators (seated nowhere) get the public view. */
export async function viewGame(gameId: string, userId: string, now = Date.now()): Promise<GameSnapshot> {
  const { game, room } = await loadGame(gameId);
  const me = seatOf(room.seats, userId);
  if (me === null && room.host_id !== userId) throw new HttpError(403, 'not at this table');
  const live = await loadLive(gameId);
  if (!live) throw new HttpError(404, 'game has no live state');
  return snapshot(game, room, live.version, live.deadlines, live.state, me, now, userId);
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
 * Saving the live state is the commit point. Before it, a failure goes back
 * to the caller and nothing has changed. After it, the move counts: the
 * bookkeeping (hand log, result, scores, the game's end) is attempted and
 * any failure logged, the others are always poked, and the caller always
 * gets the new table, never a 500 for a move that landed.
 */
export async function actOnGame(gameId: string, userId: string | null, clientAction: ClientAction | null, expectedVersion: number | null, now = Date.now()): Promise<GameSnapshot> {
  // Rebuilt from its checked fields whoever the caller is, so the table and the hand log only ever see a validated move.
  const action = clientAction === null ? null : parseClientAction(clientAction);
  if (clientAction !== null && action === null) throw new HttpError(400, 'that is not a move a player can make');
  const { game, room } = await loadGame(gameId);
  const ruleset = getRuleset(room.ruleset_id);
  const me = userId === null ? null : seatOf(room.seats, userId);
  if (action && me === null) throw new HttpError(403, 'not seated at this table');
  if (userId !== null && me === null && room.host_id !== userId) throw new HttpError(403, 'not at this table');
  if (game.status !== 'active') throw new HttpError(409, 'game is over');

  const live = await loadLive(gameId);
  if (!live) throw new HttpError(404, 'game has no live state');
  if (expectedVersion !== null && live.version !== expectedVersion) {
    throw new HttpError(409, 'stale version', snapshot(game, room, live.version, live.deadlines, live.state, me, now, userId));
  }

  const policy = policyFor(await stagesFor(room.seats), room.options['strict'] === true);
  let result;
  try {
    result = step({ game: live, ruleset, seats: room.seats, policy, now, ...(action ? { action } : {}), ...(me !== null ? { actor: me } : {}), seed: game.seed });
  } catch (err) {
    const status = rejectionStatus(err);
    if (status) throw new HttpError(status, (err as Error).message);
    throw err;
  }

  if (!result.changed && !result.gameOver) return snapshot(game, room, live.version, live.deadlines, live.state, me, now, userId);

  const wasFinished = live.state.phase === 'finished';
  const ok = await saveLive(gameId, live.version, result.state, result.deadlines);
  if (!ok) {
    const fresh = await loadLive(gameId);
    throw new HttpError(409, 'lost the race', fresh ? snapshot(game, room, fresh.version, fresh.deadlines, fresh.state, me, now, userId) : undefined);
  }
  const version = live.version + 1;

  // Committed: from here the move counts. The snapshot carries the scores and status as the database now holds them, as the others will see them.
  const next = result.state;
  const handIndex = live.state.progress.handIndex;
  let ledger = room.ledger;
  let finished = false;
  // The durable log: player actions per hand, results when a hand ends.
  const steps: CommitStep[] = [];
  if (action && action.type !== 'nextHand') steps.push({ what: 'log the move', run: () => appendAction(gameId, handIndex, action) });
  if (action?.type === 'nextHand' && !result.gameOver) steps.push({ what: 'open the hand', run: () => openHand(gameId, next) });
  if (!wasFinished && next.phase === 'finished') {
    steps.push({
      what: 'close the hand',
      run: async () => {
        ledger = await closeHand(gameId, room, next);
      },
    });
  }
  if (result.gameOver) {
    // A game whose end did not record stays active, so the next "next hand" finishes it again.
    steps.push({
      what: 'finish the game',
      run: async () => {
        await finishGame(gameId, room.id);
        finished = true;
      },
    });
  }
  const poke = gamePoke(gameId, version, { phase: next.phase, turn: next.turn, seq: next.seq, gameOver: result.gameOver });
  await afterCommit(steps, () => broadcast([poke]), { gameId, version });

  const snap = snapshot({ ...game, status: finished ? 'finished' : game.status }, { ...room, ledger }, version, result.deadlines, next, me, now, userId);
  // Only the caller's own stand-in moves: another seat's exchange carries the tiles it passed, which stay private.
  const mine = me === null ? [] : result.standIns.filter((x) => x.seat === me);
  return mine.length > 0 ? { ...snap, standIns: mine } : snap;
}

/**
 * Stand up from a live table. A bot takes the seat for the rest of the game
 * so the others can carry on; when the last human leaves, the game is
 * abandoned and the room closes. Idempotent for someone already gone.
 */
export async function leaveGame(gameId: string, userId: string, now = Date.now()): Promise<{ abandoned: boolean }> {
  for (let attempt = 1; ; attempt++) {
    const { game, room } = await loadGame(gameId);
    const me = seatOf(room.seats, userId);
    if (me === null) return { abandoned: game.status === 'abandoned' };
    if (game.status !== 'active') return { abandoned: game.status === 'abandoned' };
    const vacated = vacate(room.seats, me);
    if (!vacated.some((s) => s?.kind === 'human')) {
      const live = await loadLive(gameId);
      await abandonGame(gameId, room.id);
      await broadcast([gamePoke(gameId, (live?.version ?? 0) + 1, { abandoned: true })]);
      return { abandoned: true };
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
