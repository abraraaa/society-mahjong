import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analysisBot, karachi, reduce, viewFor, type HandState } from '@society/engine';
import type { GameRow, LiveRow, RoomRow } from './store';
import { dealFirstHand, settle, type StepResult } from './table';
import type { ClientAction, Seats } from './types';
import { policyFor } from './policy';
import { parseClientAction } from './validate';

/**
 * actOnGame against an in-memory store: who may tick a table (resolve its
 * expired clocks and read it back), who may act at it, and what happens when
 * the database fails after a move is saved. The store and the broadcaster
 * are faked; the table is the real one, and `step` is wrapped only so a test
 * can hand back a hand that has just ended.
 */
const db = vi.hoisted(() => ({
  game: null as unknown,
  room: null as unknown,
  live: null as unknown,
}));

vi.mock('server-only', () => ({}));
vi.mock('./store', () => ({
  gameById: vi.fn(async () => db.game),
  roomById: vi.fn(async () => db.room),
  loadLive: vi.fn(async () => db.live),
  saveLive: vi.fn(async () => true),
  stagesFor: vi.fn(async () => ['new']),
  appendAction: vi.fn(async () => {}),
  openHand: vi.fn(async () => {}),
  closeHand: vi.fn(async () => [0, 0, 0, 0]),
  finishGame: vi.fn(async () => {}),
  abandonGame: vi.fn(async () => {}),
  saveSeats: vi.fn(async () => null),
  roomByCode: vi.fn(async () => null),
}));
vi.mock('./table', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./table')>();
  return { ...actual, step: vi.fn(actual.step) };
});
vi.mock('./broadcast', () => ({
  broadcast: vi.fn(async () => {}),
  gamePoke: vi.fn(() => ({ topic: 't', event: 'e', payload: {} })),
  roomPoke: vi.fn(() => ({ topic: 't', event: 'e', payload: {} })),
}));

import { HttpError, actOnGame, leaveGame } from './service';
import { SupabaseError } from './errors';
import * as broadcaster from './broadcast';
import * as store from './store';
import * as table from './table';

const T0 = 1_700_000_000_000;
const policy = policyFor(['new']);

/** Abrar is seated; Hana hosts but has stood up (a bot has her old seat); Zed has only the game id. */
const seats: Seats = [
  { kind: 'human', userId: 'u-abrar', name: 'Abrar' },
  { kind: 'bot', name: 'Bilal' },
  { kind: 'bot', name: 'Sana' },
  { kind: 'bot', name: 'Ayesha' },
];

function setTable(): LiveRow {
  const first = dealFirstHand(karachi, seats, 'svc-1', policy, T0);
  const live: LiveRow = { version: 3, state: first.state, deadlines: first.deadlines };
  db.game = { id: 'g-1', room_id: 'r-1', seed: 'svc-1', status: 'active', hands_played: 0 } satisfies GameRow;
  db.room = {
    id: 'r-1',
    code: 'ABCD',
    host_id: 'u-hana',
    ruleset_id: 'karachi',
    options: {},
    status: 'playing',
    seats,
    current_game_id: 'g-1',
    ledger: [0, 0, 0, 0],
    updated_at: '2026-09-24T00:00:00Z',
  } satisfies RoomRow;
  db.live = live;
  return live;
}

/** A moment after whatever clock the table is running has run out. */
function expired(live: LiveRow): number {
  return (live.deadlines.turn ?? live.deadlines.claim)! + 1;
}

async function rejection(p: Promise<unknown>): Promise<HttpError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HttpError);
  return err as HttpError;
}

/** Seat 0's own play (the analysis bot's choice) until the hand ends, the bots answering between. */
function playOut(state: HandState): HandState {
  let s = state;
  for (let i = 0; i < 500 && s.phase !== 'finished'; i++) {
    const a = analysisBot(viewFor(s, karachi, 0), karachi) ?? { type: 'pass' as const, seat: 0 as const };
    s = settle(reduce(s, a, karachi), karachi, seats);
  }
  expect(s.phase).toBe('finished');
  return s;
}

