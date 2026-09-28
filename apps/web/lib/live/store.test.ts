import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVERYONE_HERE } from './absence';
import type { HandState } from '@society/engine';

/**
 * The store against a fake Supabase client. Every query is recorded as its
 * table (or rpc) and the builder calls made on it, and answered by
 * `supabase.answer`, so a test can fail exactly one call and see what the
 * store does with it: a failed read or write throws, a read that finds
 * nothing does not, and only the players' tallies after a hand are allowed
 * to fail quietly.
 */
type Step = readonly [method: string, args: readonly unknown[]];
interface Query {
  readonly target: string;
  readonly steps: Step[];
}
interface Result {
  readonly data: unknown;
  readonly error: { message: string; code?: string } | null;
}

const supabase = vi.hoisted(() => ({
  log: [] as Query[],
  answer: (_q: Query): Result => ({ data: null, error: null }),
}));

vi.mock('server-only', () => ({}));
vi.mock('../supabase/service', () => {
  function query(target: string, steps: Step[] = []): unknown {
    const q: Query = { target, steps };
    supabase.log.push(q);
    const builder: unknown = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then') {
            return (ok: (r: Result) => unknown, fail: (e: unknown) => unknown) =>
              Promise.resolve()
                .then(() => supabase.answer(q))
                .then(ok, fail);
          }
          return (...args: unknown[]) => {
            steps.push([String(prop), args]);
            return builder;
          };
        },
      },
    );
    return builder;
  }
  return {
    createServiceClient: () => ({
      from: (table: string) => query(table),
      rpc: (fn: string, args: unknown) => query(`rpc:${fn}`, [['rpc', [args]]]),
    }),
  };
});

import { SupabaseError, HttpError } from './errors';
import * as store from './store';
import {
  commitTable,
  countHand,
  createRoom,
  dueGames,
  finishGame,
  gameById,
  liveMeta,
  loadLive,
  recordHand,
  roomByCode,
  roomById,
  saveSeats,
  seatStages,
  stagesBySeat,
  startGame,
  type RoomRow,
} from './store';
import { commitArgs, type TableWrite } from './hand-log';
import { STALE_GAME_MS } from './lifecycle';
import { humanLevels, policyFor } from './policy';
import type { GameOver } from './table-state';
import type { LiveGame, LoggedMove, Seats } from './types';

const DOWN = { message: 'TypeError: fetch failed', code: '' };
/** Game ids are uuids, as the database mints them. */
const GAME = '6f1c2a9e-4b7d-4e3a-9c5f-2d8b0a7e1f34';
const ok = (data: unknown = null): Result => ({ data, error: null });
const failed = (): Result => ({ data: null, error: DOWN });

/** Which queries ran, as "table:first builder method" (insert, update, select, delete, upsert or rpc). */
function ran(): string[] {
  return supabase.log.map((q) => `${q.target}:${q.steps[0]?.[0] ?? '?'}`);
}

/** Answer every query well, except those `failing` picks. */
function answerAll(failing: (q: Query) => boolean = () => false, data: (q: Query) => unknown = () => null): void {
  supabase.answer = (q) => (failing(q) ? failed() : ok(data(q)));
}

/** Answer every query well except the n-th (from 0) since the log was cleared. */
function failNth(n: number, data: (q: Query) => unknown = () => null): void {
  answerAll((q) => supabase.log.indexOf(q) === n, data);
}

/** What a call threw, or null when it did not. */
async function thrown(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => null,
    (e: unknown) => e,
  );
}

const is = (target: string, method?: string) => (q: Query) => q.target === target && (method === undefined || q.steps[0]?.[0] === method);

const seats: Seats = [
  { kind: 'human', userId: 'u-abrar', name: 'Abrar' },
  { kind: 'human', userId: 'u-hana', name: 'Hana' },
  { kind: 'bot', name: 'Bilal' },
  { kind: 'bot', name: 'Sana' },
];
const room: RoomRow = {
  id: 'r-1',
  code: 'ABCD',
  host_id: 'u-abrar',
  ruleset_id: 'karachi',
  options: {},
  status: 'playing',
  seats,
  current_game_id: GAME,
  ledger: [0, 0, 0, 0],
  updated_at: '2026-09-24T00:00:00Z',
};
/** Just what closing and opening a hand read of it: Hana (seat 1) wins 8 from Abrar. */
const wonHand = {
  dealer: 0,
  progress: { handIndex: 2 },
  result: { type: 'win', winner: 1, patternId: 'all-pungs', settlement: { transfers: [{ from: 0, to: 1, amount: 8 }] } },
} as unknown as HandState;
const newGame = { id: 'g-2', room_id: 'r-1', seed: 'seed', status: 'active', hands_played: 0 };
const T = Date.parse('2026-09-24T20:00:00.000Z');
/** A deal as the start route hands it over: hand 0 waiting on Abrar's turn clock, with the moves made before it, stamped version 1. */
const dealt = { dealer: 3, progress: { roundWind: 'E', roundIndex: 0, handInRound: 0, handIndex: 0 }, phase: 'turn' } as unknown as HandState;
const first: LiveGame & { moves: LoggedMove[] } = {
  state: dealt,
  deadlines: { claim: null, turn: T + 90_000 },
  moves: [
    { v: 1, by: 'bot', seat: 3, a: { type: 'discard', seat: 3, tile: 's5' } },
    { v: 1, by: 'table', seat: 1, a: { type: 'pass', seat: 1 } },
  ],
};
/** What the deal's queries answer when they work: the new game's row, and the one room the pointer matched. */
const dealAnswers = (q: Query): unknown => (q.target === 'games' ? newGame : q.target === 'rooms' ? [{ id: 'r-1' }] : null);
/** Hana's win, as one request writes it: the hand ends, its points are in the running totals, and a clock waits on nobody. */
const write: TableWrite = {
  state: wonHand,
  table: { v: 1, scores: [-8, 8, 0, 0], over: null, absence: EVERYONE_HERE, ready: null, extra: {} },
  deadlines: { claim: null, turn: null },
  wakeAt: null,
  acted: true,
  hands: [
    {
      hand: 2,
      dealer: 0,
      progress: wonHand.progress,
      moves: [{ v: 4, by: 'player', seat: 1, userId: 'u-hana', a: { type: 'declareWin', seat: 1 } }],
      result: wonHand.result,
      ended: true,
    },
  ],
};

