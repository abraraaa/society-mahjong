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
import {
  abandonGame,
  appendAction,
  closeHand,
  createRoom,
  expiredGames,
  finishGame,
  gameById,
  loadLive,
  openHand,
  roomByCode,
  roomById,
  saveLive,
  saveSeats,
  stagesFor,
  startGame,
  type RoomRow,
} from './store';
import type { Seats } from './types';

const DOWN = { message: 'TypeError: fetch failed', code: '' };
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
  current_game_id: 'g-1',
  ledger: [0, 0, 0, 0],
  updated_at: '2026-09-24T00:00:00Z',
};
/** Just what closeHand and openHand read of a hand: Hana (seat 1) wins 8 from Abrar. */
const wonHand = {
  dealer: 0,
  progress: { handIndex: 2 },
  result: { type: 'win', winner: 1, patternId: 'all-pungs', settlement: { transfers: [{ from: 0, to: 1, amount: 8 }] } },
} as unknown as HandState;

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
    expect(await gameById('g-1')).toBeNull();
    expect(await loadLive('g-1')).toBeNull();
    expect(await expiredGames(0)).toEqual([]);
    expect(await stagesFor(seats)).toEqual([]);
  });

  it('hand back what they found', async () => {
    answerAll(undefined, (q) => (q.target === 'rooms' ? room : [{ game_id: 'g-9' }]));
    expect(await roomByCode('abcd')).toEqual(room);
    expect(supabase.log[0]!.steps).toContainEqual(['eq', ['code', 'ABCD']]);
    expect(await expiredGames(0)).toEqual(['g-9']);
  });

  it('throw when the database fails, instead of passing for "no such room" or an empty table', async () => {
    answerAll(() => true);
    const reads = [() => roomByCode('ABCD'), () => roomById('r-1'), () => gameById('g-1'), () => loadLive('g-1'), () => expiredGames(0), () => stagesFor(seats)];
    for (const read of reads) await expect(read()).rejects.toBeInstanceOf(SupabaseError);
  });

  it('skip the database when there is nobody to look up', async () => {
    const bots: Seats = [null, { kind: 'bot', name: 'Bilal' }, null, null];
    expect(await stagesFor(bots)).toEqual([]);
    expect(supabase.log).toHaveLength(0);
  });
});

