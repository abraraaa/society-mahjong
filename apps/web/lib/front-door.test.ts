import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './live/client';
import type { Seats } from './live/types';
import { ROOM_OPEN_MS, frontDoor, isClosedRoom, retryCanHelp, type DoorLookup, type DoorRoom } from './front-door';

const NOW = Date.parse('2026-09-24T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const SEATS: Seats = [{ kind: 'human', userId: 'host', name: 'Abrar' }, { kind: 'human', userId: 'sana', name: 'Sana' }, { kind: 'bot', name: 'Bilal' }, null];

const ROOM_ID = 'r-1';

function room(status: DoorRoom['status'], ageMs: number): DoorRoom {
  return { id: ROOM_ID, status, updated_at: new Date(NOW - ageMs).toISOString(), seats: SEATS };
}

type Member = { readonly userId: string; readonly lastSeenAt: number };

function lookup(found: DoorRoom | null | Error, userId: string | null | Error = null, configured = true, members: readonly Member[] | Error = []) {
  const look = {
    configured,
    room: vi.fn(async () => {
      if (found instanceof Error) throw found;
      return found;
    }),
    members: vi.fn(async (_roomId: string) => {
      if (members instanceof Error) throw members;
      return members;
    }),
    userId: vi.fn(async () => {
      if (userId instanceof Error) throw userId;
      return userId;
    }),
  } satisfies DoorLookup;
  return look;
}

describe('frontDoor', () => {
  it('turns away a code this app could never have issued, without a lookup', async () => {
    for (const code of ['FREE-MONEY', 'KHI-0000', 'KHI-ABCDEF', 'KHI-ABC', '', 'khi-4287q']) {
      const look = lookup(room('lobby', 0));
      expect(await frontDoor(code, look, NOW), code).toBe('no-table');
      expect(look.room).not.toHaveBeenCalled();
    }
  });

  it('opens the lobby as before when the server has no database settings', async () => {
    const look = lookup(null, null, false);
    expect(await frontDoor('KHI-4287Q', look, NOW)).toBe('lobby');
    expect(look.room).not.toHaveBeenCalled();
  });

  it('says there is no table when the code has no room', async () => {
    const look = lookup(null);
    expect(await frontDoor('KHI-4287Q', look, NOW)).toBe('no-table');
    expect(look.room).toHaveBeenCalledWith('KHI-4287Q');
  });

  it('accepts the older four-symbol codes', async () => {
    expect(await frontDoor('KHI-4287', lookup(room('lobby', 0)), NOW)).toBe('lobby');
  });

  it('opens the lobby when the lookup throws, and the join has the final say', async () => {
    expect(await frontDoor('KHI-4287Q', lookup(new Error('connection refused')), NOW)).toBe('lobby');
    expect(await frontDoor('KHI-4287Q', lookup(room('finished', 50 * DAY), 'stranger', true, new Error('connection refused')), NOW)).toBe('lobby');
  });

  it('opens the lobby for a room playing, or written to within six weeks, without asking who is visiting or who has sat there', async () => {
    for (const r of [room('lobby', 30 * DAY), room('playing', 300 * DAY), room('finished', 41 * DAY), room('finished', ROOM_OPEN_MS)]) {
      const look = lookup(r, 'stranger');
      expect(await frontDoor('KHI-4287Q', look, NOW), `${r.status} ${r.updated_at}`).toBe('lobby');
      expect(look.members).not.toHaveBeenCalled();
      expect(look.userId).not.toHaveBeenCalled();
    }
  });

  it('closes a room quiet for six weeks to a newcomer, before its first game as well as after its last', async () => {
    for (const status of ['lobby', 'finished'] as const) {
      expect(await frontDoor('KHI-4287Q', lookup(room(status, ROOM_OPEN_MS + 1), 'stranger'), NOW), status).toBe('closed');
      expect(await frontDoor('KHI-4287Q', lookup(room(status, 50 * DAY), null), NOW), status).toBe('closed');
    }
  });

  it('asks who has sat there by the room’s id, only once its writes say it’s quiet, and keeps it open for someone seen lately', async () => {
    const look = lookup(room('finished', 50 * DAY), 'stranger', true, [
      { userId: 'sana', lastSeenAt: NOW - 45 * DAY },
      { userId: 'zara', lastSeenAt: NOW - 3 * DAY },
    ]);
    expect(await frontDoor('KHI-4287Q', look, NOW)).toBe('lobby');
    expect(look.members).toHaveBeenCalledWith(ROOM_ID);
    expect(look.userId).not.toHaveBeenCalled();
    // Everyone seen more than six weeks ago: still closed to a stranger.
    expect(await frontDoor('KHI-4287Q', lookup(room('finished', 50 * DAY), 'stranger', true, [{ userId: 'sana', lastSeenAt: NOW - 45 * DAY }]), NOW)).toBe('closed');
  });

  it("still lets a closed room's own people back in, as the join does: anyone seated, or who has ever sat there", async () => {
    const long = [{ userId: 'omar', lastSeenAt: NOW - 90 * DAY }];
    expect(await frontDoor('KHI-4287Q', lookup(room('finished', 50 * DAY), 'sana', true, long), NOW)).toBe('lobby');
    expect(await frontDoor('KHI-4287Q', lookup(room('finished', 50 * DAY), 'host', true, long), NOW)).toBe('lobby');
    expect(await frontDoor('KHI-4287Q', lookup(room('lobby', 50 * DAY), 'omar', true, long), NOW)).toBe('lobby');
  });

  it('opens the lobby when the session check throws on a closed room', async () => {
    expect(await frontDoor('KHI-4287Q', lookup(room('finished', 50 * DAY), new Error('auth down')), NOW)).toBe('lobby');
  });
});

describe('isClosedRoom', () => {
  it('closes any room not playing, once six weeks have passed with no write to it', () => {
    for (const status of ['finished', 'lobby'] as const) {
      expect(isClosedRoom(room(status, ROOM_OPEN_MS + 1), NOW), status).toBe(true);
      expect(isClosedRoom(room(status, ROOM_OPEN_MS), NOW), status).toBe(false);
    }
    expect(ROOM_OPEN_MS).toBe(42 * DAY);
    expect(isClosedRoom(room('playing', 300 * DAY), NOW)).toBe(false);
  });

  it('counts a member seen there as the room not being quiet', () => {
    expect(isClosedRoom(room('finished', 50 * DAY), NOW, NOW - DAY)).toBe(false);
    expect(isClosedRoom(room('finished', 50 * DAY), NOW, NOW - ROOM_OPEN_MS)).toBe(false);
    expect(isClosedRoom(room('finished', 50 * DAY), NOW, NOW - ROOM_OPEN_MS - 1)).toBe(true);
    expect(isClosedRoom(room('finished', 50 * DAY), NOW, null)).toBe(true);
    // An older member doesn't make a recent write look older.
    expect(isClosedRoom(room('finished', DAY), NOW, NOW - 90 * DAY)).toBe(false);
  });

  it('reads the timestamp the way the database writes it', () => {
    expect(isClosedRoom({ status: 'finished', updated_at: '2026-08-01T10:00:00.123456+00:00' }, NOW)).toBe(true);
    expect(isClosedRoom({ status: 'finished', updated_at: '2026-09-01T10:00:00.123456+00:00' }, NOW)).toBe(false);
  });
});

describe('retryCanHelp', () => {
  it('offers no retry for a code with no table or a closed table', () => {
    expect(retryCanHelp(new ApiError(404, 'no room with that code'))).toBe(false);
    expect(retryCanHelp(new ApiError(404, 'no such game'))).toBe(false);
    expect(retryCanHelp(new ApiError(410, 'this table has closed'))).toBe(false);
  });

  it('offers no retry for a game the visitor has no seat in, since another go gets the same answer', () => {
    expect(retryCanHelp(new ApiError(403, 'not at this table'))).toBe(false);
  });

  it('offers a retry for anything another go might fix', () => {
    expect(retryCanHelp(new ApiError(409, 'this table is full'))).toBe(true);
    expect(retryCanHelp(new ApiError(409, 'this table has already started'))).toBe(true);
    expect(retryCanHelp(new ApiError(500, 'something went wrong'))).toBe(true);
    expect(retryCanHelp(new TypeError('Failed to fetch'))).toBe(true);
    expect(retryCanHelp('network-error')).toBe(true);
    expect(retryCanHelp(null)).toBe(true);
  });
});