/** The game's last hand scored: Hana finishes top. Abrar and Hana are people, Bilal and Sana bots. */
const END = Date.parse('2026-09-24T22:00:00.000Z');
const OVER: GameOver = { how: 'complete', by: null, at: END, hands: 16, scores: [2000, 14504, -8000, -8504], seats };

/** The room's updated_at as the close wrote it. */
const CLOSED_AT = '2026-09-24T22:00:01.000Z';
/** The one row of the room a finish writes, by what it writes: the close sets the status, a give-back the seats. */
const written = (q: Query): Record<string, unknown> => (q.steps[0]?.[1][0] ?? {}) as Record<string, unknown>;
const isClose = (q: Query) => is('rooms', 'update')(q) && 'status' in written(q);
const isGiveBack = (q: Query) => is('rooms', 'update')(q) && 'seats' in written(q);
/** The room as a finish reads it back: between games after this one, unless `extra` says otherwise. */
const between = (roomSeats: Seats, extra: Partial<RoomRow> = {}) => ({ status: 'finished', current_game_id: GAME, seats: roomSeats, updated_at: CLOSED_AT, ...extra });
/** A finish's queries answered as the database would: the close matches the room and reads back `roomSeats`, and a give-back lands. */
const closing =
  (roomSeats: Seats) =>
  (q: Query): unknown =>
    isClose(q) ? [between(roomSeats)] : isGiveBack(q) ? [{ id: 'r-1' }] : null;

