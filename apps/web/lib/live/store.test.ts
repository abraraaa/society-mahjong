import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  abandonGame,
  commitTable,
  countHand,
  createRoom,
  expiredGames,
  finishGame,
  gameById,
  loadLive,
  recordHand,
  roomByCode,
  roomById,
  saveSeats,
  stagesBySeat,
  startGame,
  type RoomRow,
} from './store';
import { commitArgs, type TableWrite } from './hand-log';
import { humanLevels, policyFor } from './policy';
import type { Seats } from './types';

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
/** Hana's win, as one request writes it: the hand ends, its points are in the running totals, and a clock waits on nobody. */
const write: TableWrite = {
  state: wonHand,
  table: { v: 1, scores: [-8, 8, 0, 0], extra: {} },
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
    expect(await expiredGames(0)).toEqual([]);
    expect(ran()).toContain('games:select');
  });

  it('hand back what they found', async () => {
    answerAll(undefined, (q) => (q.target === 'rooms' ? room : [{ game_id: 'g-9' }]));
    expect(await roomByCode('abcd')).toEqual(room);
    expect(supabase.log[0]!.steps).toContainEqual(['eq', ['code', 'ABCD']]);
    expect(await expiredGames(0)).toEqual(['g-9']);
  });

  it('read the live table with its bookkeeping, clocks and stamps, parsing table_state', async () => {
    const row = {
      version: 7,
      state: wonHand,
      claim_deadline: null,
      turn_deadline: '2026-09-24T20:01:30.000Z',
      table_state: { v: 1, scores: [-8, 8, 0, 0], ready: { hand: 2 } },
      wake_at: '2026-09-24T20:01:30.000Z',
      acted_at: '2026-09-24T19:59:00.000Z',
      updated_at: '2026-09-24T20:00:00.000Z',
    };
    answerAll(undefined, () => row);
    expect(await loadLive(GAME)).toEqual({
      version: 7,
      state: wonHand,
      deadlines: { claim: null, turn: T + 90_000 },
      table: { v: 1, scores: [-8, 8, 0, 0], extra: { ready: { hand: 2 } } },
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
    const reads = [() => roomByCode('ABCD'), () => roomById('r-1'), () => gameById(GAME), () => loadLive('g-1'), () => expiredGames(0)];
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
  });

  it('skip the database when there is nobody to look up', async () => {
    const bots: Seats = [null, { kind: 'bot', name: 'Bilal' }, null, null];
    expect(await stagesBySeat(bots)).toEqual([null, null, null, null]);
    expect(supabase.log).toHaveLength(0);
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
  /** how the write ends when nothing fails: it resolves, unless it refuses with a 409 */
  readonly ends?: 'resolves' | 'refuses';
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
    run: () => startGame(room, 'seed', seats, wonHand, { claim: null, turn: null }),
    labels: ['create the game', 'deal the first hand', 'open the first hand', 'point the room at the game'],
    data: (q) => (q.target === 'games' ? newGame : q.target === 'rooms' ? [{ id: 'r-1' }] : null),
  },
  {
    name: 'startGame, when the seats moved before the deal',
    run: () => startGame(room, 'seed', seats, wonHand, { claim: null, turn: null }),
    labels: ['create the game', 'deal the first hand', 'open the first hand', 'point the room at the game', 'drop the unstarted game'],
    data: (q) => (q.target === 'games' ? newGame : q.target === 'rooms' ? [] : null),
    ends: 'refuses',
  },
  { name: 'finishGame', run: () => finishGame(GAME, 'r-1'), labels: ['close the room', 'finish the game'] },
  { name: 'abandonGame', run: () => abandonGame(GAME, 'r-1'), labels: ['close the room', 'abandon the game'] },
  { name: 'countHand', run: () => countHand(GAME), labels: ['count the hand'] },
];

describe('writes', () => {
  it.each(WRITES)('$name throws at whichever of its queries fails, naming it, and goes no further', async (w) => {
    answerAll(undefined, w.data);
    const clean = await thrown(w.run());
    if (w.ends === 'refuses') expect((clean as HttpError).status).toBe(409);
    else expect(clean).toBeNull();
    expect(supabase.log).toHaveLength(w.labels.length);

    for (const [i, label] of w.labels.entries()) {
      supabase.log.length = 0;
      failNth(i, w.data);
      const err = await thrown(w.run());
      expect(err).toBeInstanceOf(SupabaseError);
      expect((err as SupabaseError).what).toBe(label);
      expect(supabase.log).toHaveLength(i + 1);
    }
  });

  it('still tell a lost race from a failure: no row matched is null, not a throw', async () => {
    answerAll(undefined, () => []);
    expect(await saveSeats('r-1', seats, room.updated_at)).toBeNull();
    answerAll(undefined, () => null);
    expect(await commitTable(GAME, 3, write)).toBeNull();
  });

  it('drop the game and say so when the seats moved before the deal', async () => {
    answerAll(undefined, (q) => (q.target === 'games' ? newGame : q.target === 'rooms' ? [] : null));
    const err = await thrown(startGame(room, 'seed', seats, wonHand, { claim: null, turn: null }));
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(409);
    expect(ran()).toEqual(['games:insert', 'live_state:insert', 'hands:insert', 'rooms:update', 'games:delete']);
  });
});

describe('finishing or abandoning a game', () => {
  const ends = [
    { name: 'finishGame', run: () => finishGame(GAME, 'r-1'), status: 'finished' },
    { name: 'abandonGame', run: () => abandonGame(GAME, 'r-1'), status: 'abandoned' },
  ];

  it.each(ends)('$name closes the room first and marks the game last, leaving the table itself alone', async ({ run, status }) => {
    await run();
    expect(ran()).toEqual(['rooms:update', 'games:update']);
    const [closeRoom, game] = supabase.log;
    expect(closeRoom!.steps[0]).toEqual(['update', [{ status: 'finished', updated_at: expect.any(String) }]]);
    expect(game!.steps[0]![1][0]).toMatchObject({ status });
    expect(game!.steps).toContainEqual(['eq', ['id', GAME]]);
  });

  it.each(ends)('$name closes the room only while it still holds this game and is playing it, so a repeat, or a room dealt again, writes nothing', async ({ run }) => {
    await run();
    const closeRoom = supabase.log.find(is('rooms', 'update'))!;
    expect(closeRoom.steps).toContainEqual(['eq', ['id', 'r-1']]);
    expect(closeRoom.steps).toContainEqual(['eq', ['current_game_id', GAME]]);
    expect(closeRoom.steps).toContainEqual(['eq', ['status', 'playing']]);

    // A room that has moved on, or already closed, matches no row, which is not a failure: the old game is still finished.
    supabase.log.length = 0;
    answerAll(undefined, () => []);
    await run();
    expect(ran()).toEqual(['rooms:update', 'games:update']);
  });

  it.each(ends)('$name leaves the game active whichever write fails, so it can be run again from the start', async ({ run }) => {
    for (const i of [0, 1]) {
      supabase.log.length = 0;
      failNth(i);
      await expect(run()).rejects.toBeInstanceOf(SupabaseError);
      // The game's status is the last write: when anything before it fails it never runs, and when it fails it did not land.
      const game = supabase.log.findIndex(is('games', 'update'));
      expect(game === -1 || game === i).toBe(true);
    }
    // Run again once the database is back, every write goes through.
    supabase.log.length = 0;
    answerAll();
    await run();
    expect(ran()).toEqual(['rooms:update', 'games:update']);
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

  it('is the only way the store writes a live table: nothing updates live_state or writes hand_results', async () => {
    for (const gone of ['saveLive', 'appendAction', 'openHand', 'endHand', 'settleScores', 'recordResult', 'clearDeadlines']) expect(store, gone).not.toHaveProperty(gone);
    const everything: (() => Promise<unknown>)[] = [
      ...WRITES.map((w) => w.run),
      () => loadLive(GAME),
      () => roomByCode('ABCD'),
      () => roomById('r-1'),
      () => gameById(GAME),
      () => expiredGames(0),
      () => stagesBySeat(seats),
      () => recordHand(seats, wonHand),
    ];
    for (const run of everything) {
      answerAll(undefined, (q) => (q.target === 'games' ? newGame : q.target === 'rooms' ? [{ id: 'r-1' }] : q.target === 'rpc:commit_table' ? 4 : null));
      await thrown(run());
    }
    expect(supabase.log.length).toBeGreaterThan(everything.length);
    expect(ran().filter((q) => q === 'live_state:update' || q === 'live_state:upsert' || q.startsWith('hand_results:') || q.startsWith('hands:update'))).toEqual([]);
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