describe('writes', () => {
  it('throw when the database fails', async () => {
    answerAll(() => true);
    const writes: (() => Promise<unknown>)[] = [
      () => createRoom({ code: 'ABCD', hostId: 'u-abrar', hostName: 'Abrar', rulesetId: 'karachi', options: {} }),
      () => saveSeats('r-1', seats, room.updated_at),
      () => saveLive('g-1', 3, wonHand, { claim: null, turn: null }),
      () => appendAction('g-1', 2, { type: 'pass', seat: 0 }),
      () => openHand('g-1', wonHand),
      () => finishGame('g-1', 'r-1'),
      () => abandonGame('g-1', 'r-1'),
      () => startGame(room, 'seed', seats, wonHand, { claim: null, turn: null }),
      () => closeHand('g-1', room, wonHand),
    ];
    for (const write of writes) await expect(write()).rejects.toBeInstanceOf(SupabaseError);
  });

  it('still tell a lost race from a failure: no row matched is false or null, not a throw', async () => {
    answerAll(undefined, () => []);
    expect(await saveSeats('r-1', seats, room.updated_at)).toBeNull();
    expect(await saveLive('g-1', 3, wonHand, { claim: null, turn: null })).toBe(false);
  });

  it('stop at the first failure when finishing a game', async () => {
    answerAll(is('rooms'));
    await expect(finishGame('g-1', 'r-1')).rejects.toThrow('could not close the room');
    expect(ran()).toEqual(['games:update', 'rooms:update']);
  });

  it('drop the game and say so when the seats moved before the deal', async () => {
    answerAll(undefined, (q) => (q.target === 'games' ? { id: 'g-2', room_id: 'r-1', seed: 'seed', status: 'active', hands_played: 0 } : q.target === 'rooms' ? [] : null));
    const err = await startGame(room, 'seed', seats, wonHand, { claim: null, turn: null }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(409);
    expect(ran()).toEqual(['games:insert', 'live_state:insert', 'hands:insert', 'rooms:update', 'games:delete']);
  });

  it('report a failed clean-up after the seats moved, rather than a 409 over a game left behind', async () => {
    answerAll(is('games', 'delete'), (q) => (q.target === 'games' ? { id: 'g-2' } : q.target === 'rooms' ? [] : null));
    await expect(startGame(room, 'seed', seats, wonHand, { claim: null, turn: null })).rejects.toThrow('could not drop the unstarted game');
  });
});

describe('closing a hand', () => {
  it('settles the scores, closes the hand, records the result and tallies both humans', async () => {
    answerAll(undefined, (q) =>
      q.target === 'profiles' && q.steps[0]?.[0] === 'select'
        ? [
            { id: 'u-abrar', stats: { hands: 4, wins: 1 } },
            { id: 'u-hana', stats: null },
          ]
        : null,
    );
    expect(await closeHand('g-1', room, wonHand)).toEqual([-8, 8, 0, 0]);
    expect(ran()).toEqual(['rooms:update', 'hands:update', 'hand_results:insert', 'rpc:bump_hands_played:rpc', 'profiles:select', 'profiles:update', 'profiles:update']);
    const tallies = supabase.log.filter(is('profiles', 'update')).map((q) => q.steps[0]![1][0]);
    expect(tallies).toContainEqual({ stats: { hands: 5, wins: 1 }, onboarding_stage: expect.any(String) });
    expect(tallies).toContainEqual({ stats: { hands: 1, wins: 1 }, onboarding_stage: expect.any(String) });
  });

  it('throws when the scores cannot be settled, and writes nothing after', async () => {
    answerAll(is('rooms'));
    await expect(closeHand('g-1', room, wonHand)).rejects.toThrow('could not settle the scores');
    expect(ran()).toEqual(['rooms:update']);
  });

  it('records a washout with no winner and leaves the scores alone', async () => {
    const washout = { ...wonHand, result: { type: 'draw' } } as unknown as HandState;
    expect(await closeHand('g-1', room, washout)).toEqual([0, 0, 0, 0]);
    expect(ran()).not.toContain('rooms:update');
    const result = supabase.log.find(is('hand_results'))!;
    expect(result.steps[0]).toEqual(['insert', [{ game_id: 'g-1', hand_index: 2, winner: null, pattern_id: null, settlement: {} }]]);

    supabase.log.length = 0;
    answerAll(is('hand_results'));
    await expect(closeHand('g-1', room, washout)).rejects.toThrow('could not record the result');
  });

  it('throws when the result cannot be recorded', async () => {
    answerAll(is('hand_results'));
    await expect(closeHand('g-1', room, wonHand)).rejects.toThrow('could not record the result');
    expect(ran()).not.toContain('rpc:bump_hands_played:rpc');
  });

  it('only logs when the tallies cannot be read or written: the hand is settled either way', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    answerAll(is('profiles', 'select'));
    expect(await closeHand('g-1', room, wonHand)).toEqual([-8, 8, 0, 0]);
    expect(log).toHaveBeenCalledWith('recordHand: could not read profiles', DOWN.message);

    log.mockClear();
    answerAll(is('profiles', 'update'), (q) => (q.target === 'profiles' ? [{ id: 'u-abrar', stats: {} }] : null));
    expect(await closeHand('g-1', room, wonHand)).toEqual([-8, 8, 0, 0]);
    expect(log).toHaveBeenCalledWith('recordHand: could not write profile', 'u-abrar', DOWN.message);
  });
});