beforeEach(() => {
  supabase.log.length = 0;
  answerAll();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('reads', () => {
  it('say "nothing there" only when the database says so', async () => {
    expect(await roomByCode('abcd')).toBeNull();
    expect(await roomById('r-1')).toBeNull();
    expect(await gameById(GAME)).toBeNull();
    expect(await loadLive('g-1')).toBeNull();
    expect(await dueGames(0)).toEqual([]);
    expect(ran()).toContain('games:select');
  });

  it('hand back what they found', async () => {
    answerAll(undefined, (q) => (q.target === 'rooms' ? room : null));
    expect(await roomByCode('abcd')).toEqual(room);
    expect(supabase.log[0]!.steps).toContainEqual(['eq', ['code', 'ABCD']]);
  });

  it('read the live table with its bookkeeping, clocks and stamps, parsing table_state', async () => {
    const row = {
      version: 7,
      state: wonHand,
      claim_deadline: null,
      turn_deadline: '2026-09-24T20:01:30.000Z',
      table_state: { v: 1, scores: [-8, 8, 0, 0], ready: { hand: 2, userIds: ['u-a'], dealAt: T + 20_000 }, later: { hand: 2 } },
      wake_at: '2026-09-24T20:01:30.000Z',
      acted_at: '2026-09-24T19:59:00.000Z',
      updated_at: '2026-09-24T20:00:00.000Z',
    };
    answerAll(undefined, () => row);
    expect(await loadLive(GAME)).toEqual({
      version: 7,
      state: wonHand,
      deadlines: { claim: null, turn: T + 90_000 },
      table: { v: 1, scores: [-8, 8, 0, 0], over: null, absence: EVERYONE_HERE, ready: { hand: 2, userIds: ['u-a'], dealAt: T + 20_000 }, extra: { later: { hand: 2 } } },
      legacy: false,
      wakeAt: T + 90_000,
      actedAt: T - 60_000,
      updatedAt: T,
    });
    expect(supabase.log[0]!.steps).toEqual([
      ['select', ['version, state, claim_deadline, turn_deadline, table_state, wake_at, acted_at, updated_at']],
      ['eq', ['game_id', GAME]],
      ['maybeSingle', []],
    ]);

    // A table last saved by older code: 0005's '{}' is legacy, with no scores of its own; no wake time stays none.
    answerAll(undefined, () => ({ ...row, table_state: {}, wake_at: null }));
    const legacy = await loadLive(GAME);
    expect(legacy).toMatchObject({ table: { scores: null, extra: {} }, legacy: true, wakeAt: null, actedAt: T - 60_000, updatedAt: T });
  });

  it('throw when the database fails, instead of passing for "no such room" or an empty table', async () => {
    answerAll(() => true);
    const reads = [() => roomByCode('ABCD'), () => roomById('r-1'), () => gameById(GAME), () => loadLive('g-1'), () => dueGames(0)];
    for (const read of reads) await expect(read()).rejects.toBeInstanceOf(SupabaseError);
  });

  it('find no game for an id that is not a uuid, without asking the database, which would fail the query', async () => {
    supabase.answer = () => ({ data: null, error: { message: 'invalid input syntax for type uuid: "not-a-uuid"', code: '22P02' } });
    for (const id of ['not-a-uuid', '', `${GAME}x`, GAME.slice(0, -1)]) expect(await gameById(id)).toBeNull();
    expect(supabase.log).toHaveLength(0);
    await expect(gameById(GAME)).rejects.toBeInstanceOf(SupabaseError);
  });

  it("give each seat its own player's level, matching the rows to the seats by id whatever order they come back in", async () => {
    const mixed: Seats = [{ kind: 'bot', name: 'Bilal' }, { kind: 'human', userId: 'u-abrar', name: 'Abrar' }, null, { kind: 'human', userId: 'u-hana', name: 'Hana' }];
    answerAll(undefined, () => [
      { id: 'u-hana', stats: { hands: 30, wins: 4 } },
      { id: 'u-abrar', stats: { hands: 2, wins: 0 } },
    ]);
    expect(await stagesBySeat(mixed)).toEqual([null, 'learning', null, 'solid']);
    expect(ran()).toEqual(['profiles:select']);
    expect(supabase.log[0]!.steps).toEqual([
      ['select', ['id, stats']],
      ['in', ['id', ['u-abrar', 'u-hana']]],
    ]);
  });

  it('count a human with no profile row, or no tally on it, as new', async () => {
    answerAll(undefined, () => [{ id: 'u-hana', stats: null }]);
    expect(await stagesBySeat(seats)).toEqual(['new', 'new', null, null]);
    // Read, and new: a newcomer, not a failed read.
    expect(await seatStages(seats)).toEqual({ levels: ['new', 'new', null, null], read: true });
    answerAll(undefined, () => null);
    expect(await stagesBySeat(seats)).toEqual(['new', 'new', null, null]);
  });

  it('count every human as new when the player levels cannot be read, so the clocks are the most patient and the bots gentle, and log it', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    answerAll(is('profiles'));
    const stages = await stagesBySeat(seats);
    expect(stages).toEqual(['new', 'new', null, null]);
    expect(policyFor(humanLevels(stages))).toEqual(policyFor(['new']));
    expect(log).toHaveBeenCalledTimes(1);
    const line = JSON.parse(log.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(line).toMatchObject({ level: 'error', event: 'stages_read_failed', name: 'SupabaseError', message: 'could not read the player levels: TypeError: fetch failed' });
    // Asked, the store says those levels weren't read, so the funnel doesn't count them as a table of first-timers.
    expect(await seatStages(seats)).toEqual({ levels: ['new', 'new', null, null], read: false });
  });

  it('skip the database when there is nobody to look up', async () => {
    const bots: Seats = [null, { kind: 'bot', name: 'Bilal' }, null, null];
    expect(await stagesBySeat(bots)).toEqual([null, null, null, null]);
    expect(supabase.log).toHaveLength(0);
  });
});

describe('the sweep asking which tables to visit', () => {
  const iso = new Date(T).toISOString();
  const due = (q: Query) => q.steps.some(([m]) => m === 'lte');
  const rows = (...ids: string[]) => ids.map((game_id) => ({ game_id, games: { status: 'active' } }));

  it('asks for games in play whose wake time has passed, earliest first, then for those with no wake time, least recently saved first', async () => {
    answerAll(undefined, (q) => (due(q) ? rows('g-late', 'g-later') : rows('g-parked')));
    expect(await dueGames(T)).toEqual(['g-late', 'g-later', 'g-parked']);
    expect(supabase.log).toEqual([
      {
        target: 'live_state',
        steps: [
          ['select', ['game_id, games!inner(status)']],
          ['eq', ['games.status', 'active']],
          ['lte', ['wake_at', iso]],
          ['order', ['wake_at', { ascending: true }]],
          ['limit', [50]],
        ],
      },
      {
        target: 'live_state',
        steps: [
          ['select', ['game_id, games!inner(status)']],
          ['eq', ['games.status', 'active']],
          ['is', ['wake_at', null]],
          ['order', ['updated_at', { ascending: true }]],
          ['limit', [48]],
        ],
      },
    ]);
    // It never asks about the clocks themselves: wake_at is the one column the sweep reads.
    expect(JSON.stringify(supabase.log)).not.toMatch(/deadline/);
  });

  it('asks only for what the due tables left of the limit, and nothing more once they fill it, so parked tables never crowd them out', async () => {
    answerAll(undefined, (q) => (due(q) ? rows('g-1', 'g-2', 'g-3') : rows('g-parked')));
    expect(await dueGames(T, 3)).toEqual(['g-1', 'g-2', 'g-3']);
    expect(supabase.log).toHaveLength(1);

    supabase.log.length = 0;
    answerAll(undefined, (q) => (due(q) ? rows('g-1') : rows('g-parked')));
    expect(await dueGames(T, 3)).toEqual(['g-1', 'g-parked']);
    expect(supabase.log[1]!.steps).toContainEqual(['limit', [2]]);
  });

  it('keeps the label the ops runbook quotes on both questions, and stops at the first that fails', async () => {
    answerAll(due);
    const first = await thrown(dueGames(T));
    expect(first).toBeInstanceOf(SupabaseError);
    expect((first as SupabaseError).what).toBe('find tables past their clocks');
    expect(supabase.log).toHaveLength(1);

    supabase.log.length = 0;
    answerAll((q) => !due(q));
    const second = await thrown(dueGames(T));
    expect(second).toBeInstanceOf(SupabaseError);
    expect((second as SupabaseError).what).toBe('find tables past their clocks');
    expect(supabase.log).toHaveLength(2);
  });
});

/**
 * Every write, with the label of each query it makes, in order. Each query
 * must be checked: whichever one fails, the write throws a SupabaseError
 * naming that query and makes no query after it. The players' tallies
 * (recordHand) are the one exception, and have their own test below.
 */
interface Write {
  readonly name: string;
  readonly run: () => Promise<unknown>;
  readonly labels: readonly string[];
  /** what a query that works answers */
  readonly data?: (q: Query) => unknown;
  /** after a failure at any query but its first, it deletes the game it made before throwing (startGame) */
  readonly dropsGame?: boolean;
}
const WRITES: readonly Write[] = [
  {
    name: 'createRoom',
    run: () => createRoom({ code: 'ABCD', hostId: 'u-abrar', hostName: 'Abrar', rulesetId: 'karachi', options: {} }),
    labels: ['create the room'],
    data: () => room,
  },
  { name: 'saveSeats', run: () => saveSeats('r-1', seats, room.updated_at), labels: ['save the seats'], data: () => [{ updated_at: room.updated_at }] },
  { name: 'commitTable', run: () => commitTable(GAME, 3, write), labels: ['save the table'], data: () => 4 },
  {
    name: 'startGame',
    run: () => startGame(room, 'seed', seats, first),
    labels: ['create the game', 'open the first hand', 'seat the players', 'deal the first hand', 'point the room at the game'],
    data: dealAnswers,
    dropsGame: true,
  },
  { name: 'finishGame', run: () => finishGame(GAME, room, OVER), data: closing(seats), labels: ['record how everyone finished', 'close the room', 'finish the game'] },
  { name: 'countHand', run: () => countHand(GAME), labels: ['count the hand'] },
];

describe('writes', () => {
  it.each(WRITES)('$name throws at whichever of its queries fails, naming it, and goes no further', async (w) => {
    answerAll(undefined, w.data);
    expect(await thrown(w.run())).toBeNull();
    expect(supabase.log).toHaveLength(w.labels.length);

    for (const [i, label] of w.labels.entries()) {
      supabase.log.length = 0;
      failNth(i, w.data);
      const err = await thrown(w.run());
      expect(err).toBeInstanceOf(SupabaseError);
      expect((err as SupabaseError).what).toBe(label);
      // Nothing after the failed query, except that a deal that had made its game deletes it.
      const drops = w.dropsGame === true && i > 0;
      expect(supabase.log).toHaveLength(i + 1 + (drops ? 1 : 0));
      if (drops) expect(ran().at(-1)).toBe('games:delete');
    }
  });

  it('still tell a lost race from a failure: no row matched is null, not a throw', async () => {
    answerAll(undefined, () => []);
    expect(await saveSeats('r-1', seats, room.updated_at)).toBeNull();
    answerAll(undefined, () => null);
    expect(await commitTable(GAME, 3, write)).toBeNull();
  });
});

/**
 * The deal: five writes in an order that can't leave half a table. A game
 * that doesn't make it all the way is deleted (its hand, players and live
 * table go with it), so the room is never pointed at one that isn't all there,
 * and the error thrown is always the one that stopped the deal.
 */
describe('dealing a game', () => {
  /** The first argument of the first query on this table made this way: the row(s) it wrote. */
  const wrote = (target: string, method: string): unknown => supabase.log.find(is(target, method))!.steps[0]![1][0];
  /** Every write after the game's own row. */
  const AFTER_THE_GAME = [
    { label: 'open the first hand', at: is('hands', 'insert') },
    { label: 'seat the players', at: is('game_players', 'insert') },
    { label: 'deal the first hand', at: is('live_state', 'insert') },
    { label: 'point the room at the game', at: is('rooms', 'update') },
  ];
  /** The one error line logged, parsed. */
  const logged = (log: { mock: { calls: unknown[][] } }): Record<string, unknown> => {
    expect(log.mock.calls).toHaveLength(1);
    return JSON.parse(log.mock.calls[0]![0] as string) as Record<string, unknown>;
  };

  it("writes the game, its first hand with the deal's moves, who sat where, the live table, then the room, in that order", async () => {
    answerAll(undefined, dealAnswers);
    expect(await startGame(room, 'seed', seats, first)).toEqual(newGame);
    expect(ran()).toEqual(['games:insert', 'hands:insert', 'game_players:insert', 'live_state:insert', 'rooms:update']);
    expect(wrote('games', 'insert')).toEqual({ room_id: 'r-1', seed: 'seed' });
    expect(wrote('hands', 'insert')).toEqual({ game_id: 'g-2', hand_index: 0, dealer: 3, progress: dealt.progress, actions: first.moves });
    expect(wrote('game_players', 'insert')).toEqual([
      { game_id: 'g-2', seat: 0, user_id: 'u-abrar', kind: 'human', name: 'Abrar' },
      { game_id: 'g-2', seat: 1, user_id: 'u-hana', kind: 'human', name: 'Hana' },
      { game_id: 'g-2', seat: 2, user_id: null, kind: 'bot', name: 'Bilal' },
      { game_id: 'g-2', seat: 3, user_id: null, kind: 'bot', name: 'Sana' },
    ]);
    // Fresh bookkeeping (version 1, nobody on any points) and the wake time; acted_at is left to the database's now.
    expect(wrote('live_state', 'insert')).toEqual({
      game_id: 'g-2',
      version: 1,
      state: dealt,
      table_state: { v: 1, scores: [0, 0, 0, 0] },
      claim_deadline: null,
      turn_deadline: '2026-09-24T20:01:30.000Z',
      wake_at: '2026-09-24T20:01:30.000Z',
    });
    const point = supabase.log.find(is('rooms', 'update'))!;
    expect(point.steps[0]).toEqual(['update', [{ status: 'playing', current_game_id: 'g-2', seats, updated_at: expect.any(String) }]]);
    expect(point.steps).toContainEqual(['eq', ['id', 'r-1']]);
    expect(point.steps).toContainEqual(['eq', ['updated_at', room.updated_at]]);
  });

  it('wakes the table at its earliest clock', async () => {
    const cases = [
      { deadlines: { claim: T + 30_000, turn: T + 90_000 }, wake: '2026-09-24T20:00:30.000Z' },
      { deadlines: { claim: T + 30_000, turn: null }, wake: '2026-09-24T20:00:30.000Z' },
    ];
    for (const { deadlines, wake } of cases) {
      supabase.log.length = 0;
      answerAll(undefined, dealAnswers);
      await startGame(room, 'seed', seats, { ...first, deadlines });
      expect(wrote('live_state', 'insert')).toMatchObject({ wake_at: wake });
    }
  });

  it('wakes a table with no clock running when it would end as idle: six hours after the deal, the host’s own move', async () => {
    supabase.log.length = 0;
    answerAll(undefined, dealAnswers);
    const before = Date.now();
    await startGame(room, 'seed', seats, { ...first, deadlines: { claim: null, turn: null } });
    const after = Date.now();
    const wake = Date.parse((wrote('live_state', 'insert') as { wake_at: string }).wake_at);
    expect(wake).toBeGreaterThanOrEqual(before + STALE_GAME_MS);
    expect(wake).toBeLessThanOrEqual(after + STALE_GAME_MS);
  });

  it.each(AFTER_THE_GAME)('deletes the game when "$label" fails, and throws that failure', async ({ label, at }) => {
    answerAll(at, dealAnswers);
    const err = await thrown(startGame(room, 'seed', seats, first));
    expect(err).toBeInstanceOf(SupabaseError);
    expect((err as SupabaseError).what).toBe(label);
    const failedAt = supabase.log.findIndex(at);
    expect(supabase.log).toHaveLength(failedAt + 2);
    expect(supabase.log.at(-1)).toEqual({
      target: 'games',
      steps: [
        ['delete', []],
        ['eq', ['id', 'g-2']],
      ],
    });
  });

  it('still throws the failure that stopped the deal when the game cannot be deleted either, and logs the delete as drop_game_failed', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    answerAll((q) => is('game_players', 'insert')(q) || is('games', 'delete')(q), dealAnswers);
    const err = await thrown(startGame(room, 'seed', seats, first));
    expect((err as SupabaseError).what).toBe('seat the players');
    expect(ran()).toEqual(['games:insert', 'hands:insert', 'game_players:insert', 'games:delete']);
    expect(logged(log)).toMatchObject({
      level: 'error',
      event: 'drop_game_failed',
      gameId: 'g-2',
      name: 'SupabaseError',
      message: 'could not drop the unstarted game: TypeError: fetch failed',
    });
  });

  it('deletes the game and asks the host to start again when the seats moved before the deal, even if the delete fails', async () => {
    answerAll(undefined, (q) => (q.target === 'rooms' ? [] : dealAnswers(q)));
    const err = await thrown(startGame(room, 'seed', seats, first));
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 409, message: 'the seats changed; start again' });
    expect(ran()).toEqual(['games:insert', 'hands:insert', 'game_players:insert', 'live_state:insert', 'rooms:update', 'games:delete']);

    supabase.log.length = 0;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    answerAll(is('games', 'delete'), (q) => (q.target === 'rooms' ? [] : dealAnswers(q)));
    expect(await thrown(startGame(room, 'seed', seats, first))).toMatchObject({ status: 409, message: 'the seats changed; start again' });
    expect(logged(log)).toMatchObject({ event: 'drop_game_failed', gameId: 'g-2' });
  });

  it('writes who sat where once more without ids when a seated person has no profile row, and logs it as profile_missing', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const noProfile = { message: 'insert or update on table "game_players" violates foreign key constraint "game_players_user_id_fkey"', code: '23503' };
    let tries = 0;
    supabase.answer = (q) => (is('game_players', 'insert')(q) && tries++ === 0 ? { data: null, error: noProfile } : ok(dealAnswers(q)));
    expect(await startGame(room, 'seed', seats, first)).toEqual(newGame);
    expect(ran()).toEqual(['games:insert', 'hands:insert', 'game_players:insert', 'game_players:insert', 'live_state:insert', 'rooms:update']);
    const [, again] = supabase.log.filter(is('game_players', 'insert'));
    expect(again!.steps[0]![1][0]).toEqual([
      { game_id: 'g-2', seat: 0, user_id: null, kind: 'human', name: 'Abrar' },
      { game_id: 'g-2', seat: 1, user_id: null, kind: 'human', name: 'Hana' },
      { game_id: 'g-2', seat: 2, user_id: null, kind: 'bot', name: 'Bilal' },
      { game_id: 'g-2', seat: 3, user_id: null, kind: 'bot', name: 'Sana' },
    ]);
    expect(logged(log)).toMatchObject({ level: 'error', event: 'profile_missing', gameId: 'g-2', code: '23503', message: `could not seat the players: ${noProfile.message}` });
    expect(log.mock.calls[0]![0]).not.toContain('u-abrar');
  });

  it('tries only once more, and not at all for any other failure, before giving the deal up', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    supabase.answer = (q) => (is('game_players', 'insert')(q) ? { data: null, error: { message: 'still no profile', code: '23503' } } : ok(dealAnswers(q)));
    expect(await thrown(startGame(room, 'seed', seats, first))).toMatchObject({ what: 'seat the players', code: '23503' });
    expect(ran()).toEqual(['games:insert', 'hands:insert', 'game_players:insert', 'game_players:insert', 'games:delete']);

    supabase.log.length = 0;
    answerAll(is('game_players', 'insert'), dealAnswers);
    expect(await thrown(startGame(room, 'seed', seats, first))).toMatchObject({ what: 'seat the players' });
    expect(ran()).toEqual(['games:insert', 'hands:insert', 'game_players:insert', 'games:delete']);
  });
});

