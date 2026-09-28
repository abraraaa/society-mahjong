import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analysisBot, karachi, reduce, startHand, viewFor, type GameProgress, type HandState } from '@society/engine';
import type { GameRow, LiveRow, RoomRow } from './store';
import type { HandWrite, TableWrite } from './hand-log';
import { dealFirstHand, deadlinesFor, settle, type StepResult } from './table';
import type { GameOver, TableState } from './table-state';
import type { ClientAction, Deadlines, Seats } from './types';
import { policyFor } from './policy';
import { parseClientAction } from './validate';

/**
 * actOnGame against an in-memory store: who may tick a table (resolve its
 * expired clocks and read it back), who may act at it, what one request saves
 * (one commit_table call: the state, the running totals, the clocks and every
 * move it made), and what happens when the database fails after that commit.
 * The store and the broadcaster are faked, the store committing as the
 * database would: the version goes up only when nobody saved first, and
 * acted_at moves only for a person's request. The table is the real one;
 * `step`, `afterCommit` and `wakeAt` are wrapped only so a test can see what
 * they were given.
 */
const db = vi.hoisted(() => ({
  game: null as unknown,
  room: null as unknown,
  live: null as unknown,
  /** how many of the next commits someone else saves first */
  lose: 0,
  /** the database's own clock, which stamps acted_at and updated_at */
  now: 1_700_000_500_000,
}));

vi.mock('server-only', () => ({}));
vi.mock('./store', () => ({
  gameById: vi.fn(async () => db.game),
  roomById: vi.fn(async () => db.room),
  loadLive: vi.fn(async () => db.live),
  commitTable: vi.fn(async (_gameId: string, expectedVersion: number, w: TableWrite) => {
    const live = db.live as LiveRow;
    if (db.lose > 0) {
      // Someone else's request lands first, and this one writes nothing.
      db.lose -= 1;
      db.live = { ...live, version: live.version + 1 };
      return null;
    }
    if (live.version !== expectedVersion) return null;
    db.live = {
      version: expectedVersion + 1,
      state: w.state,
      deadlines: w.deadlines,
      table: w.table,
      legacy: false,
      wakeAt: w.wakeAt,
      actedAt: w.acted ? db.now : live.actedAt,
      updatedAt: db.now,
    } satisfies LiveRow;
    return expectedVersion + 1;
  }),
  stagesBySeat: vi.fn(async (seats: readonly ({ kind: string } | null)[]) => seats.map((s) => (s?.kind === 'human' ? 'new' : null))),
  liveMeta: vi.fn(async () => {
    const live = db.live as LiveRow | null;
    return (
      live && {
        version: live.version,
        table: live.table,
        legacy: live.legacy,
        actedAt: live.actedAt,
        updatedAt: live.updatedAt,
        hand: live.state.progress.handIndex,
        seq: live.state.seq,
      }
    );
  }),
  countHand: vi.fn(async () => {}),
  recordHand: vi.fn(async () => {}),
  finishGame: vi.fn(async () => {}),
  saveSeats: vi.fn(async () => null),
  roomByCode: vi.fn(async () => null),
}));
vi.mock('./table', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./table')>();
  return { ...actual, step: vi.fn(actual.step) };
});
vi.mock('./commit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./commit')>();
  return { ...actual, afterCommit: vi.fn(actual.afterCommit) };
});
vi.mock('./table-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./table-state')>();
  return { ...actual, wakeAt: vi.fn(actual.wakeAt) };
});
vi.mock('./broadcast', () => ({
  broadcast: vi.fn(async () => {}),
  gamePoke: vi.fn(() => ({ topic: 't', event: 'e', payload: {} })),
  roomPoke: vi.fn(() => ({ topic: 't', event: 'e', payload: {} })),
}));

import { HttpError, actOnGame, leaveGame, settleRoomGame, sweepGames, viewGame } from './service';
import { SupabaseError } from './errors';
import * as broadcaster from './broadcast';
import * as commit from './commit';
import * as store from './store';
import * as table from './table';
import * as tableState from './table-state';

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

/** A v1 table with nobody on any points yet, last moved by a person at T0. */
const FRESH: TableState = { v: 1, scores: [0, 0, 0, 0], over: null, extra: {} };

/** The live row for a table at `state`, as loadLive reads it. */
function liveRow(state: HandState, deadlines: Deadlines, extra: Partial<LiveRow> = {}): LiveRow {
  return { version: 3, state, deadlines, table: FRESH, legacy: false, wakeAt: null, actedAt: T0, updatedAt: T0, ...extra };
}