/** The next call to step hands back `state` as the table after the move. */
function nextStepGives(state: HandState, gameOver = false): void {
  vi.mocked(table.step).mockImplementationOnce((): StepResult => ({ state, deadlines: { claim: null, turn: null }, changed: true, gameOver, standIns: [] }));
}

const DOWN = () => new SupabaseError('write', { message: 'TypeError: fetch failed' });

/** Every JSON line written to console.error so far. */
function logged(log: { mock: { calls: unknown[][] } }): Record<string, unknown>[] {
  return log.mock.calls.map(([line]) => JSON.parse(line as string) as Record<string, unknown>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ticking a table', () => {
  it('refuses a stranger with the game id: no clock resolves and no table comes back', async () => {
    const live = setTable();
    const err = await rejection(actOnGame('g-1', 'u-zed', null, null, expired(live)));
    expect(err.status).toBe(403);
    expect(err.body).toBeUndefined();
    expect(store.loadLive).not.toHaveBeenCalled();
    expect(store.saveLive).not.toHaveBeenCalled();
  });

  it('lets a seated player resolve an expired clock and see their own hand', async () => {
    const live = setTable();
    const snap = await actOnGame('g-1', 'u-abrar', null, null, expired(live));
    expect(store.saveLive).toHaveBeenCalledTimes(1);
    expect(snap.version).toBe(live.version + 1);
    expect(snap.me).toBe(0);
    expect(snap.view.seq).toBeGreaterThan(live.state.seq);
  });

  it('lets the host tick without a seat, and shows them only the public table', async () => {
    const live = setTable();
    const snap = await actOnGame('g-1', 'u-hana', null, null, expired(live));
    expect(store.saveLive).toHaveBeenCalledTimes(1);
    expect(snap.me).toBeNull();
    expect(snap.isHost).toBe(true);
    expect('me' in snap.view).toBe(false);
  });

  it('still lets the server itself sweep a table with nobody signed in', async () => {
    const live = setTable();
    const snap = await actOnGame('g-1', null, null, null, expired(live));
    expect(store.saveLive).toHaveBeenCalledTimes(1);
    expect(snap.me).toBeNull();
  });

  it('writes nothing when a seated player ticks before any clock has run out', async () => {
    const live = setTable();
    const snap = await actOnGame('g-1', 'u-abrar', null, null, T0 + 1000);
    expect(store.saveLive).not.toHaveBeenCalled();
    expect(snap.version).toBe(live.version);
  });
});

describe('acting at a table', () => {
  it('needs a seat: a stranger and a seatless host are both refused', async () => {
    setTable();
    const pass: ClientAction = { type: 'pass', seat: 0 };
    for (const who of ['u-zed', 'u-hana']) {
      const err = await rejection(actOnGame('g-1', who, pass, 3, T0));
      expect(err.status).toBe(403);
    }
    expect(store.saveLive).not.toHaveBeenCalled();
  });

  it('refuses resolveClaims from a seated player, whatever seat it names, before reading anything', async () => {
    setTable();
    const forged = { type: 'resolveClaims', seat: 0 } as unknown as ClientAction;
    const err = await rejection(actOnGame('g-1', 'u-abrar', forged, 3, T0));
    expect(err.status).toBe(400);
    expect(store.gameById).not.toHaveBeenCalled();
    expect(store.saveLive).not.toHaveBeenCalled();
    expect(store.appendAction).not.toHaveBeenCalled();
  });

  it('refuses a move of the wrong shape, whoever calls, before reading anything', async () => {
    setTable();
    const bent = { type: 'discard', seat: 0, tile: 'not-a-tile' } as unknown as ClientAction;
    const err = await rejection(actOnGame('g-1', 'u-abrar', bent, 3, T0));
    expect(err.status).toBe(400);
    expect(store.gameById).not.toHaveBeenCalled();
  });

  it('logs the move as validated, never whatever else the object carried', async () => {
    const live = setTable();
    const move = analysisBot(viewFor(live.state, karachi, 0), karachi) as ClientAction;
    const padded = { ...move, note: 'hello from the client' } as unknown as ClientAction;
    await actOnGame('g-1', 'u-abrar', padded, live.version, T0 + 1000);
    expect(store.appendAction).toHaveBeenCalledTimes(1);
    const [, handIndex, action] = vi.mocked(store.appendAction).mock.calls[0]!;
    expect(handIndex).toBe(live.state.progress.handIndex);
    expect(action).toEqual(parseClientAction(move));
    expect(action).not.toHaveProperty('note');
  });
});

