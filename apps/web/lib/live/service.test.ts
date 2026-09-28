import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVERYONE_HERE, markAway, markPresent, noteClockMove } from './absence';
import { analysisBot, karachi, legalActions, reduce, startHand, viewFor, type GameProgress, type HandState } from '@society/engine';
import type { GameRow, LiveRow, RoomRow } from './store';
import type { HandWrite, TableWrite } from './hand-log';
import { dealFirstHand, deadlinesFor, settle, type StepResult } from './table';
import type { Absence, GameOver, TableState } from './table-state';
import type { ClientAction, Deadlines, Seats } from './types';
import { STALE_GAME_MS } from './lifecycle';
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
  recountMemberGames: vi.fn(async () => {}),
  saveSeats: vi.fn(async () => null),
  roomByCode: vi.fn(async () => null),
  followSeat: vi.fn(async () => {}),
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
vi.mock('./events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./events')>();
  return { ...actual, recordEvent: vi.fn(async () => {}) };
});

import { HttpError, actOnGame, changeSeat, endGame, endIfStale, leaveGame, noteTakeOver, settleRoomGame, sweepGames, viewGame } from './service';
import { SupabaseError } from './errors';
import * as broadcaster from './broadcast';
import * as commit from './commit';
import * as events from './events';
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
const FRESH: TableState = { v: 1, scores: [0, 0, 0, 0], over: null, absence: EVERYONE_HERE, ready: null, extra: {} };

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

/** Hands already played out, by the table they started from: the same table always plays out the same way. */
const playedOut = new Map<string, readonly HandState[]>();

/**
 * Seat 0's own play (the analysis bot's choice) until the hand ends, the bots answering sharply between: each table seat 0
 * decided at, then the end. The bots take most of a second over a hand, so each starting table is played out once per file
 * and remembered: several tests start from the same deal, and one test may start from it several times.
 */
function tablesToEnd(state: HandState): readonly HandState[] {
  const key = JSON.stringify(state);
  const known = playedOut.get(key);
  if (known) return known;
  const tables = playOutFresh(state);
  playedOut.set(key, tables);
  return tables;
}