function setTable(): LiveRow {
  const first = dealFirstHand(karachi, seats, 'svc-1', policy, T0);
  const live = liveRow(first.state, first.deadlines);
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
  db.lose = 0;
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

/** Seat 0's own play (the analysis bot's choice) until the hand ends, the bots answering sharply between: each table seat 0 decided at, then the end. */
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

/**
 * The hand's last decision, left to the clock: the table as seat 0 is about to make it, on this seed Abrar's winning move.
 * With everyone solid the bots play sharp, so a tick past its clock plays the hand out exactly as `tablesToEnd` did.
 */
function lastDecision(live: LiveRow, extra: Partial<LiveRow> = {}): { live: LiveRow; ended: HandState; late: number } {
  const tables = tablesToEnd(live.state);
  const last = tables.at(-2)!;
  const at = liveRow(last, deadlinesFor(last, karachi, seats, policy, T0), extra);
  db.live = at;
  vi.mocked(store.stagesBySeat).mockResolvedValue(['solid', null, null, null]);
  return { live: at, ended: tables.at(-1)!, late: expired(at) };
}

/** The totals with a won hand's transfers added, worked out here rather than by the code under test. */
function plus(scores: readonly number[], s: HandState): number[] {
  const next = [...scores];
  if (s.result?.type === 'win') for (const t of s.result.settlement.transfers) ((next[t.from]! -= t.amount), (next[t.to]! += t.amount));
  return next;
}

/** Every commit made so far: the version it expected, and what it wrote. */
function commits(): { expected: number; w: TableWrite }[] {
  return vi.mocked(store.commitTable).mock.calls.map(([, expected, w]) => ({ expected, w }));
}

/** The one commit made so far, and its one hand entry. */
function theCommit(): { expected: number; w: TableWrite; hand: HandWrite } {
  const all = commits();
  expect(all).toHaveLength(1);
  const [c] = all;
  expect(c!.w.hands).toHaveLength(1);
  return { ...c!, hand: c!.w.hands[0]! };
}

/** The steps run after each commit so far, by the name each has in the log. */
function afterSteps(): string[][] {
  return vi.mocked(commit.afterCommit).mock.calls.map(([steps]) => steps.map((x) => x.what));
}

/** The last hand of the North round, over: after it there is no hand left to deal. */
function lastHand(state: HandState): HandState {
  return { ...playOut(state), progress: { roundWind: 'N', roundIndex: 3, handInRound: 3, handIndex: 15 } };
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
  vi.mocked(store.stagesBySeat).mockImplementation(async (s) => s.map((x) => (x?.kind === 'human' ? 'new' : null)));
});

describe('ticking a table', () => {
  it('refuses a stranger with the game id: no clock resolves and no table comes back', async () => {
    const live = setTable();
    const err = await rejection(actOnGame(GAME, 'u-zed', null, null, expired(live)));
    expect(err.status).toBe(403);
    expect(err.body).toBeUndefined();
    expect(store.loadLive).not.toHaveBeenCalled();
    expect(store.commitTable).not.toHaveBeenCalled();
  });

  it('lets a seated player resolve an expired clock and see their own hand', async () => {
    const live = setTable();
    const snap = await actOnGame(GAME, 'u-abrar', null, null, expired(live));
    expect(store.commitTable).toHaveBeenCalledTimes(1);
    expect(snap.version).toBe(live.version + 1);
    expect(snap.me).toBe(0);
    expect(snap.view.seq).toBeGreaterThan(live.state.seq);
  });

  it('lets the host tick without a seat, and shows them only the public table', async () => {
    const live = setTable();
    const snap = await actOnGame(GAME, 'u-hana', null, null, expired(live));
    expect(store.commitTable).toHaveBeenCalledTimes(1);
    expect(snap.me).toBeNull();
    expect(snap.isHost).toBe(true);
    expect('me' in snap.view).toBe(false);
  });

  it('still lets the server itself sweep a table with nobody signed in', async () => {
    const live = setTable();
    const snap = await actOnGame(GAME, null, null, null, expired(live));
    expect(store.commitTable).toHaveBeenCalledTimes(1);
    expect(snap.me).toBeNull();
  });

  it('writes nothing when a seated player ticks before any clock has run out', async () => {
    const live = setTable();
    const snap = await actOnGame(GAME, 'u-abrar', null, null, T0 + 1000);
    expect(store.commitTable).not.toHaveBeenCalled();
    expect(commit.afterCommit).not.toHaveBeenCalled();
    expect(broadcaster.broadcast).not.toHaveBeenCalled();
    expect(snap.version).toBe(live.version);
  });
});

