import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { GameRow, LiveMeta, RoomRow } from '../../../../../lib/live/store';
import type { GameOver } from '../../../../../lib/live/table-state';

/**
 * A room code is enough to sit down. A room whose game has ended, but whose
 * end isn't all recorded yet, is finished first, so the friend arriving after
 * the last hand finds it between games rather than "already started".
 */
const db = vi.hoisted(() => ({ room: null as unknown, game: null as unknown, meta: null as unknown, after: null as unknown }));

vi.mock('server-only', () => ({}));
vi.mock('../../../../../lib/live/auth', () => ({ currentUser: vi.fn(async () => ({ id: 'u-zara', name: 'Zara', isGuest: true })) }));
vi.mock('../../../../../lib/live/broadcast', () => ({
  broadcast: vi.fn(async () => {}),
  gamePoke: vi.fn(() => ({})),
  roomPoke: vi.fn(() => ({})),
}));
vi.mock('../../../../../lib/live/store', () => ({
  roomByCode: vi.fn(async () => db.room),
  roomById: vi.fn(async () => db.after ?? db.room),
  gameById: vi.fn(async () => db.game),
  liveMeta: vi.fn(async () => db.meta),
  finishGame: vi.fn(async () => {}),
  saveSeats: vi.fn(async () => '2026-09-24T00:06:00Z'),
}));

import { POST } from './route';
import * as store from '../../../../../lib/live/store';

const GAME = '6f1c2a9e-4b7d-4e3a-9c5f-2d8b0a7e1f34';
/** A room written to a moment ago: a finished room turns newcomers away only once it has been quiet for a while. */
const RECENT = new Date(Date.now() - 60_000).toISOString();
const CLOSED_AT = new Date(Date.now() - 30_000).toISOString();
const room: RoomRow = {
  id: 'r-1',
  code: 'ABCD',
  host_id: 'u-abrar',
  ruleset_id: 'karachi',
  options: {},
  status: 'playing',
  seats: [
    { kind: 'human', userId: 'u-abrar', name: 'Abrar' },
    { kind: 'bot', name: 'Bilal' },
    { kind: 'bot', name: 'Sana' },
    { kind: 'bot', name: 'Omar' },
  ],
  current_game_id: GAME,
  ledger: [0, 0, 0, 0],
  updated_at: RECENT,
};
const active: GameRow = { id: GAME, room_id: 'r-1', seed: 'seed', status: 'active', hands_played: 15 };
const over: GameOver = { how: 'complete', by: null, at: 1, hands: 16, scores: [9, -3, -3, -3], seats: room.seats };
const meta = (o: GameOver | null): LiveMeta => ({
  version: 40,
  table: { v: 1, scores: [9, -3, -3, -3], over: o, extra: {} },
  legacy: false,
  actedAt: 0,
  updatedAt: 0,
  hand: 15,
  seq: 99,
});

function join(): Promise<Response> {
  const req = new Request('https://societymahjong.app/api/rooms/ABCD/join', { method: 'POST', body: JSON.stringify({ name: 'Zara' }) }) as unknown as NextRequest;
  return POST(req, { params: Promise.resolve({ code: 'ABCD' }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.room = room;
  db.game = active;
  db.meta = null;
  db.after = null;
});

describe('POST /api/rooms/[code]/join', () => {
  it('finishes a game whose end is saved but not recorded, then seats the newcomer in the room it left', async () => {
    db.meta = meta(over);
    db.after = { ...room, status: 'finished', updated_at: CLOSED_AT };
    const res = await join();
    expect(res.status).toBe(200);
    expect(store.finishGame).toHaveBeenCalledWith(GAME, room, over);
    const order = [store.finishGame, store.saveSeats].map((fn) => vi.mocked(fn).mock.invocationCallOrder[0]!);
    expect(order[0]).toBeLessThan(order[1]!);
    // Seated in the room as the finish left it: a bot's seat, between games.
    expect(vi.mocked(store.saveSeats).mock.calls[0]![2]).toBe(CLOSED_AT);
    expect(await res.json()).toMatchObject({ status: 'finished', me: 1 });
  });

  it('still turns a newcomer away from a game in play, without touching it', async () => {
    db.meta = meta(null);
    const res = await join();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'this table has already started' });
    expect(store.finishGame).not.toHaveBeenCalled();
    expect(store.saveSeats).not.toHaveBeenCalled();
  });

  it('asks nothing of the live table for a room between games', async () => {
    db.room = { ...room, status: 'finished' };
    const res = await join();
    expect(res.status).toBe(200);
    expect(store.liveMeta).not.toHaveBeenCalled();
  });
});
