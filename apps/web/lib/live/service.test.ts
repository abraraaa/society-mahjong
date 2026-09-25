import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analysisBot, karachi, reduce, viewFor, type HandState } from '@society/engine';
import type { GameRow, LiveRow, RoomRow } from './store';
import { dealFirstHand, deadlinesFor, settle, type StepResult } from './table';
import type { ClientAction, Seats } from './types';
import { policyFor } from './policy';
import { parseClientAction } from './validate';

/**
 * actOnGame against an in-memory store: who may tick a table (resolve its
 * expired clocks and read it back), who may act at it, and what happens when
 * the database fails after a move is saved. The store and the broadcaster
 * are faked, saving the table as a database would (the version goes up);
 * the table is the real one, and `step` is wrapped only so a test can hand
 * back a hand that has just ended.
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
  saveLive: vi.fn(async (_gameId: string, expectedVersion: number, state: unknown, deadlines: unknown) => {
    db.live = { version: expectedVersion + 1, state, deadlines };
    return true;
  }),
  stagesFor: vi.fn(async () => ['new']),
  appendAction: vi.fn(async () => {}),
  openHand: vi.fn(async () => {}),
  settleScores: vi.fn(async () => null),
  endHand: vi.fn(async () => {}),
  recordResult: vi.fn(async () => {}),
  countHand: vi.fn(async () => {}),
  recordHand: vi.fn(async () => {}),
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

import { HttpError, actOnGame, leaveGame, sweepGames, viewGame } from './service';
import { SupabaseError } from './errors';
import * as broadcaster from './broadcast';
import * as store from './store';
import * as table from './table';

const T0 = 1_700_000_000_000;
const policy = policyFor(['new']);
/** Game ids are uuids, as the database mints them. */
const GAME = '6f1c2a9e-4b7d-4e3a-9c5f-2d8b0a7e1f34';

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
  db.game = { id: GAME, room_id: 'r-1', seed: 'svc-1', status: 'active', hands_played: 0 } satisfies GameRow;
  db.room = {
    id: 'r-1',
    code: 'ABCD',
    host_id: 'u-hana',
    ruleset_id: 'karachi',
    options: {},
    status: 'playing',
    seats,
    current_game_id: GAME,
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

/** Seat 0's own play (the analysis bot's choice) until the hand ends, the bots answering between: each table seat 0 decided at, then the end. */
function tablesToEnd(state: HandState): HandState[] {
  const tables = [state];
  let s = state;
  for (let i = 0; i < 500 && s.phase !== 'finished'; i++) {
    const a = analysisBot(viewFor(s, karachi, 0), karachi) ?? { type: 'pass' as const, seat: 0 as const };
    s = settle(reduce(s, a, karachi), karachi, seats);
    tables.push(s);
  }
  expect(s.phase).toBe('finished');
  return tables;
}

function playOut(state: HandState): HandState {
  return tablesToEnd(state).at(-1)!;
}

/** The next call to step hands back `state` as the table after the move. */
function nextStepGives(state: HandState, gameOver = false): void {
  vi.mocked(table.step).mockImplementationOnce((): StepResult => ({ state, deadlines: { claim: null, turn: null }, changed: true, gameOver, standIns: [] }));
}

const DOWN = () => new SupabaseError('write', { message: 'TypeError: fetch failed' });

/** The five writes that close a hand, in the order they run, by the name each has in the log. */
const CLOSING = [
  ['settle the scores', () => store.settleScores],
  ['close the hand', () => store.endHand],
  ['record the result', () => store.recordResult],
  ['count the hand', () => store.countHand],
  ['tally the players', () => store.recordHand],
] as const;
const closers = () => CLOSING.map(([, fn]) => vi.mocked(fn()));

/** The last hand of the North round, over: after it there is no hand left to deal. */
function lastHand(state: HandState): HandState {
  return { ...playOut(state), progress: { roundWind: 'N', roundIndex: 3, handInRound: 3, handIndex: 15 } };
}

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
    const err = await rejection(actOnGame(GAME, 'u-zed', null, null, expired(live)));
    expect(err.status).toBe(403);
    expect(err.body).toBeUndefined();
    expect(store.loadLive).not.toHaveBeenCalled();
    expect(store.saveLive).not.toHaveBeenCalled();
  });

  it('lets a seated player resolve an expired clock and see their own hand', async () => {
    const live = setTable();
    const snap = await actOnGame(GAME, 'u-abrar', null, null, expired(live));
    expect(store.saveLive).toHaveBeenCalledTimes(1);
    expect(snap.version).toBe(live.version + 1);
    expect(snap.me).toBe(0);
    expect(snap.view.seq).toBeGreaterThan(live.state.seq);
  });

  it('lets the host tick without a seat, and shows them only the public table', async () => {
    const live = setTable();
    const snap = await actOnGame(GAME, 'u-hana', null, null, expired(live));
    expect(store.saveLive).toHaveBeenCalledTimes(1);
    expect(snap.me).toBeNull();
    expect(snap.isHost).toBe(true);
    expect('me' in snap.view).toBe(false);
  });

  it('still lets the server itself sweep a table with nobody signed in', async () => {
    const live = setTable();
    const snap = await actOnGame(GAME, null, null, null, expired(live));
    expect(store.saveLive).toHaveBeenCalledTimes(1);
    expect(snap.me).toBeNull();
  });

  it('writes nothing when a seated player ticks before any clock has run out', async () => {
    const live = setTable();
    const snap = await actOnGame(GAME, 'u-abrar', null, null, T0 + 1000);
    expect(store.saveLive).not.toHaveBeenCalled();
    expect(snap.version).toBe(live.version);
  });
});