/**
 * The bookkeeping around a game that has ended, written from its saved end
 * (table_state.over): who finished where, the room, then the game's own row
 * last, since that's what tells a later request the job is done. Every write
 * sets values, so it can all run again.
 */
describe('finishing a game', () => {
  /** The first argument of the first query on this table made this way: the row(s) it wrote. */
  const wrote = (target: string, method: string): unknown => supabase.log.find(is(target, method))!.steps[0]![1][0];

  beforeEach(() => answerAll(undefined, closing(seats)));

  it('writes who finished where, closes the room, then marks the game, in that order, leaving the table itself alone', async () => {
    await finishGame(GAME, room, OVER);
    expect(ran()).toEqual(['game_players:upsert', 'rooms:update', 'games:update']);
    const players = supabase.log.find(is('game_players', 'upsert'))!;
    expect(players.steps).toEqual([
      [
        'upsert',
        [
          [
            { game_id: GAME, seat: 0, user_id: 'u-abrar', kind: 'human', name: 'Abrar', score: 2000, place: 2 },
            { game_id: GAME, seat: 1, user_id: 'u-hana', kind: 'human', name: 'Hana', score: 14504, place: 1 },
            { game_id: GAME, seat: 2, user_id: null, kind: 'bot', name: 'Bilal', score: -8000, place: 3 },
            { game_id: GAME, seat: 3, user_id: null, kind: 'bot', name: 'Sana', score: -8504, place: 4 },
          ],
          { onConflict: 'game_id,seat' },
        ],
      ],
    ]);
    expect(wrote('rooms', 'update')).toEqual({ status: 'finished', updated_at: expect.any(String) });
    const game = supabase.log.find(is('games', 'update'))!;
    expect(game.steps).toEqual([
      ['update', [{ status: 'finished', ended_at: '2026-09-24T22:00:00.000Z', finished_at: '2026-09-24T22:00:00.000Z', ended_how: 'complete', ended_by: null, hands_played: 16 }]],
      ['eq', ['id', GAME]],
    ]);
  });

  it('records who ended it, when someone did', async () => {
    await finishGame(GAME, room, { ...OVER, how: 'host', by: { userId: 'u-hana', name: 'Hana' }, hands: 7 });
    expect(wrote('games', 'update')).toMatchObject({ status: 'finished', ended_how: 'host', ended_by: 'u-hana', hands_played: 7 });
  });

  it('marks an abandoned game abandoned, with no finish time and nobody placed', async () => {
    await finishGame(GAME, room, { ...OVER, how: 'abandoned', hands: 3 });
    expect((wrote('game_players', 'upsert') as { place: unknown }[]).map((r) => r.place)).toEqual([null, null, null, null]);
    const game = wrote('games', 'update');
    expect(game).toEqual({ status: 'abandoned', ended_at: '2026-09-24T22:00:00.000Z', ended_how: 'abandoned', ended_by: null, hands_played: 3 });
    expect(game).not.toHaveProperty('finished_at');
  });

  it('closes the room only while it still holds this game and is playing it, so a repeat, or a room dealt again, doesn’t close it again', async () => {
    await finishGame(GAME, room, OVER);
    const close = supabase.log.find(isClose)!;
    expect(close.steps).toContainEqual(['eq', ['id', 'r-1']]);
    expect(close.steps).toContainEqual(['eq', ['current_game_id', GAME]]);
    expect(close.steps).toContainEqual(['eq', ['status', 'playing']]);
    expect(close.steps).toContainEqual(['select', ['status, current_game_id, seats, updated_at']]);

    // A room that has moved on, or already closed, matches no row, which is not a failure: the old game is still finished. The
    // room is read instead, for the give-back, and this one has nothing to give back.
    supabase.log.length = 0;
    answerAll(undefined, (q) => (isClose(q) ? [] : is('rooms', 'select')(q) ? between(seats) : null));
    await finishGame(GAME, room, OVER);
    expect(ran()).toEqual(['game_players:upsert', 'rooms:update', 'rooms:select', 'games:update']);
  });

  describe('someone leaving as the last hand is scored', () => {
    /** The room as the close finds it: Hana's leave landed after the end was committed, and a bot has her seat. */
    const left: Seats = [seats[0], { kind: 'bot', name: 'Ayesha' }, seats[2], seats[3]];
    const zara = { kind: 'human', userId: 'u-zara', name: 'Zara', since: '2026-09-24T22:00:02.000Z' } as const;
    /** The room read again after the close, `updated_at` moved on by whatever landed in between. */
    const LATER = '2026-09-24T22:00:02.500Z';
    const reads = (row: unknown) => (q: Query) => (is('rooms', 'select')(q) ? row : null);
    /** A give-back that loses (someone else wrote the room first) matches no row. */
    const losing = (n: number) => {
      let lost = 0;
      return (q: Query) => (isGiveBack(q) && lost++ < n ? [] : undefined);
    };
    /** The first of these answers that has one for the query, else the usual. */
    const answers =
      (...fns: ((q: Query) => unknown)[]) =>
      (q: Query): unknown => {
        for (const fn of fns) {
          const out = fn(q);
          if (out !== undefined && out !== null) return out;
        }
        return closing(left)(q);
      };
    const givenBack = () => supabase.log.filter(isGiveBack);

    it('gives the seat back once it has closed the room, on the time the close wrote, while the room is between games after this one', async () => {
      answerAll(undefined, closing(left));
      await finishGame(GAME, room, OVER);
      expect(ran()).toEqual(['game_players:upsert', 'rooms:update', 'rooms:update', 'games:update']);
      const [back] = givenBack();
      expect(back!.steps[0]).toEqual(['update', [{ seats, updated_at: expect.any(String) }]]);
      expect(back!.steps).toContainEqual(['eq', ['id', 'r-1']]);
      // Only if nobody has written the room since the close, and it hasn't been dealt again.
      expect(back!.steps).toContainEqual(['eq', ['updated_at', CLOSED_AT]]);
      expect(back!.steps).toContainEqual(['eq', ['current_game_id', GAME]]);
      expect(back!.steps).toContainEqual(['eq', ['status', 'finished']]);
    });

    it('still gives the seat back when a write that has nothing to do with it lands first, such as someone sitting in another seat', async () => {
      // Bilal's seat comes before Hana's here, so a newcomer taking the first bot's seat between games takes his, not hers.
      const atEnd: Seats = [seats[0], seats[2], seats[1], seats[3]];
      const leftHers: Seats = [seats[0], seats[2], { kind: 'bot', name: 'Ayesha' }, seats[3]];
      const joined: Seats = [seats[0], zara, { kind: 'bot', name: 'Ayesha' }, seats[3]];
      answerAll(
        undefined,
        answers(losing(1), (q) => (isClose(q) ? [between(leftHers)] : undefined), reads(between(joined, { updated_at: LATER }))),
      );
      await finishGame(GAME, room, { ...OVER, seats: atEnd });
      expect(ran()).toEqual(['game_players:upsert', 'rooms:update', 'rooms:update', 'rooms:select', 'rooms:update', 'games:update']);
      const [, again] = givenBack();
      // Worked out afresh from the room as it now is: Zara keeps the seat she took, and Hana gets hers back.
      expect(written(again!)).toEqual({ seats: [seats[0], zara, seats[1], seats[3]], updated_at: expect.any(String) });
      expect(again!.steps).toContainEqual(['eq', ['updated_at', LATER]]);
    });

    it('never takes back a seat a person has taken since, and then writes nothing more', async () => {
      answerAll(undefined, answers(losing(1), reads(between([seats[0], zara, seats[2], seats[3]], { updated_at: LATER }))));
      await finishGame(GAME, room, OVER);
      expect(ran()).toEqual(['game_players:upsert', 'rooms:update', 'rooms:update', 'rooms:select', 'games:update']);
    });

    it('gives up after three writes that lose, throwing so the game stays active and the next finish tries again', async () => {
      answerAll(undefined, answers(losing(3), reads(between(left, { updated_at: LATER }))));
      expect(await thrown(finishGame(GAME, room, OVER))).toMatchObject({ message: 'could not give back the seats: the room kept changing' });
      expect(ran()).toEqual(['game_players:upsert', 'rooms:update', 'rooms:update', 'rooms:select', 'rooms:update', 'rooms:select', 'rooms:update']);
    });

    it('gives the seat back on a repeat finish, from the room as it reads, when a give-back before it failed', async () => {
      answerAll(
        undefined,
        answers((q) => (isClose(q) ? [] : undefined), reads(between(left, { updated_at: LATER }))),
      );
      await finishGame(GAME, room, OVER);
      expect(ran()).toEqual(['game_players:upsert', 'rooms:update', 'rooms:select', 'rooms:update', 'games:update']);
      const [back] = givenBack();
      expect(written(back!)).toEqual({ seats, updated_at: expect.any(String) });
      expect(back!.steps).toContainEqual(['eq', ['updated_at', LATER]]);
    });

    it('never touches a room dealt again, or one that isn’t there any more', async () => {
      for (const row of [between(left, { status: 'playing', current_game_id: 'g-2' }), between(left, { current_game_id: 'g-2' }), null]) {
        supabase.log.length = 0;
        answerAll(
          undefined,
          answers((q) => (isClose(q) ? [] : undefined), reads(row)),
        );
        await finishGame(GAME, room, OVER);
        expect(ran()).toEqual(['game_players:upsert', 'rooms:update', 'rooms:select', 'games:update']);
      }
    });

    it('writes nothing more when nobody left at the last moment', async () => {
      await finishGame(GAME, room, OVER);
      expect(ran()).toEqual(['game_players:upsert', 'rooms:update', 'games:update']);
    });

    it('throws naming the give-back when it fails, leaving the game active', async () => {
      answerAll(isGiveBack, closing(left));
      expect(await thrown(finishGame(GAME, room, OVER))).toMatchObject({ what: 'give back the seats' });
      expect(ran()).toEqual(['game_players:upsert', 'rooms:update', 'rooms:update']);
    });
  });

  it('leaves the game active whichever write fails, so it can be run again from the start', async () => {
    for (const i of [0, 1, 2]) {
      supabase.log.length = 0;
      failNth(i, closing(seats));
      await expect(finishGame(GAME, room, OVER)).rejects.toBeInstanceOf(SupabaseError);
      // The game's status is the last write: when anything before it fails it never runs, and when it fails it did not land.
      expect(supabase.log).toHaveLength(i + 1);
    }
    // Run again once the database is back, every write goes through, and writes the same.
    supabase.log.length = 0;
    answerAll(undefined, closing(seats));
    await finishGame(GAME, room, OVER);
    expect(ran()).toEqual(['game_players:upsert', 'rooms:update', 'games:update']);
  });

  it('writes who finished where once more without ids when a person has no profile row, and logs it as profile_missing', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const noProfile = { message: 'insert or update on table "game_players" violates foreign key constraint "game_players_user_id_fkey"', code: '23503' };
    let tries = 0;
    supabase.answer = (q) => (is('game_players', 'upsert')(q) && tries++ === 0 ? { data: null, error: noProfile } : ok(closing(seats)(q)));
    await finishGame(GAME, room, OVER);
    expect(ran()).toEqual(['game_players:upsert', 'game_players:upsert', 'rooms:update', 'games:update']);
    const [, again] = supabase.log.filter(is('game_players', 'upsert'));
    expect((again!.steps[0]![1][0] as { user_id: unknown }[]).map((r) => r.user_id)).toEqual([null, null, null, null]);
    expect(again!.steps[0]![1][1]).toEqual({ onConflict: 'game_id,seat' });
    expect(log.mock.calls).toHaveLength(1);
    expect(JSON.parse(log.mock.calls[0]![0] as string)).toMatchObject({ event: 'profile_missing', gameId: GAME, code: '23503' });
    expect(log.mock.calls[0]![0]).not.toContain('u-abrar');
  });

  it('marks the game without who ended it when that person has no profile row, and logs it', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const noProfile = { message: 'insert or update on table "games" violates foreign key constraint "games_ended_by_fkey"', code: '23503' };
    let tries = 0;
    supabase.answer = (q) => (is('games', 'update')(q) && tries++ === 0 ? { data: null, error: noProfile } : ok());
    await finishGame(GAME, room, { ...OVER, how: 'host', by: { userId: 'u-hana', name: 'Hana' } });
    const games = supabase.log.filter(is('games', 'update'));
    expect(games.map((q) => (q.steps[0]![1][0] as { ended_by: unknown }).ended_by)).toEqual(['u-hana', null]);
    expect(games[1]!.steps[0]![1][0]).toMatchObject({ status: 'finished', ended_how: 'host', hands_played: 16 });
    expect(JSON.parse(log.mock.calls[0]![0] as string)).toMatchObject({ event: 'profile_missing', gameId: GAME, code: '23503' });
    expect(log.mock.calls[0]![0]).not.toContain('u-hana');
  });

  it('tries only once more, and only for a missing profile', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    supabase.answer = (q) => (is('games', 'update')(q) ? { data: null, error: { message: 'still no profile', code: '23503' } } : ok());
    expect(await thrown(finishGame(GAME, room, { ...OVER, how: 'host', by: { userId: 'u-hana', name: 'Hana' } }))).toMatchObject({ what: 'finish the game', code: '23503' });
    expect(supabase.log.filter(is('games', 'update'))).toHaveLength(2);

    // Nobody ended a game whose last hand was scored, so a 23503 there isn't a missing profile, and nothing is tried again.
    supabase.log.length = 0;
    expect(await thrown(finishGame(GAME, room, OVER))).toMatchObject({ what: 'finish the game' });
    expect(supabase.log.filter(is('games', 'update'))).toHaveLength(1);
  });
});