describe("each player's level", () => {
  it('gives a seated caller their own level, and an unseated host none, reading levels alongside the table', async () => {
    setTable();
    vi.mocked(store.stagesBySeat).mockResolvedValueOnce(['learning', null, null, null]);
    expect((await viewGame(GAME, 'u-abrar', T0)).stage).toBe('learning');
    vi.mocked(store.stagesBySeat).mockResolvedValueOnce(['solid', null, null, null]);
    expect((await viewGame(GAME, 'u-hana', T0)).stage).toBeNull();
  });

  it('plays the empty seats gently while anyone seated is new, and sharp once everyone is solid', async () => {
    const live = setTable();
    vi.mocked(store.stagesBySeat).mockResolvedValueOnce(['new', null, null, null]);
    await actOnGame(GAME, 'u-abrar', null, null, expired(live));
    expect(vi.mocked(table.step).mock.calls.at(-1)![0].bots).toBe('gentle');
    setTable();
    vi.mocked(store.stagesBySeat).mockResolvedValueOnce(['solid', null, null, null]);
    await actOnGame(GAME, 'u-abrar', null, null, expired(live));
    expect(vi.mocked(table.step).mock.calls.at(-1)![0].bots).toBe('sharp');
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
    expect(store.commitTable).not.toHaveBeenCalled();
  });

  it('refuses resolveClaims from a seated player, whatever seat it names, before reading anything', async () => {
    setTable();
    const forged = { type: 'resolveClaims', seat: 0 } as unknown as ClientAction;
    const err = await rejection(actOnGame(GAME, 'u-abrar', forged, 3, T0));
    expect(err.status).toBe(400);
    expect(store.gameById).not.toHaveBeenCalled();
    expect(store.commitTable).not.toHaveBeenCalled();
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
    db.live = liveRow(last, deadlinesFor(last, karachi, seats, policy, T0));
    const late = expired(db.live as LiveRow);

    const err = await rejection(actOnGame(GAME, 'u-abrar', { type: 'nextHand' }, 3, late));
    expect(err.status).toBe(400);
    expect(store.commitTable).not.toHaveBeenCalled();

    // A tick instead ends the hand and records it, with the move that ended it, so it is not lost.
    const snap = await actOnGame(GAME, 'u-abrar', null, null, late);
    expect(snap.view.phase).toBe('finished');
    expect(snap.view.progress.handIndex).toBe(live.state.progress.handIndex);
    const { hand } = theCommit();
    expect(hand).toMatchObject({ hand: live.state.progress.handIndex, ended: true });
    expect(hand.result).not.toBeNull();
    expect(store.countHand).toHaveBeenCalledTimes(1);
    expect(store.recordHand).toHaveBeenCalledTimes(1);
  });

  it('logs the move as validated, never whatever else the object carried', async () => {
    const live = setTable();
    const move = analysisBot(viewFor(live.state, karachi, 0), karachi) as ClientAction;
    const padded = { ...move, note: 'hello from the client' } as unknown as ClientAction;
    await actOnGame(GAME, 'u-abrar', padded, live.version, T0 + 1000);
    const { hand } = theCommit();
    expect(hand.hand).toBe(live.state.progress.handIndex);
    expect(hand.moves[0]!.a).toEqual(parseClientAction(move));
    expect(hand.moves[0]!.a).not.toHaveProperty('note');
  });
});

