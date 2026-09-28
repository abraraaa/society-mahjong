import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { GameRow, LiveMeta, RoomRow } from '../../../../../lib/live/store';
import type { GameOver } from '../../../../../lib/live/table-state';

/**
 * The host's "Play again". A room is startable unless its game is live: one
 * left "playing" by a game that has ended, one whose finish closed the room
 * but not yet the game, and one whose game's end is saved but whose finish
 * never ran (it's finished first), can all be dealt again.
 */
const db = vi.hoisted(() => ({ room: null as unknown, game: null as unknown, meta: null as unknown, after: null as unknown }));

vi.mock('server-only', () => ({}));
vi.mock('../../../../../lib/live/auth', () => ({ currentUser: vi.fn(async () => ({ id: 'u-abrar', name: 'Abrar', isGuest: true })) }));
vi.mock('../../../../../lib/live/broadcast', () => ({
  broadcast: vi.fn(async () => {}),
  gamePoke: vi.fn(() => ({})),
  roomPoke: vi.fn(() => ({})),
}));
vi.mock('../../../../../lib/live/table', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../lib/live/table')>();
  return { ...actual, dealFirstHand: vi.fn(actual.dealFirstHand) };
});
vi.mock('../../../../../lib/live/store', () => ({
  roomByCode: vi.fn(async () => db.room),
  roomById: vi.fn(async () => db.after ?? db.room),
  gameById: vi.fn(async () => db.game),
  liveMeta: vi.fn(async () => db.meta),
  finishGame: vi.fn(async () => {}),
  stagesBySeat: vi.fn(async (seats: readonly ({ kind: string } | null)[]) => seats.map((s) => (s?.kind === 'human' ? 'new' : null))),
  startGame: vi.fn(async () => ({ id: NEXT, room_id: 'r-1', seed: 'seed', status: 'active', hands_played: 0 })),
}));

import { POST } from './route';
import * as store from '../../../../../lib/live/store';
import * as table from '../../../../../lib/live/table';

const GAME = '6f1c2a9e-4b7d-4e3a-9c5f-2d8b0a7e1f34';
const NEXT = '0d3e5f7a-9b1c-4d2e-8f6a-1b3c5d7e9f02';
const room: RoomRow = {
  id: 'r-1',
  code: 'ABCD',
  host_id: 'u-abrar',
  ruleset_id: 'karachi',
  options: {},
  status: 'playing',
  seats: [{ kind: 'human', userId: 'u-abrar', name: 'Abrar' }, null, null, null],
  current_game_id: GAME,
  ledger: [0, 0, 0, 0],
  updated_at: '2026-09-24T00:00:00Z',
};
const game = (status: GameRow['status']): GameRow => ({ id: GAME, room_id: 'r-1', seed: 'seed', status, hands_played: 16 });

function start(): Promise<Response> {
  const req = new Request('https://societymahjong.app/api/rooms/ABCD/start', { method: 'POST' }) as unknown as NextRequest;
  return POST(req, { params: Promise.resolve({ code: 'ABCD' }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.meta = null;
  db.after = null;
});

describe('POST /api/rooms/[code]/start', () => {
  it("refuses while the room's game is live", async () => {
    db.room = room;
    db.game = game('active');
    const res = await start();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'a game is in progress' });
    expect(store.startGame).not.toHaveBeenCalled();
  });

  it.each(['finished', 'abandoned'] as const)('deals again in a room left playing by a game that is %s', async (status) => {
    db.room = room;
    db.game = game(status);
    const res = await start();
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ gameId: NEXT });
    expect(store.startGame).toHaveBeenCalledTimes(1);
  });

  it('deals again in a room whose finish closed it but has not yet marked the game', async () => {
    db.room = { ...room, status: 'finished' };
    db.game = game('active');
    const res = await start();
    expect(res.status).toBe(201);
    expect(store.startGame).toHaveBeenCalledTimes(1);
  });

  it('finishes a game whose end is saved but not recorded, then deals again', async () => {
    const over: GameOver = { how: 'complete', by: null, at: 1, hands: 16, scores: [0, 0, 0, 0], seats: room.seats };
    db.room = room;
    db.game = game('active');
    db.meta = { version: 40, table: { v: 1, scores: [0, 0, 0, 0], over, extra: {} }, legacy: false, actedAt: 0, updatedAt: 0, hand: 15, seq: 99 } satisfies LiveMeta;
    // The finish closes the room, which moves its updated_at: the deal is guarded by the room as the finish left it.
    db.after = { ...room, status: 'finished', updated_at: '2026-09-24T00:05:00Z' };
    const res = await start();
    expect(res.status).toBe(201);
    expect(store.finishGame).toHaveBeenCalledWith(GAME, room, over);
    const order = [store.finishGame, store.startGame].map((fn) => vi.mocked(fn).mock.invocationCallOrder[0]!);
    expect(order[0]).toBeLessThan(order[1]!);
    expect(vi.mocked(store.startGame).mock.calls[0]![0]).toMatchObject({ status: 'finished', updated_at: '2026-09-24T00:05:00Z' });
  });

  it('deals with gentle bots in the empty seats while the host is new', async () => {
    db.room = { ...room, status: 'finished' };
    db.game = game('finished');
    await start();
    expect(vi.mocked(table.dealFirstHand).mock.calls.at(-1)![5]).toEqual({ bots: 'gentle' });
  });

  it("hands the store the deal with the bots' opening moves, each stamped with the live table's first version", async () => {
    // The host in seat 2, so the bots in seats 0 and 1 move before anyone has to decide anything.
    db.room = { ...room, status: 'finished', seats: [null, null, { kind: 'human', userId: 'u-abrar', name: 'Abrar' }, null] };
    db.game = game('finished');
    expect((await start()).status).toBe(201);
    const dealt = vi.mocked(table.dealFirstHand).mock.results.at(-1)!.value as ReturnType<typeof table.dealFirstHand>;
    expect(dealt.moves.length).toBeGreaterThan(0);
    const [, seed, seats, first] = vi.mocked(store.startGame).mock.calls.at(-1)!;
    expect(seed).toBe(dealt.state.seed);
    expect(seats.map((s) => s?.kind)).toEqual(['bot', 'bot', 'human', 'bot']);
    expect(first.state).toBe(dealt.state);
    expect(first.deadlines).toBe(dealt.deadlines);
    expect(first.moves).toEqual(dealt.moves.map((m) => ({ ...m, v: 1 })));
    expect(first.moves.every((m) => m.v === 1 && (m.by === 'bot' || m.by === 'table'))).toBe(true);
  });
});