describe('what the room routes read of a live table', () => {
  it('reads the bookkeeping, the stamps and where the hand stands, never the hand itself', async () => {
    answerAll(undefined, () => ({
      version: 12,
      table_state: { v: 1, scores: OVER.scores, over: OVER },
      acted_at: '2026-09-24T19:59:00.000Z',
      updated_at: '2026-09-24T20:00:00.000Z',
      hand: 15,
      seq: 88,
    }));
    expect(await liveMeta(GAME)).toEqual({
      version: 12,
      table: { v: 1, scores: OVER.scores, over: JSON.parse(JSON.stringify(OVER)), absence: EVERYONE_HERE, ready: null, extra: {} },
      legacy: false,
      actedAt: T - 60_000,
      updatedAt: T,
      hand: 15,
      seq: 88,
    });
    const [select] = supabase.log[0]!.steps;
    expect(supabase.log[0]!.target).toBe('live_state');
    expect(select).toEqual(['select', ['version, table_state, acted_at, updated_at, hand:state->progress->handIndex, seq:state->seq']]);
    // Only paths into the state: never every seat's tiles.
    expect((select![1][0] as string).split(', ')).not.toContain('state');
    expect(supabase.log[0]!.steps).toContainEqual(['eq', ['game_id', GAME]]);
  });

  it('gives null for a game with no live table, reads a legacy row as legacy, and throws when the database fails', async () => {
    answerAll(undefined, () => null);
    expect(await liveMeta(GAME)).toBeNull();
    answerAll(undefined, () => ({ version: 1, table_state: {}, acted_at: null, updated_at: '2026-09-24T20:00:00.000Z', hand: null, seq: 'x' }));
    expect(await liveMeta(GAME)).toMatchObject({ legacy: true, table: { scores: null, over: null }, actedAt: T, hand: 0, seq: 0 });
    answerAll(() => true);
    expect(await thrown(liveMeta(GAME))).toMatchObject({ what: 'read the table' });
  });
});

