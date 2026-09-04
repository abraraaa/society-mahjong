import 'server-only';
import { getRuleset, publicView, viewFor, type Seat } from '@society/engine';
import type { GameSnapshot } from './snapshot';
import type { CoachStage } from '@/lib/coach';
import { broadcast, gamePoke } from './broadcast';
import { policyFor } from './policy';
import { closeHand, finishGame, gameById, loadLive, openHand, roomById, saveLive, stagesFor, appendAction, type GameRow, type RoomRow } from './store';
import { rejectionStatus, step } from './table';
import { seatOf, type ClientAction, type Deadlines, type Seats } from './types';

export type { GameSnapshot };

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

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

function snapshot(game: GameRow, room: RoomRow, version: number, deadlines: Deadlines, state: Parameters<typeof publicView>[0], me: Seat | null, now: number): GameSnapshot {
  const ruleset = getRuleset(room.ruleset_id);
  return {
    gameId: game.id,
    roomCode: room.code,
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
  return snapshot(game, room, live.version, live.deadlines, live.state, me, now);
}

/**
 * Apply one request to the table: the caller's action, or none for a sweep.
 * Optimistic versioning: the client says which version it acted on; a
 * mismatch is a 409 carrying the current snapshot so the client can catch up.
 */
export async function actOnGame(gameId: string, userId: string | null, action: ClientAction | null, expectedVersion: number | null, now = Date.now()): Promise<GameSnapshot> {
  const { game, room } = await loadGame(gameId);
  const ruleset = getRuleset(room.ruleset_id);
  const me = userId === null ? null : seatOf(room.seats, userId);
  if (action && me === null) throw new HttpError(403, 'not seated at this table');
  if (game.status !== 'active') throw new HttpError(409, 'game is over');

  const live = await loadLive(gameId);
  if (!live) throw new HttpError(404, 'game has no live state');
  if (expectedVersion !== null && live.version !== expectedVersion) {
    throw new HttpError(409, 'stale version', snapshot(game, room, live.version, live.deadlines, live.state, me, now));
  }

  const policy = policyFor((await stagesFor(room.seats)) as CoachStage[], room.options['strict'] === true);
  let result;
  try {
    result = step({ game: live, ruleset, seats: room.seats, policy, now, ...(action ? { action } : {}), ...(me !== null ? { actor: me } : {}), seed: game.seed });
  } catch (err) {
    const status = rejectionStatus(err);
    if (status) throw new HttpError(status, (err as Error).message);
    throw err;
  }

  if (!result.changed && !result.gameOver) return snapshot(game, room, live.version, live.deadlines, live.state, me, now);

  const wasFinished = live.state.phase === 'finished';
  const ok = await saveLive(gameId, live.version, result.state, result.deadlines);
  if (!ok) {
    const fresh = await loadLive(gameId);
    throw new HttpError(409, 'lost the race', fresh ? snapshot(game, room, fresh.version, fresh.deadlines, fresh.state, me, now) : undefined);
  }
  const version = live.version + 1;

  // The durable log: player actions per hand, results when a hand ends.
  if (action && action.type !== 'nextHand') await appendAction(gameId, live.state.progress.handIndex, action);
  if (action?.type === 'nextHand' && !result.gameOver) await openHand(gameId, result.state);
  let settledRoom = room;
  if (!wasFinished && result.state.phase === 'finished') settledRoom = { ...room, ledger: await closeHand(gameId, room, result.state) };
  if (result.gameOver) await finishGame(gameId, room.id);

  await broadcast([gamePoke(gameId, version, { phase: result.state.phase, turn: result.state.turn, seq: result.state.seq, gameOver: result.gameOver })]);
  return snapshot({ ...game, status: result.gameOver ? 'finished' : game.status }, settledRoom, version, result.deadlines, result.state, me, now);
}
