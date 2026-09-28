import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { RoomRow } from '../../../../lib/live/store';

/**
 * The lobby's poll, every five seconds. Between games it says who's here,
 * from the room's members, and it keeps the caller here: a seated caller with
 * no member row, or one last seen over half an hour ago, is checked in, so
 * someone with the lobby open for hours stays here at no more than two
 * writes an hour. When who's been seen can't be read, it tags nobody and
 * checks nobody in.
 */
const db = vi.hoisted(() => ({ room: null as unknown, members: [] as { userId: string; lastSeenAt: number }[], user: 'u-abrar' }));

vi.mock('server-only', () => ({}));
vi.mock('../../../../lib/live/auth', () => ({ currentUser: vi.fn(async () => ({ id: db.user, name: 'Someone', isGuest: true })) }));
vi.mock('../../../../lib/live/store', () => ({
  roomByCode: vi.fn(async () => db.room),
  gameById: vi.fn(async () => null),
  roomMembers: vi.fn(async () => db.members),
  lastGameOf: vi.fn(async () => null),
  lastFinishedGame: vi.fn(async () => null),
  touchMember: vi.fn(async () => true),
}));

import { GET } from './route';
import * as store from '../../../../lib/live/store';
import type { RoomSnapshot } from '../../../../lib/live/snapshot';

const MINUTE = 60_000;
const room: RoomRow = {
  id: 'r-1',
  code: 'ABCD',
  host_id: 'u-abrar',
  ruleset_id: 'karachi',
  options: {},
  status: 'lobby',
  seats: [{ kind: 'human', userId: 'u-abrar', name: 'Abrar' }, { kind: 'human', userId: 'u-bilal', name: 'Bilal' }, null, null],
  current_game_id: null,
  ledger: [0, 0, 0, 0],
  updated_at: new Date().toISOString(),
};

async function poll(): Promise<{ status: number; body: RoomSnapshot }> {
  const req = new Request('https://societymahjong.app/api/rooms/ABCD') as unknown as NextRequest;
  const res = await GET(req, { params: Promise.resolve({ code: 'ABCD' }) });
  return { status: res.status, body: (await res.json()) as RoomSnapshot };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.room = room;
  db.members = [];
  db.user = 'u-abrar';
});

describe('GET /api/rooms/[code], the lobby’s poll', () => {
  it('checks in a seated caller last seen over half an hour ago, and one with no member row at all', async () => {
    db.members = [{ userId: 'u-abrar', lastSeenAt: Date.now() - 31 * MINUTE }];
    const { status, body } = await poll();
    expect(status).toBe(200);
    expect(store.touchMember).toHaveBeenCalledWith('r-1', 'u-abrar', expect.any(Number));
    expect(body.seats[0]).toEqual({ kind: 'human', name: 'Abrar' });

    vi.mocked(store.touchMember).mockClear();
    db.user = 'u-bilal';
    const second = await poll();
    expect(store.touchMember).toHaveBeenCalledWith('r-1', 'u-bilal', expect.any(Number));
    // Checked in by this very poll: here, in this answer.
    expect(second.body.seats[1]).toEqual({ kind: 'human', name: 'Bilal' });
  });

  it('leaves alone a caller seen within the half hour, and a host who isn’t seated', async () => {
    db.members = [{ userId: 'u-abrar', lastSeenAt: Date.now() - 29 * MINUTE }];
    expect((await poll()).status).toBe(200);
    db.room = { ...room, seats: [null, room.seats[1], null, null] };
    const { status, body } = await poll();
    expect(status).toBe(200);
    expect(body.me).toBeNull();
    expect(store.touchMember).not.toHaveBeenCalled();
  });

  it('checks in a caller seen within the half hour who still reads not here: seen before the last game ended, their check-in since lost', async () => {
    const endedAt = Date.now() - 5 * MINUTE;
    db.room = { ...room, status: 'finished', current_game_id: '6f1c2a9e-4b7d-4e3a-9c5f-2d8b0a7e1f34' };
    vi.mocked(store.lastGameOf).mockResolvedValue({ status: 'finished', endedAt, how: 'complete', hands: 4, players: [] });
    db.members = [{ userId: 'u-abrar', lastSeenAt: endedAt - 10 * MINUTE }];
    const { body } = await poll();
    expect(store.touchMember).toHaveBeenCalledWith('r-1', 'u-abrar', expect.any(Number));
    expect(body.seats[0]).toEqual({ kind: 'human', name: 'Abrar' });
    vi.mocked(store.lastGameOf).mockResolvedValue(null);
  });

  it('says a caller whose check-in didn’t land isn’t here yet, and tries again on the next poll', async () => {
    db.user = 'u-bilal';
    vi.mocked(store.touchMember).mockResolvedValueOnce(false);
    expect((await poll()).body.seats[1]).toEqual({ kind: 'human', name: 'Bilal', notHere: true });
    expect((await poll()).body.seats[1]).toEqual({ kind: 'human', name: 'Bilal' });
    expect(store.touchMember).toHaveBeenCalledTimes(2);
  });

  it('tags nobody and checks nobody in when who’s been seen can’t be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(store.roomMembers).mockRejectedValueOnce(new Error('fetch failed'));
    const { status, body } = await poll();
    expect(status).toBe(200);
    expect(body.seats.some((s) => s?.notHere)).toBe(false);
    expect(store.touchMember).not.toHaveBeenCalled();
  });

  it('reads nobody for a room in play: the lobby sends everyone to the table', async () => {
    db.room = { ...room, status: 'playing', current_game_id: '6f1c2a9e-4b7d-4e3a-9c5f-2d8b0a7e1f34' };
    vi.mocked(store.gameById).mockResolvedValueOnce({ id: 'g', room_id: 'r-1', seed: 's', status: 'active', hands_played: 0 });
    const { status, body } = await poll();
    expect(status).toBe(200);
    expect(body.status).toBe('playing');
    expect(store.roomMembers).not.toHaveBeenCalled();
    expect(store.touchMember).not.toHaveBeenCalled();
  });

  it('still turns away someone neither seated nor the host', async () => {
    db.user = 'u-zed';
    expect((await poll()).status).toBe(403);
    expect(store.touchMember).not.toHaveBeenCalled();
  });
});