describe('saving the live table', () => {
  it('is one commit_table call, whose argument is exactly what commitArgs builds, and gives back the new version', async () => {
    answerAll(undefined, () => 4);
    expect(await commitTable(GAME, 3, write)).toBe(4);
    expect(supabase.log).toEqual([{ target: 'rpc:commit_table', steps: [['rpc', [commitArgs(GAME, 3, write)]]] }]);
    const [args] = supabase.log[0]!.steps[0]![1] as [Record<string, unknown>];
    expect(args).toMatchObject({ p_game_id: GAME, p_expected: 3, p_acted: true, p_wake_at: null, p_table_state: { v: 1, scores: [-8, 8, 0, 0] } });
  });

  it('gives null when someone else saved first, and throws, once and without trying again, when the database fails', async () => {
    answerAll(undefined, () => null);
    expect(await commitTable(GAME, 3, write)).toBeNull();
    supabase.log.length = 0;
    answerAll(() => true);
    const err = await thrown(commitTable(GAME, 3, write));
    expect(err).toBeInstanceOf(SupabaseError);
    expect((err as SupabaseError).what).toBe('save the table');
    expect(ran()).toEqual(['rpc:commit_table:rpc']);
  });

  it('is the only way the store writes a live table: nothing updates live_state, writes hand_results or writes rooms.ledger', async () => {
    for (const gone of ['saveLive', 'appendAction', 'openHand', 'endHand', 'settleScores', 'recordResult', 'clearDeadlines', 'abandonGame'])
      expect(store, gone).not.toHaveProperty(gone);
    const everything: (() => Promise<unknown>)[] = [
      ...WRITES.map((w) => w.run),
      () => loadLive(GAME),
      () => liveMeta(GAME),
      () => roomByCode('ABCD'),
      () => roomById('r-1'),
      () => gameById(GAME),
      () => dueGames(0),
      () => stagesBySeat(seats),
      () => recordHand(seats, wonHand),
    ];
    for (const run of everything) {
      answerAll(undefined, (q) => (q.target === 'games' ? newGame : q.target === 'rooms' ? [{ id: 'r-1' }] : q.target === 'rpc:commit_table' ? 4 : null));
      await thrown(run());
    }
    expect(supabase.log.length).toBeGreaterThan(everything.length);
    expect(ran().filter((q) => q === 'live_state:update' || q === 'live_state:upsert' || q.startsWith('hand_results:') || q.startsWith('hands:update'))).toEqual([]);
    // The running totals live in table_state now: rooms.ledger is only ever read, to seed a table dealt before it.
    const roomWrites = supabase.log.filter((q) => q.target === 'rooms').flatMap((q) => q.steps.filter(([m]) => m === 'insert' || m === 'update' || m === 'upsert'));
    expect(roomWrites.length).toBeGreaterThan(1);
    expect(roomWrites.filter(([, [row]]) => typeof row === 'object' && row !== null && 'ledger' in row)).toEqual([]);
  });
});