describe('when the database fails after the table has moved', () => {
  it('still gives the caller the new table and tells the others, and logs the failed write', async () => {
    const live = setTable();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const move = analysisBot(viewFor(live.state, karachi, 0), karachi) as ClientAction;
    vi.mocked(store.appendAction).mockRejectedValueOnce(new SupabaseError('log the move', { message: 'TypeError: fetch failed' }));
    const snap = await actOnGame('g-1', 'u-abrar', move, live.version, T0 + 1000);
    expect(snap.version).toBe(live.version + 1);
    expect(snap.me).toBe(0);
    expect(snap.view.seq).toBeGreaterThan(live.state.seq);
    expect(store.saveLive).toHaveBeenCalledTimes(1);
    expect(broadcaster.broadcast).toHaveBeenCalledTimes(1);
    expect(broadcaster.gamePoke).toHaveBeenCalledWith('g-1', live.version + 1, expect.anything());
    expect(logged(log)).toEqual([
      expect.objectContaining({
        level: 'error',
        event: 'after_commit_failed',
        step: 'log the move',
        gameId: 'g-1',
        version: live.version + 1,
        name: 'SupabaseError',
        message: 'could not log the move: TypeError: fetch failed',
      }),
    ]);
  });

  it('writes the hand log and the result before it pokes, so the others refetch a settled table', async () => {
    const live = setTable();
    const move = analysisBot(viewFor(live.state, karachi, 0), karachi) as ClientAction;
    nextStepGives(playOut(live.state));
    vi.mocked(store.closeHand).mockResolvedValueOnce([-8, 8, 0, 0]);
    const snap = await actOnGame('g-1', 'u-abrar', move, live.version, T0 + 1000);
    expect(snap.scores).toEqual([-8, 8, 0, 0]);
    const logAt = vi.mocked(store.appendAction).mock.invocationCallOrder[0]!;
    const closeAt = vi.mocked(store.closeHand).mock.invocationCallOrder[0]!;
    const pokeAt = vi.mocked(broadcaster.broadcast).mock.invocationCallOrder[0]!;
    expect(logAt).toBeLessThan(closeAt);
    expect(closeAt).toBeLessThan(pokeAt);
  });

  it('when the hand log fails, still closes the hand; when closing fails, shows the scores as they stand', async () => {
    const live = setTable();
    db.room = { ...(db.room as RoomRow), ledger: [3, -3, 0, 0] };
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const move = analysisBot(viewFor(live.state, karachi, 0), karachi) as ClientAction;
    const ended = playOut(live.state);
    nextStepGives(ended);
    vi.mocked(store.appendAction).mockRejectedValueOnce(DOWN());
    vi.mocked(store.closeHand).mockRejectedValueOnce(DOWN());
    const snap = await actOnGame('g-1', 'u-abrar', move, live.version, T0 + 1000);
    expect(snap.version).toBe(live.version + 1);
    expect(snap.view.phase).toBe('finished');
    // The ledger write did not land, so the caller sees what the room holds, as the others will.
    expect(snap.scores).toEqual([3, -3, 0, 0]);
    expect(store.closeHand).toHaveBeenCalledWith('g-1', db.room, ended);
    expect(broadcaster.broadcast).toHaveBeenCalledTimes(1);
    expect(logged(log).map((l) => l['step'])).toEqual(['log the move', 'close the hand']);
  });

  it('leaves a game whose end did not record active, so the next "next hand" finishes it again', async () => {
    const live = setTable();
    const ended = playOut(live.state);
    db.live = { version: 7, state: ended, deadlines: { claim: null, turn: null } } satisfies LiveRow;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    nextStepGives(ended, true);
    vi.mocked(store.finishGame).mockRejectedValueOnce(DOWN());
    const failed = await actOnGame('g-1', 'u-abrar', { type: 'nextHand' }, 7, T0 + 1000);
    expect(failed.status).toBe('active');
    expect(failed.version).toBe(8);
    expect(broadcaster.broadcast).toHaveBeenCalledTimes(1);
    expect(logged(log)).toEqual([expect.objectContaining({ event: 'after_commit_failed', step: 'finish the game' })]);

    nextStepGives(ended, true);
    const done = await actOnGame('g-1', 'u-abrar', { type: 'nextHand' }, 7, T0 + 1000);
    expect(done.status).toBe('finished');
    expect(store.finishGame).toHaveBeenCalledTimes(2);
    expect(store.appendAction).not.toHaveBeenCalled();
    expect(store.closeHand).not.toHaveBeenCalled();
  });

  it('still fails outright, saving nothing, when the save itself fails', async () => {
    const live = setTable();
    vi.mocked(store.saveLive).mockRejectedValueOnce(new SupabaseError('save the table', { message: 'TypeError: fetch failed' }));
    await expect(actOnGame('g-1', 'u-abrar', null, null, expired(live))).rejects.toBeInstanceOf(SupabaseError);
    expect(broadcaster.broadcast).not.toHaveBeenCalled();
    expect(store.appendAction).not.toHaveBeenCalled();
  });

  it('fails outright, saving nothing, when the table cannot be read', async () => {
    setTable();
    vi.mocked(store.loadLive).mockRejectedValueOnce(new SupabaseError('read the table', { message: 'TypeError: fetch failed' }));
    await expect(actOnGame('g-1', 'u-abrar', null, null, T0)).rejects.toBeInstanceOf(SupabaseError);
    expect(store.saveLive).not.toHaveBeenCalled();
    expect(broadcaster.broadcast).not.toHaveBeenCalled();
  });
});

