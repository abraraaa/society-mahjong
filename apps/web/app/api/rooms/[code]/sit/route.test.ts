import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { RoomRow } from '../../../../../lib/live/store';
import type { SatDown } from '../../../../../lib/live/rooms';

/**
 * The take-over screen's answer: the route signs the caller in, checks the
 * seat, settles the room's game first, and hands the rest to rooms.ts
 * sitDown. Once a seat is taken, the table notes when (noteTakeOver), and
 * both the lobby and the table hear; a join is counted as the invite link
 * counts one.
 */
const auth = vi.hoisted(() => ({ user: { id: 'u-zara', name: 'Zara', isGuest: true } as { id: string; name: string; isGuest: boolean } | null }));
const db = vi.hoisted(() => ({ sat: null as unknown }));

vi.mock('server-only', () => ({}));
vi.mock('../../../../../lib/live/auth', () => ({ currentUser: vi.fn(async () => auth.user) }));
vi.mock('../../../../../lib/live/broadcast', () => ({
  broadcast: vi.fn(async () => {}),
  roomPoke: vi.fn((roomId: string, event: string) => ({ topic: `room:${roomId}`, event })),
  seatsPoke: vi.fn((gameId: string) => ({ topic: `game:${gameId}`, event: 'state' })),
}));
vi.mock('../../../../../lib/live/events', () => ({ recordEvent: vi.fn(async () => {}) }));
vi.mock('../../../../../lib/live/rooms', () => ({
  requireRoom: vi.fn(async () => db.sat && (db.sat as SatDown).room),
  sitDown: vi.fn(async () => db.sat),
  roomSnapshot: vi.fn((room: RoomRow, userId: string) => ({ code: room.code, status: room.status, me: room.seats.findIndex((s) => s?.kind === 'human' && s.userId === userId) })),
}));
vi.mock('../../../../../lib/live/service', async () => {
  const { HttpError } = await import('../../../../../lib/live/errors');
  return { HttpError, settleRoomGame: vi.fn(async (room: RoomRow) => ({ ...room, updated_at: 'settled' })), noteTakeOver: vi.fn(async () => {}) };
});

import { POST } from './route';
import { HttpError } from '../../../../../lib/live/errors';
import * as broadcaster from '../../../../../lib/live/broadcast';
import * as events from '../../../../../lib/live/events';
import * as rooms from '../../../../../lib/live/rooms';
import * as service from '../../../../../lib/live/service';

const GAME = '6f1c2a9e-4b7d-4e3a-9c5f-2d8b0a7e1f34';
const room: RoomRow = {
  id: 'r-1',
  code: 'KHI-4287Q',
  host_id: 'u-abrar',
  ruleset_id: 'karachi',
  options: {},
  status: 'playing',
  seats: [
    { kind: 'human', userId: 'u-abrar', name: 'Abrar' },
    { kind: 'human', userId: 'u-zara', name: 'Zara' },
    { kind: 'bot', name: 'Sana' },
    { kind: 'bot', name: 'Omar' },
  ],
  current_game_id: GAME,
  ledger: [0, 0, 0, 0],
  updated_at: '2026-09-28T19:00:00Z',
};
const took: SatDown = { room, took: true, how: 'take_over', joined: false, displaced: false, circle: null };

function sit(body?: unknown): Promise<Response> {
  const req = new Request('https://societymahjong.app/api/rooms/KHI-4287Q/sit', {
    method: 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }) as unknown as NextRequest;
  return POST(req, { params: Promise.resolve({ code: 'KHI-4287Q' }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = { id: 'u-zara', name: 'Zara', isGuest: true };
  db.sat = took;
});

describe('POST /api/rooms/[code]/sit', () => {
  it('asks someone with no session to sign in, and takes nothing', async () => {
    auth.user = null;
    const res = await sit({ seat: 1, name: 'Zara' });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'sign in first' });
    expect(rooms.sitDown).not.toHaveBeenCalled();
  });

  it('refuses anything that isn’t a seat, before reading the room', async () => {
    for (const seat of [4, -1, 1.5, '1', null, undefined]) {
      const res = await sit({ seat, name: 'Zara' });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'that is not a seat to sit in' });
    }
    expect(rooms.requireRoom).not.toHaveBeenCalled();
    expect(rooms.sitDown).not.toHaveBeenCalled();
  });

  it('settles the room’s game first, then sits the caller down by the name they gave, or their own', async () => {
    const res = await sit({ seat: 1, name: '  Zee  ' });
    expect(res.status).toBe(200);
    expect(rooms.requireRoom).toHaveBeenCalledWith('KHI-4287Q');
    expect(service.settleRoomGame).toHaveBeenCalledWith(room, expect.any(Number));
    expect(rooms.sitDown).toHaveBeenCalledWith({ ...room, updated_at: 'settled' }, 'u-zara', 'Zee', 1, expect.any(Number));
    const order = [service.settleRoomGame, rooms.sitDown].map((fn) => vi.mocked(fn).mock.invocationCallOrder[0]!);
    expect(order[0]).toBeLessThan(order[1]!);
    await sit({ seat: 2 });
    expect(vi.mocked(rooms.sitDown).mock.calls[1]![2]).toBe('Zara');
  });

  it('once a seat is taken, has the table note it, then tells the lobby and the table, and answers with the room', async () => {
    const res = await sit({ seat: 1, name: 'Zara' });
    expect(await res.json()).toEqual({ code: 'KHI-4287Q', status: 'playing', me: 1 });
    expect(service.noteTakeOver).toHaveBeenCalledWith(GAME, 'u-zara', expect.any(Number));
    expect(broadcaster.broadcast).toHaveBeenCalledWith([
      { topic: 'room:r-1', event: 'seats' },
      { topic: `game:${GAME}`, event: 'state' },
    ]);
    const order = [service.noteTakeOver, broadcaster.broadcast].map((fn) => vi.mocked(fn).mock.invocationCallOrder[0]!);
    expect(order[0]).toBeLessThan(order[1]!);
    // sitDown counted the take-over itself.
    expect(events.recordEvent).not.toHaveBeenCalled();
  });

  it('pokes only the lobby for a join, and counts it as the link does; nothing at all for someone already seated', async () => {
    const between: RoomRow = { ...room, status: 'finished' };
    db.sat = { ...took, room: between, took: false, how: null, joined: true, displaced: true } satisfies SatDown;
    await sit({ seat: 1, name: 'Zara' });
    expect(service.noteTakeOver).not.toHaveBeenCalled();
    expect(broadcaster.broadcast).toHaveBeenCalledWith([{ topic: 'room:r-1', event: 'seats' }]);
    expect(events.recordEvent).toHaveBeenCalledWith({ type: 'seat_taken', roomId: 'r-1', userId: 'u-zara', data: { how: 'displaced', status: 'finished' } });

    vi.clearAllMocks();
    db.sat = { ...took, took: false, how: null } satisfies SatDown;
    expect((await sit({ seat: 1, name: 'Zara' })).status).toBe(200);
    expect(service.noteTakeOver).not.toHaveBeenCalled();
    expect(broadcaster.broadcast).not.toHaveBeenCalled();
    expect(events.recordEvent).not.toHaveBeenCalled();
  });

  it('passes a refusal on, and pokes nobody', async () => {
    vi.mocked(rooms.sitDown).mockRejectedValueOnce(new HttpError(409, 'that seat is kept for someone'));
    const res = await sit({ seat: 3, name: 'Zara' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'that seat is kept for someone' });
    expect(broadcaster.broadcast).not.toHaveBeenCalled();
    expect(service.noteTakeOver).not.toHaveBeenCalled();
  });
});