describe('after a hand ends', () => {
  it('counts the hand on the game', async () => {
    await countHand(GAME);
    expect(supabase.log[0]).toEqual({ target: 'rpc:bump_hands_played', steps: [['rpc', [{ p_game_id: GAME }]]] });
  });

  it('tallies both humans, the winner with a win', async () => {
    answerAll(undefined, (q) =>
      q.target === 'profiles' && q.steps[0]?.[0] === 'select'
        ? [
            { id: 'u-abrar', stats: { hands: 4, wins: 1 } },
            { id: 'u-hana', stats: null },
          ]
        : null,
    );
    await recordHand(seats, wonHand);
    expect(ran()).toEqual(['profiles:select', 'profiles:update', 'profiles:update']);
    const tallies = supabase.log.filter(is('profiles', 'update')).map((q) => q.steps[0]![1][0]);
    expect(tallies).toContainEqual({ stats: { hands: 5, wins: 1 }, onboarding_stage: expect.any(String) });
    expect(tallies).toContainEqual({ stats: { hands: 1, wins: 1 }, onboarding_stage: expect.any(String) });
  });

  it('only logs when the tallies cannot be read or written: they pace the clocks, and the hand is settled either way', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    answerAll(is('profiles', 'select'));
    await expect(recordHand(seats, wonHand)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith('recordHand: could not read profiles', DOWN.message);

    log.mockClear();
    answerAll(is('profiles', 'update'), (q) => (q.target === 'profiles' ? [{ id: 'u-abrar', stats: {} }] : null));
    await expect(recordHand(seats, wonHand)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith('recordHand: could not write profile', 'u-abrar', DOWN.message);
  });

  it('leaves out a seat a bot was playing for when the hand ended: its win isn’t its person’s', async () => {
    answerAll(undefined, (q) => (q.target === 'profiles' && q.steps[0]?.[0] === 'select' ? [{ id: 'u-abrar', stats: { hands: 4, wins: 1 } }] : null));
    const away = seats.map((s) => s?.kind === 'human' && s.userId === 'u-hana');
    await recordHand(seats, wonHand, away);
    const asked = supabase.log.filter(is('profiles', 'select')).flatMap((q) => q.steps.filter(([m]) => m === 'in').map(([, args]) => args[1]));
    expect(asked).toEqual([['u-abrar']]);
    expect(ran()).toEqual(['profiles:select', 'profiles:update']);
    // Everyone away: nothing to tally, nothing asked.
    supabase.log.length = 0;
    await recordHand(seats, wonHand, [true, true, true, true]);
    expect(supabase.log).toHaveLength(0);
  });

  it('asks nothing of the database when no human sat the hand', async () => {
    const bots: Seats = [
      { kind: 'bot', name: 'Bilal' },
      { kind: 'bot', name: 'Sana' },
      { kind: 'bot', name: 'Ayesha' },
      { kind: 'bot', name: 'Hamza' },
    ];
    await recordHand(bots, wonHand);
    expect(supabase.log).toHaveLength(0);
  });
});

describe('createRoom', () => {
  it('seats the host with when they sat down, so the host’s powers pass to whoever has sat longest after them', async () => {
    answerAll(undefined, () => room);
    const before = Date.now();
    await createRoom({ code: 'ABCD', hostId: 'u-abrar', hostName: 'Abrar', rulesetId: 'karachi', options: {} });
    const insert = supabase.log[0]!.steps.find(([m]) => m === 'insert')![1][0] as { seats: Seats };
    expect(insert.seats).toEqual([{ kind: 'human', userId: 'u-abrar', name: 'Abrar', since: expect.any(String) }, null, null, null]);
    const since = Date.parse((insert.seats[0] as { since: string }).since);
    expect(since).toBeGreaterThanOrEqual(before);
    expect(since).toBeLessThanOrEqual(Date.now());
  });
});