describe('one request, one commit', () => {
  it('saves a move as one commit made by a person: the move, then every bot move after it, all at the new version', async () => {
    const live = setTable();
    const move = analysisBot(viewFor(live.state, karachi, 0), karachi) as ClientAction;
    const snap = await actOnGame(GAME, 'u-abrar', move, live.version, T0 + 1000);
    const { expected, w, hand } = theCommit();
    expect(expected).toBe(live.version);
    expect(w.acted).toBe(true);
    expect(hand).toMatchObject({ hand: 0, dealer: live.state.dealer, progress: live.state.progress, result: null, ended: false });
    const [mine, ...after] = hand.moves;
    expect(mine).toEqual({ v: live.version + 1, by: 'player', seat: 0, userId: 'u-abrar', a: move });
    expect(after.length).toBeGreaterThan(0);
    for (const m of after) {
      expect(m.v).toBe(live.version + 1);
      expect(m.userId).toBeUndefined();
      expect(m.by === 'bot' ? m.seat !== 0 : m.by === 'table' && m.seat === 0 && m.a.type === 'pass', JSON.stringify(m)).toBe(true);
    }
    expect(after.some((m) => m.by === 'bot')).toBe(true);
    // Saved as the table stands after the step, which is the table the caller is handed.
    expect(w.state.seq).toBe(snap.view.seq);
    expect(w.deadlines).toEqual(snap.deadlines);
    expect(snap.version).toBe(live.version + 1);
    // The wake time is the earliest clock: the one now waiting on Abrar.
    const clocks = [w.deadlines.claim, w.deadlines.turn].filter((t): t is number => t !== null);
    expect(clocks.length).toBeGreaterThan(0);
    expect(w.wakeAt).toBe(Math.min(...clocks));
    // Nothing else to write: no hand ended, and the game goes on.
    expect(afterSteps()).toEqual([[]]);
  });

  it('saves a tick that resolves a clock as nobody’s move', async () => {
    const live = setTable();
    await actOnGame(GAME, 'u-abrar', null, null, expired(live));
    const { w, hand } = theCommit();
    expect(w.acted).toBe(false);
    expect(hand.moves[0]).toMatchObject({ v: live.version + 1, by: 'clock', seat: 0 });
    expect(hand.moves[0]).not.toHaveProperty('userId');
  });

  it('saves the next hand’s deal with a new hand entry of its own index, dealer and progress', async () => {
    const live = setTable();
    const done = playOut(live.state);
    db.live = liveRow(done, { claim: null, turn: null }, { version: 5 });
    const snap = await actOnGame(GAME, 'u-abrar', { type: 'nextHand' }, 5, T0 + 1000);
    const { w, hand } = theCommit();
    const dealt = vi.mocked(table.step).mock.results.at(-1)!.value as StepResult;
    expect(dealt.state.progress.handIndex).toBe(1);
    expect(hand).toMatchObject({ hand: 1, dealer: dealt.state.dealer, progress: dealt.state.progress, result: null, ended: false });
    expect(hand.dealer).not.toBe(done.dealer);
    // Hand 1's dealer is a bot, so the bots have moved before Abrar's first decision; those moves open the new hand's log.
    expect(hand.moves.length).toBeGreaterThan(0);
    expect(hand.moves.every((m) => m.v === 6 && m.by !== 'player')).toBe(true);
    expect(w.acted).toBe(true);
    expect(snap.view.progress.handIndex).toBe(1);
    expect(afterSteps()).toEqual([[]]);
  });

  it('saves a hand that finishes with its result, its end and the new totals, then counts and tallies it before the poke', async () => {
    const live = setTable();
    const { ended, late } = lastDecision(live, { table: { v: 1, scores: [3, -3, 0, 0], over: null, extra: {} } });
    expect(ended.result?.type).toBe('win');
    const snap = await actOnGame(GAME, 'u-abrar', null, null, late);
    const { w, hand } = theCommit();
    expect(hand).toMatchObject({ hand: 0, ended: true });
    expect(hand.result).toEqual(ended.result);
    expect(w.table.scores).toEqual(plus([3, -3, 0, 0], ended));
    expect(w.table.scores).not.toEqual([3, -3, 0, 0]);
    expect(snap.scores).toEqual(w.table.scores);
    expect(snap.view.phase).toBe('finished');
    // A finished hand waits on nobody, so there's nothing to wake for.
    expect(w.deadlines).toEqual({ claim: null, turn: null });
    expect(w.wakeAt).toBeNull();
    expect(afterSteps()).toEqual([['count the hand', 'tally the players']]);
    expect(store.countHand).toHaveBeenCalledWith(GAME);
    expect(store.recordHand).toHaveBeenCalledWith(seats, ended);
    expect(store.finishGame).not.toHaveBeenCalled();
    const order = [store.commitTable, store.countHand, store.recordHand, broadcaster.broadcast].map((fn) => vi.mocked(fn).mock.invocationCallOrder[0]!);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('gives a lost commit 409 with a fresh table, and runs nothing after it: no bookkeeping, no poke', async () => {
    const live = setTable();
    const { late } = lastDecision(live);
    db.lose = 1;
    const err = await rejection(actOnGame(GAME, 'u-abrar', null, null, late));
    expect(err.status).toBe(409);
    expect(err.message).toBe('lost the race');
    // The table as the other request left it.
    expect((err.body as { version: number }).version).toBe(live.version + 1);
    expect(store.commitTable).toHaveBeenCalledTimes(1);
    expect(commit.afterCommit).not.toHaveBeenCalled();
    expect(store.countHand).not.toHaveBeenCalled();
    expect(store.recordHand).not.toHaveBeenCalled();
    expect(broadcaster.broadcast).not.toHaveBeenCalled();
  });
});

describe('the running totals', () => {
  it('seeds a legacy table’s totals from rooms.ledger, in the snapshot and in the commit that saves them', async () => {
    const live = setTable();
    db.room = { ...(db.room as RoomRow), ledger: [3, -3, 0, 0] };
    db.live = { ...live, table: { v: 1, scores: null, over: null, extra: {} }, legacy: true };
    expect((await viewGame(GAME, 'u-abrar', T0)).scores).toEqual([3, -3, 0, 0]);
    const snap = await actOnGame(GAME, 'u-abrar', null, null, expired(live));
    expect(snap.scores).toEqual([3, -3, 0, 0]);
    expect(theCommit().w.table).toEqual({ v: 1, scores: [3, -3, 0, 0], over: null, extra: {} });
    // Saved, the table is its own from now on.
    expect(db.live).toMatchObject({ legacy: false, table: { scores: [3, -3, 0, 0] } });
  });

  it('reads the totals from the table once it has a "v", never from rooms.ledger', async () => {
    const live = setTable();
    db.room = { ...(db.room as RoomRow), ledger: [9, 9, 9, 9] };
    db.live = { ...live, table: { v: 1, scores: [5, -5, 0, 0], over: null, extra: {} } };
    expect((await viewGame(GAME, 'u-abrar', T0)).scores).toEqual([5, -5, 0, 0]);
    const snap = await actOnGame(GAME, 'u-abrar', null, null, expired(live));
    expect(snap.scores).toEqual([5, -5, 0, 0]);
    expect(theCommit().w.table.scores).toEqual([5, -5, 0, 0]);
  });

  it('never saves over a table a newer deploy wrote: 503, logged as table_state_newer, and nothing committed', async () => {
    const live = setTable();
    db.live = { ...live, table: { v: 2, scores: [5, -5, 0, 0], over: null, extra: { absence: [] } } };
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = await rejection(actOnGame(GAME, 'u-abrar', null, null, expired(live)));
    expect(err.status).toBe(503);
    expect(err.message).toBe('something went wrong');
    expect(store.commitTable).not.toHaveBeenCalled();
    expect(logged(log)).toEqual([expect.objectContaining({ event: 'table_state_newer', gameId: GAME, version: live.version })]);
    // Looking is still fine.
    expect((await viewGame(GAME, 'u-abrar', T0)).scores).toEqual([5, -5, 0, 0]);
  });
});

describe('when a person last moved the table', () => {
  const wokeFrom = () => vi.mocked(tableState.wakeAt).mock.calls.map(([x]) => x.actedAt);

  it('carries a legacy table’s recent last save forward as a person’s move on its first commit', async () => {
    const live = setTable();
    const now = expired(live);
    // Older code never wrote acted_at (the migration gave it its own time), but it stamped updated_at on every save.
    db.live = { ...live, table: { v: 1, scores: null, over: null, extra: {} }, legacy: true, actedAt: now - 30 * 24 * 3600_000, updatedAt: now - 10 * 60_000 };
    await actOnGame(GAME, null, null, null, now);
    expect(theCommit().w.acted).toBe(true);
    expect(wokeFrom()).toEqual([now]);
  });

  it('leaves a legacy table that stalled long ago with its old time', async () => {
    const live = setTable();
    const now = expired(live);
    db.live = { ...live, table: { v: 1, scores: null, over: null, extra: {} }, legacy: true, actedAt: now - 30 * 24 * 3600_000, updatedAt: now - 7 * 3600_000 };
    await actOnGame(GAME, null, null, null, now);
    expect(theCommit().w.acted).toBe(false);
    expect(wokeFrom()).toEqual([now - 7 * 3600_000]);
  });

  it('reads a table with a "v" by acted_at alone, whatever updated_at says', async () => {
    const live = setTable();
    const now = expired(live);
    db.live = { ...live, actedAt: now - 7 * 3600_000, updatedAt: now - 60_000 };
    await actOnGame(GAME, null, null, null, now);
    expect(theCommit().w.acted).toBe(false);
    expect(wokeFrom()).toEqual([now - 7 * 3600_000]);
  });
});

describe('when the database fails after the table has moved', () => {
  it('still gives the caller the new table and tells the others, and logs the failed write', async () => {
    const live = setTable();
    const { late } = lastDecision(live);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(store.countHand).mockRejectedValueOnce(new SupabaseError('count the hand', { message: 'TypeError: fetch failed' }));
    const snap = await actOnGame(GAME, 'u-abrar', null, null, late);
    expect(snap.version).toBe(live.version + 1);
    expect(snap.me).toBe(0);
    expect(snap.view.phase).toBe('finished');
    expect(store.commitTable).toHaveBeenCalledTimes(1);
    expect(broadcaster.broadcast).toHaveBeenCalledTimes(1);
    expect(broadcaster.gamePoke).toHaveBeenCalledWith(GAME, live.version + 1, expect.anything());
    expect(logged(log)).toEqual([
      expect.objectContaining({
        level: 'error',
        event: 'after_commit_failed',
        step: 'count the hand',
        gameId: GAME,
        version: live.version + 1,
        name: 'SupabaseError',
        message: 'could not count the hand: TypeError: fetch failed',
      }),
    ]);
  });

  it.each(['count the hand', 'tally the players'])('when "%s" fails, still runs the other and shows the committed totals', async (what) => {
    const live = setTable();
    const { ended, late } = lastDecision(live, { table: { v: 1, scores: [3, -3, 0, 0], over: null, extra: {} } });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(what === 'count the hand' ? store.countHand : store.recordHand).mockRejectedValueOnce(DOWN());
    const snap = await actOnGame(GAME, 'u-abrar', null, null, late);
    expect(snap.scores).toEqual(plus([3, -3, 0, 0], ended));
    expect(store.countHand).toHaveBeenCalledTimes(1);
    expect(store.recordHand).toHaveBeenCalledTimes(1);
    expect(broadcaster.broadcast).toHaveBeenCalledTimes(1);
    expect(logged(log)).toEqual([expect.objectContaining({ event: 'after_commit_failed', step: what })]);
  });

  it('shows a game whose finish failed as finished already, from its saved end, and the next request finishes the job', async () => {
    const live = setTable();
    db.live = liveRow(lastHand(live.state), { claim: null, turn: null }, { version: 7 });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    // A finished last hand saved before the natural end existed: the tap ends the game, and the finish after it fails.
    vi.mocked(store.finishGame).mockRejectedValueOnce(DOWN());
    const failed = await actOnGame(GAME, 'u-abrar', { type: 'nextHand' }, 7, T0 + 1000);
    expect(failed.status).toBe('finished');
    expect(failed.ended).toEqual({ how: 'complete', hands: 16, byName: null, byMe: false });
    expect(failed.version).toBe(8);
    expect(failed.view.phase).toBe('finished');
    expect(failed.view.progress.handIndex).toBe(15);
    const over = (db.live as LiveRow).table.over!;
    expect(over).toMatchObject({ how: 'complete', hands: 16, at: T0 + 1000 });
    expect(logged(log)).toEqual([expect.objectContaining({ event: 'after_commit_failed', step: 'finish the game' })]);
    expect(broadcaster.broadcast).toHaveBeenCalledTimes(1);

    // The game still reads active, so the next request that looks at it (here the page's own) writes the finish again, from
    // the saved end alone: no commit, and a poke at the version the table is already at, so pages that have it look no further.
    vi.mocked(broadcaster.gamePoke).mockClear();
    const seen = await viewGame(GAME, 'u-abrar', T0 + 2000);
    expect(seen).toMatchObject({ status: 'finished', version: 8 });
    expect(store.finishGame).toHaveBeenCalledTimes(2);
    expect(store.finishGame).toHaveBeenLastCalledWith(GAME, db.room, over);
    expect(store.commitTable).toHaveBeenCalledTimes(1);
    expect(broadcaster.gamePoke).toHaveBeenCalledWith(GAME, 8, { gameOver: true });
    expect(broadcaster.roomPoke).toHaveBeenCalledWith('r-1', 'seats', {});
    // No hand was dealt, and none ended there; the finish writes the game's hand count, so it isn't counted here.
    expect(commits().map((c) => c.w.hands)).toEqual([[]]);
    expect(store.countHand).not.toHaveBeenCalled();
    expect(store.recordHand).not.toHaveBeenCalled();
  });

  it('still fails outright, saving nothing, when the save itself fails', async () => {
    const live = setTable();
    const { late } = lastDecision(live);
    vi.mocked(store.commitTable).mockRejectedValueOnce(new SupabaseError('save the table', { message: 'TypeError: fetch failed' }));
    await expect(actOnGame(GAME, 'u-abrar', null, null, late)).rejects.toBeInstanceOf(SupabaseError);
    expect(broadcaster.broadcast).not.toHaveBeenCalled();
    expect(commit.afterCommit).not.toHaveBeenCalled();
    expect(store.countHand).not.toHaveBeenCalled();
  });

  it('fails outright, saving nothing, when the table cannot be read', async () => {
    setTable();
    vi.mocked(store.loadLive).mockRejectedValueOnce(new SupabaseError('read the table', { message: 'TypeError: fetch failed' }));
    await expect(actOnGame(GAME, 'u-abrar', null, null, T0)).rejects.toBeInstanceOf(SupabaseError);
    expect(store.commitTable).not.toHaveBeenCalled();
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

  it('ends the game as abandoned when the last person stands up, saved with the table, then finished, and nobody placed', async () => {
    const live = setTable();
    await expect(leaveGame(GAME, 'u-abrar', T0 + 1000)).resolves.toEqual({ abandoned: true });
    const { expected, w, hand } = theCommit();
    expect(expected).toBe(live.version);
    expect(w.table.over).toEqual({ how: 'abandoned', by: null, at: T0 + 1000, hands: 0, scores: [0, 0, 0, 0], seats });
    expect(w.deadlines).toEqual({ claim: null, turn: null });
    expect(w.wakeAt).toBeNull();
    // The hand was in play, so its log says why nobody moved after this; nothing else moved.
    expect(hand).toMatchObject({ hand: 0, ended: false, result: null });
    expect(hand.moves).toEqual([{ v: live.version + 1, by: 'table', a: { type: 'endGame', how: 'abandoned' } }]);
    expect(afterSteps()).toEqual([['finish the game']]);
    expect(store.finishGame).toHaveBeenCalledWith(GAME, db.room, w.table.over);
    expect(broadcaster.gamePoke).toHaveBeenCalledWith(GAME, live.version + 1, expect.objectContaining({ abandoned: true, gameOver: true }));
    // The seat isn't given up: the game it was for is over.
    expect(store.saveSeats).not.toHaveBeenCalled();
  });

  it('finishes an abandon that failed part way when the last person stands up again, without ending the game twice', async () => {
    setTable();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(store.finishGame).mockRejectedValueOnce(DOWN());
    await expect(leaveGame(GAME, 'u-abrar', T0)).resolves.toEqual({ abandoned: true });
    await expect(leaveGame(GAME, 'u-abrar', T0)).resolves.toEqual({ abandoned: true });
    expect(store.commitTable).toHaveBeenCalledTimes(1);
    expect(store.finishGame).toHaveBeenCalledTimes(2);
    expect(vi.mocked(store.finishGame).mock.calls.map(([, , over]) => over.how)).toEqual(['abandoned', 'abandoned']);
  });

  it('tries the abandon again on a fresh table when someone else saved first', async () => {
    const live = setTable();
    db.lose = 1;
    await expect(leaveGame(GAME, 'u-abrar', T0)).resolves.toEqual({ abandoned: true });
    expect(commits().map((c) => c.expected)).toEqual([live.version, live.version + 1]);
    expect(store.finishGame).toHaveBeenCalledTimes(1);
  });

  it('gives up no seat when the host has already dealt a newer game than the one being left', async () => {
    setTable();
    db.room = { ...(db.room as RoomRow), seats: two, current_game_id: '0d3e5f7a-9b1c-4d2e-8f6a-1b3c5d7e9f02' };
    await expect(leaveGame(GAME, 'u-abrar', T0)).resolves.toEqual({ abandoned: false });
    expect(store.saveSeats).not.toHaveBeenCalled();
    expect(store.commitTable).not.toHaveBeenCalled();
    expect(store.finishGame).not.toHaveBeenCalled();
    expect(broadcaster.broadcast).not.toHaveBeenCalled();
  });

  it('does not log when someone else moved the table first', async () => {
    const live = setTable();
    db.room = { ...(db.room as RoomRow), seats: two };
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(store.saveSeats).mockResolvedValueOnce('2026-09-24T00:00:01Z');
    db.lose = 1;
    await expect(leaveGame(GAME, 'u-abrar', expired(live))).resolves.toEqual({ abandoned: false });
    expect(store.commitTable).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });
});

describe('the daily sweep', () => {
  const OTHER = '0d3e5f7a-9b1c-4d2e-8f6a-1b3c5d7e9f02';

  it('settles each table past its clock and says so', async () => {
    const live = setTable();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await sweepGames([GAME], expired(live))).toEqual({ [GAME]: 'ok' });
    expect(store.commitTable).toHaveBeenCalledTimes(1);
    expect(theCommit().w.acted).toBe(false);
    expect(log).not.toHaveBeenCalled();
  });

  it('does not log a table someone else moved first, or one that ended since the sweep looked', async () => {
    const live = setTable();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.lose = 1;
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

/**
 * The game ends in the request that ends it (R12): its end is committed with
 * the table, then the finish writes the bookkeeping around it. A game whose
 * finish failed still reads finished everywhere, and the next request that
 * touches it (a look, a tick, the sweep, a leave, a join or a start in its
 * room) writes the finish again.
 */
describe('the end of the game', () => {
  const NORTH_3: GameProgress = { roundWind: 'N', roundIndex: 3, handInRound: 3, handIndex: 15 };
  const OTHER = '0d3e5f7a-9b1c-4d2e-8f6a-1b3c5d7e9f02';

  /** The game's sixteenth hand at seat 0's last decision, left to the clock (see lastDecision), with these totals before it. */
  function lastHandDecision(scores: TableState['scores'] = [3, -3, 0, 0]): { live: LiveRow; ended: HandState; late: number } {
    setTable();
    const dealt = settle(startHand(karachi, { seed: 'svc-1', progress: NORTH_3, dealer: 3 }), karachi, seats);
    return lastDecision(liveRow(dealt, { claim: null, turn: null }), { table: { v: 1, scores, over: null, extra: {} } });
  }

  /** A game over and fully recorded, as its live row keeps it. */
  function ended(over: GameOver, extra: Partial<LiveRow> = {}): LiveRow {
    const live = setTable();
    db.game = { ...(db.game as GameRow), status: 'finished' };
    db.room = { ...(db.room as RoomRow), status: 'finished' };
    db.live = liveRow(lastHand(live.state), { claim: null, turn: null }, { version: 30, table: { v: 1, scores: over.scores, over, extra: {} }, ...extra });
    return db.live as LiveRow;
  }

  const OVER: GameOver = { how: 'complete', by: null, at: T0, hands: 16, scores: [2000, 14504, -8000, -8504], seats };

  it('ends the game with its last hand, with no tap: the end is committed, then the finish, then the poke, and the hand is not counted twice', async () => {
    const { live, ended: done, late } = lastHandDecision();
    const snap = await actOnGame(GAME, 'u-abrar', null, null, late);
    const { w, hand } = theCommit();
    expect(hand).toMatchObject({ hand: 15, ended: true });
    expect(w.table.scores).toEqual(plus([3, -3, 0, 0], done));
    expect(w.table.over).toEqual({ how: 'complete', by: null, at: late, hands: 16, scores: w.table.scores, seats });
    expect(w.deadlines).toEqual({ claim: null, turn: null });
    expect(w.wakeAt).toBeNull();
    // The finish writes the game's hand count itself, so the hand isn't counted on top of it.
    expect(afterSteps()).toEqual([['tally the players', 'finish the game']]);
    expect(store.countHand).not.toHaveBeenCalled();
    expect(store.finishGame).toHaveBeenCalledWith(GAME, db.room, w.table.over);
    const order = [store.commitTable, store.finishGame, broadcaster.broadcast].map((fn) => vi.mocked(fn).mock.invocationCallOrder[0]!);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(broadcaster.gamePoke).toHaveBeenCalledWith(GAME, live.version + 1, expect.objectContaining({ gameOver: true }));
    expect(snap).toMatchObject({
      status: 'finished',
      scores: w.table.scores,
      ended: { how: 'complete', hands: 16, byName: null, byMe: false },
      deadlines: { claim: null, turn: null },
    });
  });

  it('shows a game that has ended as it ended, after the room was dealt again: its seats, its totals and the viewer’s seat in it', async () => {
    ended(OVER);
    // The room has moved on: a new game, with Zed in seat 0 and Abrar moved to seat 1.
    db.room = {
      ...(db.room as RoomRow),
      status: 'playing',
      current_game_id: OTHER,
      seats: [{ kind: 'human', userId: 'u-zed', name: 'Zed' }, seats[0], { kind: 'bot', name: 'Omar' }, { kind: 'bot', name: 'Hamza' }],
    };
    const snap = await viewGame(GAME, 'u-abrar', T0);
    expect(snap).toMatchObject({ status: 'finished', me: 0, scores: OVER.scores, ended: { how: 'complete', hands: 16 } });
    expect(snap.seats).toEqual(seats.map((s) => s && { kind: s.kind, name: s.name }));
    expect('me' in snap.view && snap.view.me).toBe(0);
    // Fully recorded already: nothing to write again.
    expect(store.finishGame).not.toHaveBeenCalled();
  });

  it('gives the host’s powers at the final table by who was at the table at the end, not by the room’s seats now', async () => {
    // Hana hosts. At the end she was at the table, in seat 1.
    const withHana: GameOver = { ...OVER, seats: [seats[0], { kind: 'human', userId: 'u-hana', name: 'Hana' }, seats[2], seats[3]] };
    ended(withHana);
    expect((await viewGame(GAME, 'u-hana', T0)).isHost).toBe(true);
    expect((await viewGame(GAME, 'u-abrar', T0)).isHost).toBe(false);

    // She left that game before it ended (a bot had her seat), and has since sat down in the room again: she wasn't there at the end.
    ended(OVER);
    db.room = { ...(db.room as RoomRow), seats: [seats[0], { kind: 'human', userId: 'u-hana', name: 'Hana' }, seats[2], seats[3]] };
    const hers = await viewGame(GAME, 'u-hana', T0);
    expect(hers.me).toBeNull();
    expect(hers.isHost).toBe(false);
  });

  it('finishes a game whose end is saved but not recorded on a tick, and refuses a move on it with the final table', async () => {
    ended(OVER);
    db.game = { ...(db.game as GameRow), status: 'active' };
    const snap = await actOnGame(GAME, 'u-abrar', null, null, T0);
    expect(snap).toMatchObject({ status: 'finished', version: 30 });
    expect(store.finishGame).toHaveBeenCalledTimes(1);

    const err = await rejection(actOnGame(GAME, 'u-abrar', { type: 'nextHand' }, 30, T0));
    expect(err).toMatchObject({ status: 409, message: 'game is over' });
    expect((err.body as { status: string }).status).toBe('finished');
    expect(store.finishGame).toHaveBeenCalledTimes(2);
    expect(store.commitTable).not.toHaveBeenCalled();
    expect(table.step).not.toHaveBeenCalled();
  });

  it('has the sweep finish such a game, and call it done', async () => {
    ended(OVER);
    db.game = { ...(db.game as GameRow), status: 'active' };
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await sweepGames([GAME], T0)).toEqual({ [GAME]: 'ok' });
    expect(store.finishGame).toHaveBeenCalledWith(GAME, db.room, OVER);
    expect(store.commitTable).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('only logs a finish that fails again, and still shows the final table', async () => {
    ended(OVER);
    db.game = { ...(db.game as GameRow), status: 'active' };
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(store.finishGame).mockRejectedValueOnce(DOWN());
    expect(await viewGame(GAME, 'u-abrar', T0)).toMatchObject({ status: 'finished' });
    expect(logged(log)).toEqual([expect.objectContaining({ event: 'after_commit_failed', step: 'finish the game', gameId: GAME, version: 30, heal: true })]);
  });

  describe('a room whose game has ended', () => {
    it('finishes the game before the room is joined or dealt again, and gives the room as that left it', async () => {
      ended(OVER);
      db.game = { ...(db.game as GameRow), status: 'active' };
      const playing: RoomRow = { ...(db.room as RoomRow), status: 'playing' };
      vi.mocked(store.roomById).mockResolvedValueOnce({ ...playing, status: 'finished', updated_at: '2026-09-24T01:00:00Z' });
      expect(await settleRoomGame(playing)).toMatchObject({ status: 'finished', updated_at: '2026-09-24T01:00:00Z' });
      expect(store.liveMeta).toHaveBeenCalledWith(GAME);
      expect(store.finishGame).toHaveBeenCalledWith(GAME, playing, OVER);
      expect(broadcaster.gamePoke).toHaveBeenCalledWith(GAME, 30, { gameOver: true });
    });

    it('still reads it as finished when the finish didn’t get as far as the room', async () => {
      ended(OVER);
      const playing: RoomRow = { ...(db.room as RoomRow), status: 'playing' };
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(store.finishGame).mockRejectedValueOnce(DOWN());
      vi.mocked(store.roomById).mockResolvedValueOnce(playing);
      expect(await settleRoomGame(playing)).toEqual({ ...playing, status: 'finished' });
    });

    it('leaves a room whose game is in play, or that isn’t playing, as it was', async () => {
      setTable();
      const room = db.room as RoomRow;
      expect(await settleRoomGame(room)).toBe(room);
      expect(store.finishGame).not.toHaveBeenCalled();
      const between: RoomRow = { ...room, status: 'finished' };
      expect(await settleRoomGame(between)).toBe(between);
      expect(store.liveMeta).toHaveBeenCalledTimes(1);
    });
  });
});