describe('standing up from a live table', () => {
  const two: Seats = [seats[0], { kind: 'human', userId: 'u-bea', name: 'Bea' }, seats[2], seats[3]];

  it('gives the seat up even when settling the bot that takes it fails, and logs that', async () => {
    setTable();
    db.room = { ...(db.room as RoomRow), seats: two };
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(store.saveSeats).mockResolvedValueOnce('2026-09-24T00:00:01Z');
    vi.mocked(store.loadLive).mockRejectedValueOnce(DOWN());
    await expect(leaveGame('g-1', 'u-abrar', T0)).resolves.toEqual({ abandoned: false });
    expect(store.saveSeats).toHaveBeenCalledTimes(1);
    expect(logged(log)).toEqual([expect.objectContaining({ event: 'leave_settle_failed', gameId: 'g-1', name: 'SupabaseError' })]);
  });

  it('does not log when someone else moved the table first', async () => {
    const live = setTable();
    db.room = { ...(db.room as RoomRow), seats: two };
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(store.saveSeats).mockResolvedValueOnce('2026-09-24T00:00:01Z');
    vi.mocked(store.saveLive).mockResolvedValueOnce(false);
    await expect(leaveGame('g-1', 'u-abrar', expired(live))).resolves.toEqual({ abandoned: false });
    expect(store.saveLive).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });
});