describe('a game id that could never be one', () => {
  it('is "no such game" to view, tick, act and leave, before any query is made', async () => {
    setTable();
    // What the database says when a uuid column is filtered by something that is not one: a failure, not "nothing there".
    vi.mocked(store.gameById).mockRejectedValue(new SupabaseError('read the game', { message: 'invalid input syntax for type uuid: "not-a-uuid"', code: '22P02' }));
    try {
      const calls = [
        () => viewGame('not-a-uuid', 'u-abrar', T0),
        () => actOnGame('not-a-uuid', 'u-abrar', null, null, T0),
        () => actOnGame('not-a-uuid', 'u-abrar', { type: 'pass', seat: 0 }, 3, T0),
        () => leaveGame('not-a-uuid', 'u-abrar', T0),
      ];
      for (const call of calls) {
        const err = await rejection(call());
        expect(err.status).toBe(404);
        expect(err.message).toBe('no such game');
      }
      expect(store.gameById).not.toHaveBeenCalled();
      expect(store.roomById).not.toHaveBeenCalled();
      expect(store.loadLive).not.toHaveBeenCalled();
    } finally {
      vi.mocked(store.gameById).mockReset();
    }
  });
});

describe('acting at a table', () => {
  it('needs a seat: a stranger and a seatless host are both refused', async () => {
    setTable();
    const pass: ClientAction = { type: 'pass', seat: 0 };
    for (const who of ['u-zed', 'u-hana']) {
      const err = await rejection(actOnGame(GAME, who, pass, 3, T0));
      expect(err.status).toBe(403);
    }
    expect(store.saveLive).not.toHaveBeenCalled();
  });

  it('refuses resolveClaims from a seated player, whatever seat it names, before reading anything', async () => {
    setTable();
    const forged = { type: 'resolveClaims', seat: 0 } as unknown as ClientAction;
    const err = await rejection(actOnGame(GAME, 'u-abrar', forged, 3, T0));
    expect(err.status).toBe(400);
    expect(store.gameById).not.toHaveBeenCalled();
    expect(store.saveLive).not.toHaveBeenCalled();
    expect(store.appendAction).not.toHaveBeenCalled();
  });

  it('refuses a move of the wrong shape, whoever calls, before reading anything', async () => {
    setTable();
    const bent = { type: 'discard', seat: 0, tile: 'not-a-tile' } as unknown as ClientAction;
    const err = await rejection(actOnGame(GAME, 'u-abrar', bent, 3, T0));
    expect(err.status).toBe(400);
    expect(store.gameById).not.toHaveBeenCalled();
  });

  it('refuses "next hand" on a hand that was still live when the sender saw it, even with its clock run out', async () => {
    const live = setTable();
    // Seat 0's last decision of the hand: left to the clock, the stand-in makes it and the hand ends.
    const last = tablesToEnd(live.state).at(-2)!;
    db.live = { version: 3, state: last, deadlines: deadlinesFor(last, karachi, seats, policy, T0) } satisfies LiveRow;
    const late = expired(db.live as LiveRow);

    const err = await rejection(actOnGame(GAME, 'u-abrar', { type: 'nextHand' }, 3, late));
    expect(err.status).toBe(400);
    expect(store.saveLive).not.toHaveBeenCalled();
    expect(store.openHand).not.toHaveBeenCalled();

    // A tick instead ends the hand and records it, so it is not lost.
    const snap = await actOnGame(GAME, 'u-abrar', null, null, late);
    expect(snap.view.phase).toBe('finished');
    expect(snap.view.progress.handIndex).toBe(live.state.progress.handIndex);
    for (const write of closers()) expect(write).toHaveBeenCalledTimes(1);
    expect(store.openHand).not.toHaveBeenCalled();
  });

  it('logs the move as validated, never whatever else the object carried', async () => {
    const live = setTable();
    const move = analysisBot(viewFor(live.state, karachi, 0), karachi) as ClientAction;
    const padded = { ...move, note: 'hello from the client' } as unknown as ClientAction;
    await actOnGame(GAME, 'u-abrar', padded, live.version, T0 + 1000);
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
    const snap = await actOnGame(GAME, 'u-abrar', move, live.version, T0 + 1000);
    expect(snap.version).toBe(live.version + 1);
    expect(snap.me).toBe(0);
    expect(snap.view.seq).toBeGreaterThan(live.state.seq);
    expect(store.saveLive).toHaveBeenCalledTimes(1);
    expect(broadcaster.broadcast).toHaveBeenCalledTimes(1);
    expect(broadcaster.gamePoke).toHaveBeenCalledWith(GAME, live.version + 1, expect.anything());
    expect(logged(log)).toEqual([
      expect.objectContaining({
        level: 'error',
        event: 'after_commit_failed',
        step: 'log the move',
        gameId: GAME,
        version: live.version + 1,
        name: 'SupabaseError',
        message: 'could not log the move: TypeError: fetch failed',
      }),
    ]);
  });

  it("writes the hand log, then each of the hand's closing writes, before it pokes, so the others refetch a settled table", async () => {
    const live = setTable();
    const move = analysisBot(viewFor(live.state, karachi, 0), karachi) as ClientAction;
    const ended = playOut(live.state);
    nextStepGives(ended);
    vi.mocked(store.settleScores).mockResolvedValueOnce([-8, 8, 0, 0]);
    const snap = await actOnGame(GAME, 'u-abrar', move, live.version, T0 + 1000);
    expect(snap.scores).toEqual([-8, 8, 0, 0]);
    expect(store.settleScores).toHaveBeenCalledWith(GAME, db.room, ended);
    expect(store.endHand).toHaveBeenCalledWith(GAME, ended);
    expect(store.recordResult).toHaveBeenCalledWith(GAME, ended);
    expect(store.countHand).toHaveBeenCalledWith(GAME);
    expect(store.recordHand).toHaveBeenCalledWith(seats, ended);
    const order = [store.appendAction, ...CLOSING.map(([, fn]) => fn()), broadcaster.broadcast].map((fn) => vi.mocked(fn).mock.invocationCallOrder[0]!);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('when the hand log fails, still closes the hand; when the scores fail to settle, shows them as the room holds them', async () => {
    const live = setTable();
    db.room = { ...(db.room as RoomRow), ledger: [3, -3, 0, 0] };
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const move = analysisBot(viewFor(live.state, karachi, 0), karachi) as ClientAction;
    nextStepGives(playOut(live.state));
    vi.mocked(store.appendAction).mockRejectedValueOnce(DOWN());
    vi.mocked(store.settleScores).mockRejectedValueOnce(DOWN());
    const snap = await actOnGame(GAME, 'u-abrar', move, live.version, T0 + 1000);
    expect(snap.version).toBe(live.version + 1);
    expect(snap.view.phase).toBe('finished');
    // The ledger write did not land, so the caller sees what the room holds, as the others will.
    expect(snap.scores).toEqual([3, -3, 0, 0]);
    // The hand's other writes do not depend on the scores, and still run.
    for (const write of closers()) expect(write).toHaveBeenCalledTimes(1);
    expect(broadcaster.broadcast).toHaveBeenCalledTimes(1);
    expect(logged(log).map((l) => l['step'])).toEqual(['log the move', 'settle the scores']);
  });

  it.each(CLOSING.slice(1).map(([what]) => what))('when "%s" fails after the scores have settled, shows the settled scores and still runs the rest', async (what) => {
    const live = setTable();
    db.room = { ...(db.room as RoomRow), ledger: [3, -3, 0, 0] };
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    nextStepGives(playOut(live.state));
    vi.mocked(store.settleScores).mockResolvedValueOnce([-5, 5, 0, 0]);
    const failing = CLOSING.find(([w]) => w === what)![1]();
    vi.mocked(failing).mockRejectedValueOnce(DOWN());
    const snap = await actOnGame(GAME, 'u-abrar', null, null, expired(live));
    // What the room now holds, as the others will see it on their refetch.
    expect(snap.scores).toEqual([-5, 5, 0, 0]);
    for (const write of closers()) expect(write).toHaveBeenCalledTimes(1);
    expect(broadcaster.broadcast).toHaveBeenCalledTimes(1);
    expect(logged(log)).toEqual([expect.objectContaining({ event: 'after_commit_failed', step: what })]);
  });

  it('keeps the totals it read when the room has already moved on to another game and took no scores', async () => {
    const live = setTable();
    db.room = { ...(db.room as RoomRow), ledger: [3, -3, 0, 0] };
    nextStepGives(playOut(live.state));
    vi.mocked(store.settleScores).mockResolvedValueOnce(null);
    const snap = await actOnGame(GAME, 'u-abrar', null, null, expired(live));
    expect(snap.scores).toEqual([3, -3, 0, 0]);
  });

  it('leaves a game whose end did not record active, so the next "next hand" finishes it again', async () => {
    const live = setTable();
    db.live = { version: 7, state: lastHand(live.state), deadlines: { claim: null, turn: null } } satisfies LiveRow;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.mocked(store.finishGame).mockRejectedValueOnce(DOWN());
    const failed = await actOnGame(GAME, 'u-abrar', { type: 'nextHand' }, 7, T0 + 1000);
    expect(failed.status).toBe('active');
    expect(failed.version).toBe(8);
    expect(failed.view.phase).toBe('finished');
    expect(failed.view.progress.handIndex).toBe(15);
    expect((db.live as LiveRow).version).toBe(8);
    expect(broadcaster.broadcast).toHaveBeenCalledTimes(1);
    expect(logged(log)).toEqual([expect.objectContaining({ event: 'after_commit_failed', step: 'finish the game' })]);

    // The table the caller was handed, still the last hand's result, is the one they press "next hand" on again.
    const done = await actOnGame(GAME, 'u-abrar', { type: 'nextHand' }, failed.version, T0 + 2000);
    expect(done.status).toBe('finished');
    expect(done.version).toBe(9);
    expect(store.finishGame).toHaveBeenCalledTimes(2);
    expect(store.finishGame).toHaveBeenLastCalledWith(GAME, 'r-1');
    // The real table decided both times that there was no hand left to deal.
    expect(vi.mocked(table.step).mock.results.map((r) => (r.value as StepResult).gameOver)).toEqual([true, true]);
    expect(store.openHand).not.toHaveBeenCalled();
    expect(store.appendAction).not.toHaveBeenCalled();
    for (const write of closers()) expect(write).not.toHaveBeenCalled();
  });

  it('still fails outright, saving nothing, when the save itself fails', async () => {
    const live = setTable();
    vi.mocked(store.saveLive).mockRejectedValueOnce(new SupabaseError('save the table', { message: 'TypeError: fetch failed' }));
    await expect(actOnGame(GAME, 'u-abrar', null, null, expired(live))).rejects.toBeInstanceOf(SupabaseError);
    expect(broadcaster.broadcast).not.toHaveBeenCalled();
    expect(store.appendAction).not.toHaveBeenCalled();
  });

  it('fails outright, saving nothing, when the table cannot be read', async () => {
    setTable();
    vi.mocked(store.loadLive).mockRejectedValueOnce(new SupabaseError('read the table', { message: 'TypeError: fetch failed' }));
    await expect(actOnGame(GAME, 'u-abrar', null, null, T0)).rejects.toBeInstanceOf(SupabaseError);
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
    await expect(leaveGame(GAME, 'u-abrar', T0)).resolves.toEqual({ abandoned: false });
    expect(store.saveSeats).toHaveBeenCalledTimes(1);
    expect(logged(log)).toEqual([expect.objectContaining({ event: 'leave_settle_failed', gameId: GAME, name: 'SupabaseError' })]);
  });

  it('leaves the game active when abandoning it fails part way, so standing up again finishes the job', async () => {
    setTable();
    vi.mocked(store.abandonGame).mockRejectedValueOnce(DOWN());
    await expect(leaveGame(GAME, 'u-abrar', T0)).rejects.toBeInstanceOf(SupabaseError);
    await expect(leaveGame(GAME, 'u-abrar', T0)).resolves.toEqual({ abandoned: true });
    expect(store.abandonGame).toHaveBeenCalledTimes(2);
    expect(store.abandonGame).toHaveBeenLastCalledWith(GAME, 'r-1');
  });

  it('gives up no seat when the host has already dealt a newer game than the one being left', async () => {
    setTable();
    db.room = { ...(db.room as RoomRow), seats: two, current_game_id: '0d3e5f7a-9b1c-4d2e-8f6a-1b3c5d7e9f02' };
    await expect(leaveGame(GAME, 'u-abrar', T0)).resolves.toEqual({ abandoned: false });
    expect(store.saveSeats).not.toHaveBeenCalled();
    expect(store.abandonGame).not.toHaveBeenCalled();
    expect(broadcaster.broadcast).not.toHaveBeenCalled();
  });

  it('does not log when someone else moved the table first', async () => {
    const live = setTable();
    db.room = { ...(db.room as RoomRow), seats: two };
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(store.saveSeats).mockResolvedValueOnce('2026-09-24T00:00:01Z');
    vi.mocked(store.saveLive).mockResolvedValueOnce(false);
    await expect(leaveGame(GAME, 'u-abrar', expired(live))).resolves.toEqual({ abandoned: false });
    expect(store.saveLive).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });
});

describe('the daily sweep', () => {
  const OTHER = '0d3e5f7a-9b1c-4d2e-8f6a-1b3c5d7e9f02';

  it('settles each table past its clock and says so', async () => {
    const live = setTable();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await sweepGames([GAME], expired(live))).toEqual({ [GAME]: 'ok' });
    expect(store.saveLive).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });

  it('does not log a table someone else moved first, or one that ended since the sweep looked', async () => {
    const live = setTable();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(store.saveLive).mockResolvedValueOnce(false);
    expect(await sweepGames([GAME], expired(live))).toEqual({ [GAME]: 'already moved' });

    db.game = { ...(db.game as GameRow), status: 'finished' };
    expect(await sweepGames([GAME], expired(live))).toEqual({ [GAME]: 'already moved' });
    expect(log).not.toHaveBeenCalled();
  });

  it('logs a table it could not settle, and still sweeps the rest', async () => {
    const live = setTable();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(store.loadLive).mockRejectedValueOnce(DOWN());
    const results = await sweepGames([OTHER, GAME], expired(live));
    expect(results).toEqual({ [OTHER]: 'could not write: TypeError: fetch failed', [GAME]: 'ok' });
    expect(logged(log)).toEqual([expect.objectContaining({ event: 'sweep_game_failed', route: '/api/cron/sweep', gameId: OTHER, name: 'SupabaseError' })]);
  });
});