function playOutFresh(state: HandState): HandState[] {
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

/** Every moment counted for the funnel so far. */
function counted(): events.AppEvent[] {
  return vi.mocked(events.recordEvent).mock.calls.map(([e]) => e);
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
    // Watching is the host's right; the host's powers need a seat, so they're with Abrar, the one person seated.
    expect(snap.isHost).toBe(false);
    expect('me' in snap.view).toBe(false);
    expect((await viewGame(GAME, 'u-abrar', expired(live))).isHost).toBe(true);
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
    const { ended, late } = lastDecision(live, { table: { v: 1, scores: [3, -3, 0, 0], over: null, absence: EVERYONE_HERE, ready: null, extra: {} } });
    expect(ended.result?.type).toBe('win');
    const snap = await actOnGame(GAME, 'u-abrar', null, null, late);
    const { w, hand } = theCommit();
    expect(hand).toMatchObject({ hand: 0, ended: true });
    expect(hand.result).toEqual(ended.result);
    expect(w.table.scores).toEqual(plus([3, -3, 0, 0], ended));
    expect(w.table.scores).not.toEqual([3, -3, 0, 0]);
    expect(snap.scores).toEqual(w.table.scores);
    expect(snap.view.phase).toBe('finished');
    // A finished hand runs no clock, so the table wakes only to end as idle, six hours after a person last moved it (a tick isn't one).
    expect(w.deadlines).toEqual({ claim: null, turn: null });
    expect(w.acted).toBe(false);
    expect(w.wakeAt).toBe(live.actedAt + STALE_GAME_MS);
    expect(afterSteps()).toEqual([['count the hand', 'tally the players']]);
    expect(store.countHand).toHaveBeenCalledWith(GAME);
    // Nobody was away when it ended, so the hand counts on everyone's profile.
    expect(store.recordHand).toHaveBeenCalledWith(seats, ended, [false, false, false, false]);
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

/**
 * Next hand at a table of two (R15, R16): a tap that names its hand is a
 * vote, saved whatever version the page saw and tried again on a fresh read
 * when someone else saves first. The next hand starts when everyone here has
 * voted, or on the first request after the wait runs out, a tick included.
 */
describe('voting for the next hand', () => {
  /** Abrar and Bilal at the table. */
  const pair: Seats = [seats[0], { kind: 'human', userId: 'u-bilal', name: 'Bilal' }, seats[2], seats[3]];
  const WAIT = 20_000;

  /** The first hand finished, nobody has tapped Next hand yet, and the table is at version 5. */
  function finishedPair(table: TableState = FRESH, deadlines: Deadlines = { claim: null, turn: null }): LiveRow {
    const live = setTable();
    db.room = { ...(db.room as RoomRow), seats: pair };
    db.live = liveRow(playOut(live.state), deadlines, { version: 5, table });
    return db.live as LiveRow;
  }

  it('saves a vote whatever version the page saw, with the start as the turn clock and wake time, and says who it’s waiting on', async () => {
    finishedPair();
    const snap = await actOnGame(GAME, 'u-abrar', { type: 'nextHand', hand: 0 }, 2, T0 + 1000);
    const [c] = commits();
    expect(commits()).toHaveLength(1);
    expect(c!.expected).toBe(5);
    expect(c!.w).toMatchObject({ acted: true, hands: [], deadlines: { claim: null, turn: T0 + 1000 + WAIT }, wakeAt: T0 + 1000 + WAIT });
    expect(c!.w.table.ready).toEqual({ hand: 0, userIds: ['u-abrar'], dealAt: T0 + 1000 + WAIT });
    expect(snap).toMatchObject({ version: 6, nextHand: { ready: [0], waiting: [1], startsAt: T0 + 1000 + WAIT } });
    expect(snap.view.phase).toBe('finished');
    expect(afterSteps()).toEqual([[]]);

    // Bilal's tap, on a table already moved on from the one he saw: everyone's ready, so it deals, in the same commit.
    const dealt = await actOnGame(GAME, 'u-bilal', { type: 'nextHand', hand: 0 }, 5, T0 + 4000);
    const last = commits().at(-1)!;
    expect(last.expected).toBe(6);
    expect(last.w.table.ready).toBeNull();
    expect(last.w.hands).toHaveLength(1);
    expect(last.w.hands[0]).toMatchObject({ hand: 1, ended: false });
    expect(dealt.view.progress.handIndex).toBe(1);
    expect(dealt.nextHand).toBeNull();
  });

  it('tries a vote that loses to someone else’s save again on a fresh read, five times at most', async () => {
    finishedPair();
    db.lose = 4;
    const snap = await actOnGame(GAME, 'u-abrar', { type: 'nextHand', hand: 0 }, 5, T0 + 1000);
    expect(store.commitTable).toHaveBeenCalledTimes(5);
    expect(snap.version).toBe(10);
    expect((db.live as LiveRow).table.ready).toMatchObject({ hand: 0, userIds: ['u-abrar'] });

    finishedPair();
    vi.clearAllMocks();
    db.lose = 5;
    const err = await rejection(actOnGame(GAME, 'u-abrar', { type: 'nextHand', hand: 0 }, 5, T0 + 1000));
    expect(err).toMatchObject({ status: 409, message: 'the table changed under you; try again' });
    expect(store.commitTable).toHaveBeenCalledTimes(5);
    expect(broadcaster.broadcast).not.toHaveBeenCalled();
  });

  it('keeps the version check for a tap that names no hand, from a page loaded before votes, and counts it as a vote', async () => {
    finishedPair();
    const err = await rejection(actOnGame(GAME, 'u-abrar', { type: 'nextHand' }, 4, T0 + 1000));
    expect(err).toMatchObject({ status: 409, message: 'stale version' });
    expect(store.commitTable).not.toHaveBeenCalled();
    const snap = await actOnGame(GAME, 'u-abrar', { type: 'nextHand' }, 5, T0 + 1000);
    expect(snap.nextHand).toEqual({ ready: [0], waiting: [1], startsAt: T0 + 1000 + WAIT });
  });

  it('starts the next hand on the tick that finds the wait over, as nobody’s move, and then saves a late tap for its moment alone', async () => {
    const waiting: TableState = { ...FRESH, ready: { hand: 0, userIds: ['u-abrar'], dealAt: T0 + WAIT } };
    finishedPair(waiting, { claim: null, turn: T0 + WAIT });
    // Too soon: nothing to do, nothing written.
    const early = await actOnGame(GAME, 'u-abrar', null, null, T0 + WAIT - 1);
    expect(store.commitTable).not.toHaveBeenCalled();
    expect(early.nextHand).toEqual({ ready: [0], waiting: [1], startsAt: T0 + WAIT });

    const snap = await actOnGame(GAME, 'u-abrar', null, null, T0 + WAIT + 750);
    const { w, hand } = theCommit();
    expect(w.acted).toBe(false);
    expect(w.table.ready).toBeNull();
    expect(hand).toMatchObject({ hand: 1, ended: false });
    expect(hand.moves.every((m) => m.v === 6 && m.by !== 'player')).toBe(true);
    expect(snap.view.progress.handIndex).toBe(1);
    expect(snap.nextHand).toBeNull();

    // Bilal's tap arrives after the start: nothing changes at the table but his presence, which is saved for its moment all the
    // same (R16), and he gets the new hand.
    const late = await actOnGame(GAME, 'u-bilal', { type: 'nextHand', hand: 0 }, 5, T0 + WAIT + 900);
    expect(commits()).toHaveLength(2);
    const tap = commits().at(-1)!;
    expect(tap.expected).toBe(6);
    expect(tap.w).toMatchObject({ hands: [], deadlines: w.deadlines });
    expect(tap.w.state.progress.handIndex).toBe(1);
    expect(tap.w.table.absence[1]).toMatchObject({ userId: 'u-bilal', misses: 0, away: null, lastTap: T0 + WAIT + 900, tapVersion: 7 });
    expect(late.version).toBe(7);
    expect(late.view.progress.handIndex).toBe(1);
  });

  it('saves a second vote from the same person for its moment, so the host can’t hand their seat to a bot straight after it', async () => {
    finishedPair();
    await actOnGame(GAME, 'u-bilal', { type: 'nextHand', hand: 0 }, 5, T0 + 1000);
    // The host (Abrar: the room's host isn't seated, and he has sat longest) looks at the table, Bilal's vote in it.
    const seen = await viewGame(GAME, 'u-abrar', T0 + 2000);
    expect(seen).toMatchObject({ isHost: true, version: 6 });
    // Bilal taps again, from his other phone: no second vote, but a tap all the same.
    await actOnGame(GAME, 'u-bilal', { type: 'nextHand', hand: 0 }, 6, T0 + 3000);
    expect(commits()).toHaveLength(2);
    expect(commits()[1]!.w.table.ready).toEqual(commits()[0]!.w.table.ready);
    const err = await rejection(changeSeat(GAME, 'u-abrar', { type: 'letBotPlay', seat: 1, sawAt: seen.now, sawVersion: seen.version }, T0 + 4000));
    expect(err).toMatchObject({ status: 409, message: 'that player has just played' });
    expect(commits()).toHaveLength(2);
  });
});

describe('the running totals', () => {
  it('seeds a legacy table’s totals from rooms.ledger, in the snapshot and in the commit that saves them', async () => {
    const live = setTable();
    db.room = { ...(db.room as RoomRow), ledger: [3, -3, 0, 0] };
    db.live = { ...live, table: { v: 1, scores: null, over: null, absence: EVERYONE_HERE, ready: null, extra: {} }, legacy: true };
    expect((await viewGame(GAME, 'u-abrar', T0)).scores).toEqual([3, -3, 0, 0]);
    const snap = await actOnGame(GAME, 'u-abrar', null, null, expired(live));
    expect(snap.scores).toEqual([3, -3, 0, 0]);
    // The clock that ran out is kept for Abrar's own table to tell him (and it's his first miss).
    expect(theCommit().w.table).toMatchObject({ v: 1, scores: [3, -3, 0, 0], over: null, extra: {} });
    expect(theCommit().w.table.absence[0]).toMatchObject({ userId: 'u-abrar', misses: 1, clockMoves: 1 });
    // Saved, the table is its own from now on.
    expect(db.live).toMatchObject({ legacy: false, table: { scores: [3, -3, 0, 0] } });
  });

  it('reads the totals from the table once it has a "v", never from rooms.ledger', async () => {
    const live = setTable();
    db.room = { ...(db.room as RoomRow), ledger: [9, 9, 9, 9] };
    db.live = { ...live, table: { v: 1, scores: [5, -5, 0, 0], over: null, absence: EVERYONE_HERE, ready: null, extra: {} } };
    expect((await viewGame(GAME, 'u-abrar', T0)).scores).toEqual([5, -5, 0, 0]);
    const snap = await actOnGame(GAME, 'u-abrar', null, null, expired(live));
    expect(snap.scores).toEqual([5, -5, 0, 0]);
    expect(theCommit().w.table.scores).toEqual([5, -5, 0, 0]);
  });

  it('never saves over a table a newer deploy wrote: 503, logged as table_state_newer, and nothing committed', async () => {
    const live = setTable();
    db.live = { ...live, table: { v: 2, scores: [5, -5, 0, 0], over: null, absence: EVERYONE_HERE, ready: null, extra: { absence: [] } } };
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
    db.live = {
      ...live,
      table: { v: 1, scores: null, over: null, absence: EVERYONE_HERE, ready: null, extra: {} },
      legacy: true,
      actedAt: now - 30 * 24 * 3600_000,
      updatedAt: now - 10 * 60_000,
    };
    await actOnGame(GAME, null, null, null, now);
    expect(theCommit().w.acted).toBe(true);
    expect(wokeFrom()).toEqual([now]);
  });

  it('leaves a legacy table that stalled long ago with its old time', async () => {
    const live = setTable();
    const now = expired(live);
    db.live = {
      ...live,
      table: { v: 1, scores: null, over: null, absence: EVERYONE_HERE, ready: null, extra: {} },
      legacy: true,
      actedAt: now - 30 * 24 * 3600_000,
      updatedAt: now - 7 * 3600_000,
    };
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
    const { ended, late } = lastDecision(live, { table: { v: 1, scores: [3, -3, 0, 0], over: null, absence: EVERYONE_HERE, ready: null, extra: {} } });
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
    expect(store.finishGame).toHaveBeenLastCalledWith(GAME, db.room, over, expect.anything());
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
    expect(afterSteps()).toEqual([['finish the game', 'count the end']]);
    expect(store.finishGame).toHaveBeenCalledWith(GAME, db.room, w.table.over, expect.anything());
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

  it('gives up no seat when the last hand has just ended the game and its finish hasn’t landed: the finish runs instead', async () => {
    const live = setTable();
    db.room = { ...(db.room as RoomRow), seats: two };
    // The last hand's end is committed; the game still reads active, and Bea is still seated beside Abrar.
    const over: GameOver = { how: 'complete', by: null, at: T0, hands: 16, scores: [2000, 14504, -8000, -8504], seats: two };
    db.live = { ...live, version: 30, table: { v: 1, scores: over.scores, over, absence: EVERYONE_HERE, ready: null, extra: {} } };
    // Were the seat given up, this write would land.
    vi.mocked(store.saveSeats).mockResolvedValueOnce('2026-09-24T00:00:01Z');
    await expect(leaveGame(GAME, 'u-abrar', T0)).resolves.toEqual({ abandoned: false });
    // No bot takes the seat, so the host's Play again deals Abrar in.
    expect(store.saveSeats).not.toHaveBeenCalled();
    expect(store.finishGame).toHaveBeenCalledTimes(1);
    expect(store.finishGame).toHaveBeenCalledWith(GAME, db.room, over, expect.anything());
    expect(store.commitTable).not.toHaveBeenCalled();
    expect(broadcaster.gamePoke).toHaveBeenCalledWith(GAME, 30, { gameOver: true });
  });

  it('gives up no seat when the game ends between the leave’s look and its seat write, and the finish closes the room first', async () => {
    const live = setTable();
    db.room = { ...(db.room as RoomRow), seats: two };
    const over: GameOver = { how: 'complete', by: null, at: T0, hands: 16, scores: [2000, 14504, -8000, -8504], seats: two };
    // The leave looks, and the table is in play. Before its seat write, the last hand's end is committed and its finish closes
    // the room, moving updated_at, so the write matches nothing. (A write that lands before the close is undone by the close
    // itself: store.test.ts, "someone leaving as the last hand is scored".) The reset drops a write an earlier test queued and never used.
    vi.mocked(store.saveSeats).mockReset();
    vi.mocked(store.saveSeats).mockImplementationOnce(async () => {
      db.live = { ...live, version: 30, table: { v: 1, scores: over.scores, over, absence: EVERYONE_HERE, ready: null, extra: {} } };
      db.room = { ...(db.room as RoomRow), status: 'finished', updated_at: '2026-09-24T00:00:01Z' };
      return null;
    });
    await expect(leaveGame(GAME, 'u-abrar', T0)).resolves.toEqual({ abandoned: false });
    // One write, which lost; then the second look finds the game over, and the finish runs again rather than a bot sitting down.
    expect(store.saveSeats).toHaveBeenCalledTimes(1);
    expect(store.finishGame).toHaveBeenCalledTimes(1);
    expect(store.finishGame).toHaveBeenCalledWith(GAME, db.room, over, expect.anything());
    expect(store.commitTable).not.toHaveBeenCalled();
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
    return lastDecision(liveRow(dealt, { claim: null, turn: null }), { table: { v: 1, scores, over: null, absence: EVERYONE_HERE, ready: null, extra: {} } });
  }

  /** A game over and fully recorded, as its live row keeps it. */
  function ended(over: GameOver, extra: Partial<LiveRow> = {}): LiveRow {
    const live = setTable();
    db.game = { ...(db.game as GameRow), status: 'finished' };
    db.room = { ...(db.room as RoomRow), status: 'finished' };
    db.live = liveRow(
      lastHand(live.state),
      { claim: null, turn: null },
      { version: 30, table: { v: 1, scores: over.scores, over, absence: EVERYONE_HERE, ready: null, extra: {} }, ...extra },
    );
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
    expect(afterSteps()).toEqual([['tally the players', 'finish the game', "count the members' games", 'count the end']]);
    expect(store.countHand).not.toHaveBeenCalled();
    expect(store.finishGame).toHaveBeenCalledWith(GAME, db.room, w.table.over, expect.anything());
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
    // The powers had passed to Abrar, the one person at the table at the end.
    expect((await viewGame(GAME, 'u-abrar', T0)).isHost).toBe(true);

    // A game that ended because nobody was playing had nobody at the table at the end: the host keeps the powers if seated then.
    ended({ ...withHana, how: 'idle' });
    expect((await viewGame(GAME, 'u-hana', T0)).isHost).toBe(true);
    expect((await viewGame(GAME, 'u-abrar', T0)).isHost).toBe(false);
    ended({ ...OVER, how: 'idle' });
    expect((await viewGame(GAME, 'u-abrar', T0)).isHost).toBe(false);
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
    expect(store.finishGame).toHaveBeenCalledWith(GAME, db.room, OVER, expect.anything());
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

  it('hands the finish who was away at the end, then recounts the people’s games once the game’s own row is written', async () => {
    const { late } = lastHandDecision();
    // Abrar's clock ran out twice before the end: a bot was playing for him when the last hand was scored.
    const live = db.live as LiveRow;
    const away = markAway(live.table.absence, seats, 0, 'clock');
    db.live = { ...live, table: { ...live.table, absence: away } };
    await actOnGame(GAME, 'u-hana', null, null, late);
    const { w } = theCommit();
    expect(w.table.over).not.toBeNull();
    expect(store.finishGame).toHaveBeenCalledWith(GAME, db.room, w.table.over, w.table.absence);
    expect(w.table.absence[0].away).toBe('clock');
    expect(store.recountMemberGames).toHaveBeenCalledWith('r-1', ['u-abrar']);
    const order = [store.finishGame, store.recountMemberGames, broadcaster.broadcast].map((fn) => vi.mocked(fn).mock.invocationCallOrder[0]!);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('recounts the people’s games in a heal too, after the finish, and logs a recount that fails without stopping anything', async () => {
    ended(OVER);
    db.game = { ...(db.game as GameRow), status: 'active' };
    await viewGame(GAME, 'u-abrar', T0);
    expect(store.finishGame).toHaveBeenCalledWith(GAME, db.room, OVER, EVERYONE_HERE);
    expect(store.recountMemberGames).toHaveBeenCalledWith('r-1', ['u-abrar']);
    expect(vi.mocked(store.finishGame).mock.invocationCallOrder[0]!).toBeLessThan(vi.mocked(store.recountMemberGames).mock.invocationCallOrder[0]!);

    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(store.recountMemberGames).mockRejectedValueOnce(DOWN());
    expect(await viewGame(GAME, 'u-abrar', T0)).toMatchObject({ status: 'finished' });
    expect(logged(log)).toEqual([expect.objectContaining({ event: 'after_commit_failed', step: "count the members' games", heal: true })]);
  });

  describe('a room whose game has ended', () => {
    it('finishes the game before the room is joined or dealt again, and gives the room as that left it', async () => {
      ended(OVER);
      db.game = { ...(db.game as GameRow), status: 'active' };
      const playing: RoomRow = { ...(db.room as RoomRow), status: 'playing' };
      vi.mocked(store.roomById).mockResolvedValueOnce({ ...playing, status: 'finished', updated_at: '2026-09-24T01:00:00Z' });
      expect(await settleRoomGame(playing)).toMatchObject({ status: 'finished', updated_at: '2026-09-24T01:00:00Z' });
      expect(store.liveMeta).toHaveBeenCalledWith(GAME);
      expect(store.finishGame).toHaveBeenCalledWith(GAME, playing, OVER, expect.anything());
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
      expect(await settleRoomGame(room, T0)).toBe(room);
      expect(store.finishGame).not.toHaveBeenCalled();
      const between: RoomRow = { ...room, status: 'finished' };
      // Its game still reads active, but its end isn't saved: nothing to finish.
      expect(await settleRoomGame(between, T0)).toBe(between);
      expect(store.liveMeta).toHaveBeenCalledTimes(2);
      // A finished game isn't looked at any further.
      db.game = { ...(db.game as GameRow), status: 'finished' };
      expect(await settleRoomGame(between, T0)).toBe(between);
      expect(store.liveMeta).toHaveBeenCalledTimes(2);
      const lobby: RoomRow = { ...room, status: 'lobby', current_game_id: null };
      expect(await settleRoomGame(lobby, T0)).toBe(lobby);
      expect(store.finishGame).not.toHaveBeenCalled();
    });

    it('finishes a game whose finish closed the room but stopped short of the game’s row, so its seat is given back before a join or a deal', async () => {
      ended(OVER);
      db.game = { ...(db.game as GameRow), status: 'active' };
      const closed: RoomRow = { ...(db.room as RoomRow), status: 'finished' };
      // The finish, run again, gives the seat back: the room comes back as it left it.
      const back: RoomRow = { ...closed, updated_at: '2026-09-24T02:00:00Z' };
      vi.mocked(store.roomById).mockResolvedValueOnce(back);
      expect(await settleRoomGame(closed)).toBe(back);
      expect(store.finishGame).toHaveBeenCalledWith(GAME, closed, OVER, expect.anything());
      expect(broadcaster.roomPoke).toHaveBeenCalledWith('r-1', 'seats', {});
    });
  });
});

/**
 * The host ends the game (R22), and a game nobody plays ends by itself after
 * six hours (R23). Both are ends like any other: saved with the table, then
 * finished, and a lost commit is tried again on a fresh read.
 */
describe('ending a game early', () => {
  const hana = { kind: 'human', userId: 'u-hana', name: 'Hana' } as const;
  const bea = { kind: 'human', userId: 'u-bea', name: 'Bea' } as const;
  /** Hana, the room's host, seated beside Abrar. */
  const withHost: Seats = [seats[0], hana, seats[2], seats[3]];

  describe('by the host', () => {
    it('ends it for everyone, mid-hand: saved with the table as a person’s move, with a note in the hand’s log, then finished', async () => {
      const live = setTable();
      db.room = { ...(db.room as RoomRow), seats: withHost };
      const snap = await endGame(GAME, 'u-hana', T0 + 1000);
      const { expected, w, hand } = theCommit();
      expect(expected).toBe(live.version);
      expect(w.acted).toBe(true);
      expect(w.table.over).toEqual({ how: 'host', by: { userId: 'u-hana', name: 'Hana' }, at: T0 + 1000, hands: 0, scores: [0, 0, 0, 0], seats: withHost });
      expect(w.deadlines).toEqual({ claim: null, turn: null });
      expect(w.wakeAt).toBeNull();
      expect(hand).toMatchObject({ hand: 0, ended: false, result: null });
      expect(hand.moves).toEqual([{ v: live.version + 1, by: 'host', userId: 'u-hana', a: { type: 'endGame', how: 'host' } }]);
      expect(afterSteps()).toEqual([['finish the game', "count the members' games", 'count the end']]);
      expect(store.finishGame).toHaveBeenCalledWith(GAME, db.room, w.table.over, expect.anything());
      expect(broadcaster.gamePoke).toHaveBeenCalledWith(GAME, live.version + 1, expect.objectContaining({ gameOver: true }));
      expect(snap).toMatchObject({ status: 'finished', me: 1, isHost: true, ended: { how: 'host', hands: 0, byName: 'Hana', byMe: true } });
    });

    it('refuses anyone else seated, and anyone not seated, before touching the table', async () => {
      setTable();
      db.room = { ...(db.room as RoomRow), seats: withHost };
      for (const who of ['u-abrar', 'u-zed']) {
        const err = await rejection(endGame(GAME, who, T0));
        expect(err).toMatchObject({ status: 403, message: 'only the host can end the game' });
      }
      expect(store.commitTable).not.toHaveBeenCalled();
    });

    it('lets whoever has sat longest end it once the host has stood up, and nobody else', async () => {
      setTable();
      // Hana stood up (a bot has her seat); Bea sat down before Abrar.
      db.room = { ...(db.room as RoomRow), seats: [{ ...seats[0], since: '2026-09-24T19:05:00Z' }, { ...bea, since: '2026-09-24T19:00:00Z' }, seats[2], seats[3]] };
      expect(await rejection(endGame(GAME, 'u-abrar', T0))).toMatchObject({ status: 403 });
      expect(await rejection(endGame(GAME, 'u-hana', T0))).toMatchObject({ status: 403 });
      await expect(endGame(GAME, 'u-bea', T0)).resolves.toMatchObject({ status: 'finished', ended: { how: 'host', byName: 'Bea' } });
      expect(store.commitTable).toHaveBeenCalledTimes(1);
    });

    it('says a game that has already finished is over', async () => {
      setTable();
      db.game = { ...(db.game as GameRow), status: 'finished' };
      expect(await rejection(endGame(GAME, 'u-abrar', T0))).toMatchObject({ status: 409, message: 'game is over' });
      expect(store.commitTable).not.toHaveBeenCalled();
    });

    it('takes a second tap as the same end: the record is finished again if need be, and the final table comes back', async () => {
      setTable();
      await endGame(GAME, 'u-abrar', T0);
      const again = await endGame(GAME, 'u-abrar', T0 + 500);
      expect(store.commitTable).toHaveBeenCalledTimes(1);
      // The game row still reads active here (the store is faked), so the second tap finishes the record again.
      expect(store.finishGame).toHaveBeenCalledTimes(2);
      expect(again).toMatchObject({ status: 'finished', ended: { how: 'host', byMe: true } });
    });

    it('counts the hand just finished when ended between hands', async () => {
      const live = setTable();
      const { ended: done } = lastDecision(live);
      db.live = liveRow(done, { claim: null, turn: null });
      await endGame(GAME, 'u-abrar', T0);
      const [c] = commits();
      expect(c!.w.table.over).toMatchObject({ how: 'host', hands: 1 });
      // Nothing more in a finished hand's log.
      expect(c!.w.hands).toEqual([]);
    });

    it('tries again on a fresh table when someone else saved first, and gives up after three', async () => {
      const live = setTable();
      db.lose = 1;
      await expect(endGame(GAME, 'u-abrar', T0)).resolves.toMatchObject({ status: 'finished' });
      expect(commits().map((c) => c.expected)).toEqual([live.version, live.version + 1]);
      expect(store.finishGame).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();
      setTable();
      db.lose = 3;
      const err = await rejection(endGame(GAME, 'u-abrar', T0));
      expect(err).toMatchObject({ status: 409, message: 'the table changed under you; try again' });
      expect(store.commitTable).toHaveBeenCalledTimes(3);
      expect(store.finishGame).not.toHaveBeenCalled();
      expect(broadcaster.broadcast).not.toHaveBeenCalled();
    });
  });

  describe('because nobody is playing', () => {
    const STALE = T0 + STALE_GAME_MS + 1;

    it('leaves a game a person moved within six hours alone, writing nothing', async () => {
      setTable();
      expect(await endIfStale(GAME, T0 + STALE_GAME_MS)).toBe(false);
      expect(store.commitTable).not.toHaveBeenCalled();
    });

    it('ends one nobody has moved for longer, by nobody: saved with the table, not as a person’s move, then finished', async () => {
      const live = setTable();
      expect(await endIfStale(GAME, STALE)).toBe(true);
      const { w, hand } = theCommit();
      expect(w.acted).toBe(false);
      expect(w.table.over).toMatchObject({ how: 'idle', by: null, at: STALE, hands: 0 });
      expect(w.wakeAt).toBeNull();
      // The clock that ran out long ago is played first, as any request would, then the end.
      expect(hand.moves.at(-1)).toEqual({ v: live.version + 1, by: 'table', a: { type: 'endGame', how: 'idle' } });
      expect(hand.moves.slice(0, -1).some((m) => m.by === 'clock')).toBe(true);
      expect(store.finishGame).toHaveBeenCalledWith(GAME, db.room, w.table.over, expect.anything());
    });

    it('reads a legacy table’s last save as its last move, as older code kept no other', async () => {
      setTable();
      db.live = {
        ...(db.live as LiveRow),
        legacy: true,
        table: { v: 1, scores: null, over: null, absence: EVERYONE_HERE, ready: null, extra: {} },
        actedAt: T0 - STALE_GAME_MS,
        updatedAt: T0,
      };
      expect(await endIfStale(GAME, T0 + 60_000)).toBe(false);
      expect(store.commitTable).not.toHaveBeenCalled();
    });

    it('does nothing when a person’s move lands first', async () => {
      setTable();
      vi.mocked(store.commitTable).mockImplementationOnce(async () => {
        // Abrar plays just before the end is saved: the table is a version on, moved by a person.
        const live = db.live as LiveRow;
        db.live = { ...live, version: live.version + 1, actedAt: STALE - 1000 };
        return null;
      });
      expect(await endIfStale(GAME, STALE)).toBe(false);
      expect(store.commitTable).toHaveBeenCalledTimes(1);
      expect(store.finishGame).not.toHaveBeenCalled();
    });

    it('finishes a game that had already ended but isn’t all recorded, and calls it over', async () => {
      const live = setTable();
      const over: GameOver = { how: 'host', by: { userId: 'u-abrar', name: 'Abrar' }, at: T0, hands: 3, scores: [0, 0, 0, 0], seats };
      db.live = { ...live, table: { ...FRESH, over } };
      expect(await endIfStale(GAME, STALE)).toBe(true);
      expect(store.commitTable).not.toHaveBeenCalled();
      expect(store.finishGame).toHaveBeenCalledWith(GAME, db.room, over, expect.anything());
    });

    it('is ended by the sweep before anything else, reported as "ended", and not settled again', async () => {
      setTable();
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(await sweepGames([GAME], STALE)).toEqual({ [GAME]: 'ended' });
      expect(store.commitTable).toHaveBeenCalledTimes(1);
      expect(theCommit().w.table.over?.how).toBe('idle');
      expect(table.step).toHaveBeenCalledTimes(1);
      expect(store.finishGame).toHaveBeenCalledTimes(1);
      expect(log).not.toHaveBeenCalled();
    });

    it('is ended before its room is joined or dealt again, and the room comes back as the finish left it', async () => {
      setTable();
      const room = db.room as RoomRow;
      // The finish closes the room, which moves its updated_at.
      vi.mocked(store.finishGame).mockImplementationOnce(async () => {
        db.room = { ...room, status: 'finished', updated_at: '2026-09-24T07:00:00Z' };
      });
      expect(await settleRoomGame(room, STALE)).toMatchObject({ status: 'finished', updated_at: '2026-09-24T07:00:00Z' });
      expect(theCommit().w.table.over?.how).toBe('idle');
    });

    it('leaves the room as it was when the table turns out to have been played after all', async () => {
      setTable();
      const room = db.room as RoomRow;
      // The room's quick read found the table stale; by the full read, someone had played.
      vi.mocked(store.liveMeta).mockResolvedValueOnce({ version: 3, table: FRESH, legacy: false, actedAt: T0 - STALE_GAME_MS, updatedAt: T0 - STALE_GAME_MS, hand: 0, seq: 0 });
      expect(await settleRoomGame(room, STALE - STALE_GAME_MS + 1000)).toBe(room);
      expect(store.commitTable).not.toHaveBeenCalled();
    });

    it('wakes a table parked on a finished hand when it would end as idle, counted from the person’s move that finished it', async () => {
      const live = setTable();
      const { live: at, ended: done } = lastDecision(live);
      const move = parseClientAction(analysisBot(viewFor(at.state, karachi, 0), karachi) ?? { type: 'pass', seat: 0 })!;
      await actOnGame(GAME, 'u-abrar', move, at.version, T0 + 5000);
      const { w } = theCommit();
      expect(w.state.phase).toBe(done.phase);
      expect(w.deadlines).toEqual({ claim: null, turn: null });
      expect(w.acted).toBe(true);
      expect(w.wakeAt).toBe(T0 + 5000 + STALE_GAME_MS);
    });
  });
});

/**
 * The funnel counts each game's end once (R29): the request that ended it
 * counts it, after the finish, whatever became of the finish; a request that
 * only finishes the record of an end already saved (a heal) counts nothing.
 */
describe('counting the end for the funnel', () => {
  const NORTH_3: GameProgress = { roundWind: 'N', roundIndex: 3, handInRound: 3, handIndex: 15 };
  const STALE = T0 + STALE_GAME_MS + 1;
  const hana = { kind: 'human', userId: 'u-hana', name: 'Hana' } as const;

  it('counts a game played to its last hand once, by nobody, after the finish and before the poke', async () => {
    setTable();
    const dealt = settle(startHand(karachi, { seed: 'svc-1', progress: NORTH_3, dealer: 3 }), karachi, seats);
    const { late } = lastDecision(liveRow(dealt, { claim: null, turn: null }));
    await actOnGame(GAME, 'u-abrar', null, null, late);
    expect(counted()).toEqual([{ type: 'game_finished', roomId: 'r-1', gameId: GAME, userId: null, data: { how: 'complete', hands: 16, humans: 1 } }]);
    const order = [store.finishGame, events.recordEvent, broadcaster.broadcast].map((fn) => vi.mocked(fn).mock.invocationCallOrder[0]!);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('pokes the room as well as the table when a move ends the game, after the finish, so a lobby open on it hears', async () => {
    setTable();
    const dealt = settle(startHand(karachi, { seed: 'svc-1', progress: NORTH_3, dealer: 3 }), karachi, seats);
    const { late } = lastDecision(liveRow(dealt, { claim: null, turn: null }));
    await actOnGame(GAME, 'u-abrar', null, null, late);
    expect(broadcaster.roomPoke).toHaveBeenCalledWith('r-1', 'seats', {});
    expect(broadcaster.broadcast).toHaveBeenCalledTimes(1);
    expect(vi.mocked(broadcaster.broadcast).mock.calls[0]![0]).toHaveLength(2);
    expect(vi.mocked(store.finishGame).mock.invocationCallOrder[0]!).toBeLessThan(vi.mocked(broadcaster.broadcast).mock.invocationCallOrder[0]!);

    // A hand that ends without ending the game leaves the room alone.
    vi.clearAllMocks();
    const live = setTable();
    await actOnGame(GAME, 'u-abrar', null, null, lastDecision(live).late);
    expect(theCommit().hand.ended).toBe(true);
    expect(broadcaster.roomPoke).not.toHaveBeenCalled();
  });

  it('counts the host’s end by the host, the idle end by nobody, and an abandon by the last to leave', async () => {
    setTable();
    db.room = { ...(db.room as RoomRow), seats: [seats[0], hana, seats[2], seats[3]] };
    await endGame(GAME, 'u-hana', T0);
    expect(counted()).toEqual([{ type: 'game_finished', roomId: 'r-1', gameId: GAME, userId: 'u-hana', data: { how: 'host', hands: 0, humans: 2 } }]);

    vi.clearAllMocks();
    setTable();
    await endIfStale(GAME, STALE);
    expect(counted()).toEqual([{ type: 'game_finished', roomId: 'r-1', gameId: GAME, userId: null, data: { how: 'idle', hands: 0, humans: 1 } }]);

    vi.clearAllMocks();
    setTable();
    await leaveGame(GAME, 'u-abrar', T0);
    expect(counted()).toEqual([{ type: 'game_abandoned', roomId: 'r-1', gameId: GAME, userId: 'u-abrar', data: { hands: 0 } }]);
  });

  it('still counts an end whose finish failed, once: every request that finishes its record afterwards counts nothing', async () => {
    setTable();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(store.finishGame).mockRejectedValueOnce(DOWN());
    await endGame(GAME, 'u-abrar', T0);
    expect(counted()).toEqual([expect.objectContaining({ type: 'game_finished', data: expect.objectContaining({ how: 'host' }) })]);

    // The game still reads active (the store is faked), so each of these finishes its record again from the saved end.
    await viewGame(GAME, 'u-abrar', T0 + 1);
    await actOnGame(GAME, 'u-abrar', null, null, T0 + 2);
    await endGame(GAME, 'u-abrar', T0 + 3);
    await endIfStale(GAME, STALE);
    await settleRoomGame(db.room as RoomRow, T0 + 4);
    await leaveGame(GAME, 'u-abrar', T0 + 5);
    await sweepGames([GAME], T0 + 6);
    expect(store.finishGame).toHaveBeenCalledTimes(8);
    expect(store.commitTable).toHaveBeenCalledTimes(1);
    expect(events.recordEvent).toHaveBeenCalledTimes(1);
  });

  it('counts nothing for a hand that ends without ending the game, or for an end that someone else’s commit beat', async () => {
    const live = setTable();
    const { late } = lastDecision(live);
    await actOnGame(GAME, 'u-abrar', null, null, late);
    expect(theCommit().hand.ended).toBe(true);
    expect(events.recordEvent).not.toHaveBeenCalled();

    vi.clearAllMocks();
    setTable();
    db.lose = 3;
    await rejection(endGame(GAME, 'u-abrar', T0));
    expect(events.recordEvent).not.toHaveBeenCalled();
  });
});

describe('someone away, and the host handing a seat over', () => {
  const hana = { kind: 'human', userId: 'u-hana', name: 'Hana' } as const;
  /** Hana, the room's host, seated beside Abrar. */
  const withHost: Seats = [seats[0], hana, seats[2], seats[3]];
  const letBotPlay = (seat: unknown, sawAt: unknown = null, sawVersion: unknown = undefined) => ({ type: 'letBotPlay' as const, seat, sawAt, sawVersion });

  /** The table with Hana seated (not waited on: it's Abrar's decision), and whoever's absence given. */
  function hosted(absence = EVERYONE_HERE): LiveRow {
    const live = setTable();
    db.room = { ...(db.room as RoomRow), seats: withHost };
    db.live = { ...live, table: { ...FRESH, absence } };
    return db.live as LiveRow;
  }

  /**
   * The first claim window of the deal in which Hana (seat 1) could take the tile, before she has answered, with no clock
   * running, and `absence` as given. A table at rest never has an away seat owing an answer (the bot gives it before anything
   * is saved), so this is the one way to put an away person's pass through a step and its commit.
   */
  function claimWindow(absence: Absence): LiveRow {
    const live = hosted(absence);
    // Everyone plays as the analysis would until then, one move at a time.
    let state = live.state;
    const hanaCanClaim = () => state.phase === 'claim' && (legalActions(state, karachi, 1).claims?.length ?? 0) > 0;
    for (let i = 0; i < 300 && !hanaCanClaim() && state.phase !== 'finished'; i++) {
      const seat = state.phase === 'claim' ? ([0, 1, 2, 3] as const).find((x) => legalActions(state, karachi, x).claims !== undefined)! : state.turn;
      state = reduce(state, analysisBot(viewFor(state, karachi, seat), karachi) ?? { type: 'pass', seat }, karachi);
    }
    expect(hanaCanClaim()).toBe(true);
    db.live = { ...live, state, deadlines: { claim: null, turn: null } };
    return db.live as LiveRow;
  }

  it('leaves someone away when their own phone ticks, or passes: neither is a tap', async () => {
    hosted(markAway(EVERYONE_HERE, withHost, 1, 'host'));
    const snap = await actOnGame(GAME, 'u-hana', null, null, T0 + 1);
    expect(store.commitTable).not.toHaveBeenCalled();
    expect(snap.mine).toMatchObject({ away: 'host' });
    // At rest, a pass from that phone has nothing to answer (the bot already has): it's refused, and nothing is written.
    expect(await rejection(actOnGame(GAME, 'u-hana', { type: 'pass', seat: 1 }, null, T0 + 2))).toMatchObject({ status: 400 });
    expect(store.commitTable).not.toHaveBeenCalled();

    // One that does answer something is played and saved, and still isn't a tap: she stays away, with no tap noted.
    claimWindow(markAway(EVERYONE_HERE, withHost, 1, 'host'));
    await actOnGame(GAME, 'u-hana', { type: 'pass', seat: 1 }, null, T0 + 3);
    const { w, hand } = theCommit();
    expect(hand.moves[0]).toMatchObject({ by: 'player', seat: 1, a: { type: 'pass', seat: 1 } });
    expect(w.table.absence[1]).toMatchObject({ userId: 'u-hana', away: 'host', lastTap: null, tapVersion: null });
    expect((db.live as LiveRow).table.absence[1].away).toBe('host');
  });

  it('keeps a miss, and the last tap, through a pass: letting a tile go is what the clock would have done', async () => {
    const tapped = markPresent(EVERYONE_HERE, withHost, 1, T0, 2);
    claimWindow(noteClockMove(tapped, withHost, { by: 'clock', seat: 1, a: { type: 'discard', seat: 1, tile: 's5' } }, true));
    await actOnGame(GAME, 'u-hana', { type: 'pass', seat: 1 }, null, T0 + 200);
    expect(theCommit().w.table.absence[1]).toMatchObject({ misses: 1, away: null, lastTap: T0, tapVersion: 2 });
  });

  it('hands a seat to a bot for the host, saved as a person’s move with the host’s note, and plays it at once', async () => {
    const live = hosted();
    const snap = await changeSeat(GAME, 'u-hana', letBotPlay(0, T0), T0 + 1000);
    const { w, hand } = theCommit();
    expect(w.acted).toBe(true);
    expect(hand.moves[0]).toEqual({ v: live.version + 1, by: 'host', seat: 0, userId: 'u-hana', a: { type: 'away', reason: 'host' } });
    expect(hand.moves[1]).toMatchObject({ by: 'away', seat: 0 });
    expect(w.table.absence[0]).toMatchObject({ userId: 'u-abrar', away: 'host' });
    // Everyone else sees only that a bot's playing for Abrar; what it did for him is his alone.
    expect(snap.seats[0]).toEqual({ kind: 'human', name: 'Abrar', presence: 'away' });
    expect(snap.mine).toEqual({ misses: 0, away: null, clockMoves: 0, lastClockMove: null, played: { turns: 0, sets: 0, exchanges: 0, wins: 0, hands: 0 } });
    expect(JSON.stringify(snap)).not.toMatch(/u-abrar|u-hana|lastTap/);
    // Abrar's own table says why, and what the bot has done so far.
    const his = await viewGame(GAME, 'u-abrar', T0 + 2000);
    expect(his.mine).toMatchObject({ away: 'host' });
    expect(his.mine!.played.turns).toBe(hand.moves.filter((m) => m.by === 'away' && m.a.type === 'discard').length);
    expect(his.seats[0]).toEqual({ kind: 'human', name: 'Abrar', presence: 'away' });
  });

  it('refuses anyone without the host’s powers, and a host who isn’t seated', async () => {
    hosted();
    expect(await rejection(changeSeat(GAME, 'u-abrar', letBotPlay(1), T0))).toMatchObject({ status: 403, message: 'only the host can hand a seat to a bot' });
    expect(await rejection(changeSeat(GAME, 'u-zed', letBotPlay(0), T0))).toMatchObject({ status: 403, message: 'only the host can hand a seat to a bot' });
    db.room = { ...(db.room as RoomRow), seats };
    expect(await rejection(changeSeat(GAME, 'u-hana', letBotPlay(0), T0))).toMatchObject({ status: 403, message: 'only the host can hand a seat to a bot' });
    expect(store.commitTable).not.toHaveBeenCalled();
  });

  it('refuses the host’s own seat, a seat that isn’t one, and a bot’s', async () => {
    hosted();
    expect(await rejection(changeSeat(GAME, 'u-hana', letBotPlay(1), T0))).toMatchObject({ status: 400, message: 'that is your own seat' });
    for (const seat of [7, -1, 1.5, '0', null, undefined])
      expect(await rejection(changeSeat(GAME, 'u-hana', letBotPlay(seat), T0))).toMatchObject({ status: 400, message: 'that is not a seat' });
    expect(await rejection(changeSeat(GAME, 'u-hana', letBotPlay(2), T0))).toMatchObject({ status: 409, message: 'a bot already plays that seat' });
    expect(store.commitTable).not.toHaveBeenCalled();
  });

  it('passes the host’s powers over while the host is away, and gives them back when they’re back', async () => {
    hosted(markAway(EVERYONE_HERE, withHost, 1, 'clock'));
    expect(await rejection(changeSeat(GAME, 'u-hana', letBotPlay(0), T0))).toMatchObject({ status: 403 });
    expect((await viewGame(GAME, 'u-abrar', T0)).isHost).toBe(true);
    expect((await viewGame(GAME, 'u-hana', T0)).isHost).toBe(false);
    await changeSeat(GAME, 'u-hana', { type: 'back' }, T0 + 10);
    expect((await viewGame(GAME, 'u-hana', T0 + 20)).isHost).toBe(true);
  });

  it('refuses a tap the host never saw, by the version of the table the host was looking at, however early its request began', async () => {
    const live = hosted();
    // The host's table is read at T0 + 1000, before Abrar's move lands, though his request began at T0 + 500.
    const seen = await viewGame(GAME, 'u-hana', T0 + 1000);
    expect(seen.version).toBe(live.version);
    const move = parseClientAction(analysisBot(viewFor(live.state, karachi, 0), karachi)!)!;
    await actOnGame(GAME, 'u-abrar', move, live.version, T0 + 500);
    expect(commits()[0]!.w.table.absence[0]).toMatchObject({ lastTap: T0 + 500, tapVersion: live.version + 1 });
    const err = await rejection(changeSeat(GAME, 'u-hana', letBotPlay(0, seen.now, seen.version), T0 + 2000));
    expect(err).toMatchObject({ status: 409, message: 'that player has just played' });
    expect(commits()).toHaveLength(1);

    // Once the host's table has that move in it, the hand-over goes through, even with a clock read before the move began.
    const after = await viewGame(GAME, 'u-hana', T0 + 2500);
    await changeSeat(GAME, 'u-hana', letBotPlay(0, T0 + 100, after.version), T0 + 3000);
    expect(commits()).toHaveLength(2);
    expect(commits()[1]!.w.table.absence[0]).toMatchObject({ userId: 'u-abrar', away: 'host' });
  });

  it('refuses when the one being handed over has tapped since the host’s table was sent, with the table', async () => {
    hosted(markPresent(EVERYONE_HERE, withHost, 0, T0 + 500));
    const err = await rejection(changeSeat(GAME, 'u-hana', letBotPlay(0, T0 + 100), T0 + 1000));
    expect(err).toMatchObject({ status: 409, message: 'that player has just played' });
    expect(err.body).toMatchObject({ gameId: GAME, me: 1 });
    expect(store.commitTable).not.toHaveBeenCalled();
    // A sawAt that isn't a number is no check at all.
    await expect(changeSeat(GAME, 'u-hana', letBotPlay(0, 'soon'), T0 + 1000)).resolves.toMatchObject({
      seats: [{ presence: 'away' }, expect.anything(), expect.anything(), expect.anything()],
    });
  });

  it('says the game is over when it is, and asks someone not seated to sit first before coming back', async () => {
    hosted();
    expect(await rejection(changeSeat(GAME, 'u-zed', { type: 'back' }, T0))).toMatchObject({ status: 403, message: 'not seated at this table' });
    db.game = { ...(db.game as GameRow), status: 'finished' };
    expect(await rejection(changeSeat(GAME, 'u-abrar', { type: 'back' }, T0))).toMatchObject({ status: 409, message: 'game is over' });
    expect(await rejection(changeSeat(GAME, 'u-hana', letBotPlay(0), T0))).toMatchObject({ status: 409, message: 'game is over' });
    expect(store.commitTable).not.toHaveBeenCalled();
  });

  it('brings someone back on "I’m back", as a person’s move, and writes nothing when there’s nothing to change', async () => {
    const live = hosted(markAway(EVERYONE_HERE, withHost, 1, 'host'));
    const snap = await changeSeat(GAME, 'u-hana', { type: 'back' }, T0 + 50);
    const { w, hand } = theCommit();
    expect(w.acted).toBe(true);
    expect(hand.moves).toEqual([{ v: live.version + 1, by: 'player', seat: 1, userId: 'u-hana', a: { type: 'back' } }]);
    // Nobody was waiting on Hana, so Abrar's clock runs on as it was.
    expect(w.deadlines).toEqual(live.deadlines);
    expect(snap.mine).toMatchObject({ away: null });

    vi.mocked(store.commitTable).mockClear();
    const again = await changeSeat(GAME, 'u-hana', { type: 'back' }, T0 + 60);
    expect(store.commitTable).not.toHaveBeenCalled();
    expect(again.version).toBe(live.version + 1);
  });

  it('lets someone take a break, saved as their own move, and a bot plays their seat until they’re back', async () => {
    const live = hosted();
    const snap = await changeSeat(GAME, 'u-hana', { type: 'break' }, T0 + 50);
    const { w, hand } = theCommit();
    expect(w.acted).toBe(true);
    expect(hand.moves).toEqual([{ v: live.version + 1, by: 'player', seat: 1, userId: 'u-hana', a: { type: 'away', reason: 'self' } }]);
    // Nobody was waiting on Hana, so Abrar's clock runs on as it was.
    expect(w.deadlines).toEqual(live.deadlines);
    expect(w.table.absence[1]).toMatchObject({ userId: 'u-hana', away: 'self' });
    // Her own table says why; everyone else's says only that a bot's playing for her.
    expect(snap.mine).toMatchObject({ away: 'self' });
    expect((await viewGame(GAME, 'u-abrar', T0 + 60)).seats[1]).toEqual({ kind: 'human', name: 'Hana', presence: 'away' });
    // A second tap writes nothing.
    vi.mocked(store.commitTable).mockClear();
    const again = await changeSeat(GAME, 'u-hana', { type: 'break' }, T0 + 70);
    expect(store.commitTable).not.toHaveBeenCalled();
    expect(again.version).toBe(live.version + 1);
  });

  it('plays a seat on a break at once when it’s that seat’s turn', async () => {
    hosted();
    await changeSeat(GAME, 'u-abrar', { type: 'break' }, T0 + 50);
    const { hand } = theCommit();
    expect(hand.moves[0]).toMatchObject({ by: 'player', seat: 0, userId: 'u-abrar', a: { type: 'away', reason: 'self' } });
    expect(hand.moves[1]).toMatchObject({ by: 'away', seat: 0 });
  });

  it('refuses a break for someone not seated, and once the game is over', async () => {
    hosted();
    expect(await rejection(changeSeat(GAME, 'u-zed', { type: 'break' }, T0))).toMatchObject({ status: 403, message: 'not seated at this table' });
    db.game = { ...(db.game as GameRow), status: 'finished' };
    expect(await rejection(changeSeat(GAME, 'u-hana', { type: 'break' }, T0))).toMatchObject({ status: 409, message: 'game is over' });
    expect(store.commitTable).not.toHaveBeenCalled();
  });

  it('passes the host’s powers on while the host takes a break', async () => {
    hosted();
    await changeSeat(GAME, 'u-hana', { type: 'break' }, T0 + 10);
    expect((await viewGame(GAME, 'u-hana', T0 + 20)).isHost).toBe(false);
    expect((await viewGame(GAME, 'u-abrar', T0 + 20)).isHost).toBe(true);
    expect(await rejection(changeSeat(GAME, 'u-hana', letBotPlay(0), T0 + 30))).toMatchObject({ status: 403 });
  });

  it('tries again on a fresh table when someone else saved first, and gives up after three', async () => {
    const live = hosted();
    db.lose = 1;
    await changeSeat(GAME, 'u-hana', letBotPlay(0), T0);
    expect(commits().map((c) => c.expected)).toEqual([live.version, live.version + 1]);

    vi.clearAllMocks();
    hosted();
    db.lose = 3;
    expect(await rejection(changeSeat(GAME, 'u-hana', letBotPlay(0), T0))).toMatchObject({ status: 409, message: 'the table changed under you; try again' });
    expect(store.commitTable).toHaveBeenCalledTimes(3);
  });

  it('tallies a hand that finished while someone was away without them: their bot’s play isn’t theirs', async () => {
    const live = setTable();
    db.live = { ...live, table: { ...FRESH, absence: markAway(EVERYONE_HERE, seats, 0, 'clock') } };
    // Nobody left to wait on: the next look plays the hand out.
    const snap = await actOnGame(GAME, null, null, null, T0 + 1);
    expect(snap.view.phase).toBe('finished');
    expect(store.recordHand).toHaveBeenCalledWith(seats, expect.objectContaining({ phase: 'finished' }), [true, false, false, false]);
  });
});

describe('keeping seats, and taking them over', () => {
  const zara = { kind: 'human', userId: 'u-zara', name: 'Zara', since: '2026-09-28T19:30:00.000Z' } as const;
  /** Zara has taken Bilal the bot's seat. */
  const withZara: Seats = [seats[0], zara, seats[2], seats[3]];

  it('keeps a leaver’s seat with a bot, has the game’s record follow it, and tells the room whose seat it keeps', async () => {
    setTable();
    const two: Seats = [seats[0], { kind: 'human', userId: 'u-bea', name: 'Bea' }, seats[2], seats[3]];
    db.room = { ...(db.room as RoomRow), seats: two };
    vi.mocked(store.saveSeats).mockReset();
    vi.mocked(store.saveSeats).mockResolvedValueOnce('2026-09-24T00:00:01Z');
    await expect(leaveGame(GAME, 'u-bea', T0)).resolves.toEqual({ abandoned: false });
    const saved = vi.mocked(store.saveSeats).mock.calls[0]![1];
    const kept = { kind: 'bot', name: 'Bilal', heldFor: 'u-bea', keptName: 'Bea', kept: 'left' };
    expect(saved).toEqual([seats[0], kept, seats[2], seats[3]]);
    expect(store.followSeat).toHaveBeenCalledWith(GAME, 1, kept);
    expect(vi.mocked(broadcaster.roomPoke).mock.calls[0]![2]).toMatchObject({
      seats: [expect.anything(), { kind: 'bot', name: 'Bilal', keptFor: 'Bea' }, expect.anything(), expect.anything()],
    });
    expect(JSON.stringify(vi.mocked(broadcaster.roomPoke).mock.calls)).not.toContain('u-bea');
  });

  it('shows someone a bot is keeping a seat for the table, with that seat on offer, and nobody else who isn’t seated', async () => {
    setTable();
    const kept = { kind: 'bot', name: 'Hamza', heldFor: 'u-bea', keptName: 'Bea', kept: 'left' } as const;
    db.room = { ...(db.room as RoomRow), seats: [seats[0], kept, seats[2], seats[3]] };
    const snap = await viewGame(GAME, 'u-bea', T0);
    expect(snap).toMatchObject({ me: null, offer: { seat: 1, botName: 'Hamza', why: 'left', score: 0 }, joinedAt: null, mine: null });
    expect(snap.seats[1]).toEqual({ kind: 'bot', name: 'Hamza', keptFor: 'Bea' });
    expect(JSON.stringify(snap)).not.toContain('u-');
    vi.mocked(store.loadLive).mockClear();
    const err = await rejection(viewGame(GAME, 'u-zed', T0));
    expect(err.status).toBe(403);
    expect(store.loadLive).not.toHaveBeenCalled();
  });

  it('lets someone a bot is keeping a seat for tick the table they’re looking at, as the host may, but never move it', async () => {
    const live = setTable();
    const kept = { kind: 'bot', name: 'Hamza', heldFor: 'u-bea', keptName: 'Bea', kept: 'left' } as const;
    db.room = { ...(db.room as RoomRow), seats: [seats[0], kept, seats[2], seats[3]] };
    const snap = await actOnGame(GAME, 'u-bea', null, null, expired(live));
    expect(snap).toMatchObject({ me: null, offer: { seat: 1, why: 'left' } });
    expect(store.commitTable).toHaveBeenCalledTimes(1);
    const err = await rejection(actOnGame(GAME, 'u-bea', { type: 'pass', seat: 1 }, null, T0));
    expect(err.status).toBe(403);
  });

  it('offers the room’s host, not seated, a bot’s seat to take over, and a seated player none', async () => {
    setTable();
    expect((await viewGame(GAME, 'u-hana', T0)).offer).toEqual({ seat: 1, botName: 'Bilal', why: 'other', score: 0 });
    expect((await viewGame(GAME, 'u-abrar', T0)).offer).toBeNull();
  });

  it('shows a game that has ended to whoever sat at it at the end, after the room has moved on without them', async () => {
    const live = setTable();
    const atEnd: Seats = [seats[0], { kind: 'human', userId: 'u-bea', name: 'Bea' }, seats[2], seats[3]];
    const over: GameOver = { how: 'complete', by: null, at: T0, hands: 16, scores: [1, 2, 3, -6], seats: atEnd };
    db.game = { ...(db.game as GameRow), status: 'finished' };
    db.live = { ...live, table: { ...FRESH, scores: over.scores, over } };
    const snap = await viewGame(GAME, 'u-bea', T0);
    expect(snap).toMatchObject({ status: 'finished', me: 1, offer: null, joinedAt: null });
    expect((await rejection(viewGame(GAME, 'u-zed', T0))).status).toBe(403);
  });

  it('notes a take-over with a commit of its own, and the taker’s table says when they took it while that hand is played', async () => {
    const live = setTable();
    db.room = { ...(db.room as RoomRow), seats: withZara };
    await noteTakeOver(GAME, 'u-zara', T0 + 10);
    const [c] = commits();
    expect(commits()).toHaveLength(1);
    expect(c!.expected).toBe(live.version);
    expect(c!.w.acted).toBe(true);
    const at = { hand: c!.w.state.progress.handIndex, seq: c!.w.state.seq };
    expect(c!.w.table.took).toEqual([null, { userId: 'u-zara', ...at }, null, null]);
    expect(c!.w.hands.flatMap((h) => h.moves).filter((m) => m.seat === 1)).toEqual([]);

    const snap = await viewGame(GAME, 'u-zara', T0 + 20);
    expect(snap).toMatchObject({ me: 1, joinedAt: at, offer: null });
    // Nobody else's table carries it.
    expect((await viewGame(GAME, 'u-abrar', T0 + 20)).joinedAt).toBeNull();

    // Once the hand has finished, or the next one is dealt, it's over.
    const noted = db.live as LiveRow;
    db.live = { ...noted, state: playOut(noted.state) };
    expect((await viewGame(GAME, 'u-zara', T0 + 30)).joinedAt).toBeNull();
    db.live = { ...noted, state: { ...noted.state, progress: { ...noted.state.progress, handIndex: noted.state.progress.handIndex + 1 } } };
    expect((await viewGame(GAME, 'u-zara', T0 + 30)).joinedAt).toBeNull();
  });

  it('notes a take-over on a fresh table when someone else saved first, and only logs a note that couldn’t be saved', async () => {
    const live = setTable();
    db.room = { ...(db.room as RoomRow), seats: withZara };
    db.lose = 1;
    await noteTakeOver(GAME, 'u-zara', T0 + 10);
    expect(commits().map((c) => c.expected)).toEqual([live.version, live.version + 1]);

    setTable();
    db.room = { ...(db.room as RoomRow), seats: withZara };
    vi.mocked(store.commitTable).mockClear();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(store.commitTable).mockRejectedValueOnce(DOWN());
    await expect(noteTakeOver(GAME, 'u-zara', T0 + 10)).resolves.toBeUndefined();
    expect(logged(log)).toEqual([expect.objectContaining({ event: 'take_over_note_failed', gameId: GAME })]);
  });

  it('notes nothing for someone not seated, or a game that has ended', async () => {
    setTable();
    await noteTakeOver(GAME, 'u-zara', T0 + 10);
    db.room = { ...(db.room as RoomRow), seats: withZara };
    db.game = { ...(db.game as GameRow), status: 'finished' };
    await noteTakeOver(GAME, 'u-zara', T0 + 10);
    expect(store.commitTable).not.toHaveBeenCalled();
  });

  describe('a step that read the seats before a take-over', () => {
    /** A table where it's Zara's turn, just after Abrar's discard, with Zara seated in seat 1. */
    function zarasTurn(): { state: HandState; deadlines: Deadlines } {
      for (let i = 0; i < 60; i++) {
        const first = dealFirstHand(karachi, withZara, `took-${i}`, policy, T0);
        const a = analysisBot(viewFor(first.state, karachi, 0), karachi);
        if (first.state.phase !== 'turn' || first.state.turn !== 0 || !a || a.type !== 'discard') continue;
        const r = table.step({ game: first, ruleset: karachi, seats: withZara, policy, now: T0, action: a, actor: 0 });
        if (r.state.phase === 'turn' && r.state.turn === 1) return r;
      }
      throw new Error('no seed gives Zara the turn after Abrar');
    }

    it('reads the room again when the table says someone took a seat the seats it read don’t show, so no bot moves for them', async () => {
      const t = zarasTurn();
      setTable();
      const took = [null, { userId: 'u-zara', hand: t.state.progress.handIndex, seq: t.state.seq }, null, null] as const;
      db.live = liveRow(t.state, t.deadlines, { table: { ...FRESH, took } });
      db.room = { ...(db.room as RoomRow), seats: withZara };
      // The seats as they were before Zara took hers: Bilal the bot's.
      vi.mocked(store.roomById).mockResolvedValueOnce({ ...(db.room as RoomRow), seats });
      await actOnGame(GAME, null, null, null, T0 + 1);
      expect(store.roomById).toHaveBeenCalledTimes(2);
      // Zara's turn, her clock running: nothing to do, so nothing saved, and above all no bot's move for her seat.
      expect(store.commitTable).not.toHaveBeenCalled();
    });

    it('would have had the bot move for her without the note: the note is what tells', async () => {
      const t = zarasTurn();
      setTable();
      db.live = liveRow(t.state, t.deadlines);
      db.room = { ...(db.room as RoomRow), seats: withZara };
      vi.mocked(store.roomById).mockResolvedValueOnce({ ...(db.room as RoomRow), seats });
      await actOnGame(GAME, null, null, null, T0 + 1);
      expect(store.roomById).toHaveBeenCalledTimes(1);
      expect(commits()[0]!.w.hands.flatMap((h) => h.moves)).toContainEqual(expect.objectContaining({ by: 'bot', seat: 1 }));
    });
  });
});
