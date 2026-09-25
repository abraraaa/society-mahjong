import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { GameRow, RoomRow } from '../../../../../lib/live/store';

/**
 * The host's "Play again". A room is startable unless its game is live: one
 * left "playing" by a game that has ended, and one whose finish closed the
 * room but not yet the game, can both be dealt again.
 */
const db = vi.hoisted(() => ({ room: null as unknown, game: null as unknown }));

vi.mock('server-only', () => ({}));
vi.mock('../../../../../lib/live/auth', () => ({ currentUser: vi.fn(async () => ({ id: 'u-abrar', name: 'Abrar', isGuest: true })) }));
vi.mock('../../../../../lib/live/broadcast', () => ({
  broadcast: vi.fn(async () => {}),
  gamePoke: vi.fn(() => ({})),
  roomPoke: vi.fn(() => ({})),
}));
vi.mock('../../../../../lib/live/store', () => ({
  roomByCode: vi.fn(async () => db.room),
  gameById: vi.fn(async () => db.game),
  stagesFor: vi.fn(async () => ['new']),
  startGame: vi.fn(async () => ({ id: NEXT, room_id: 'r-1', seed: 'seed', status: 'active', hands_played: 0 })),
}));

import { POST } from './route';
import * as store from '../../../../../lib/live/store';

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
});
