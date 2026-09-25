import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './live/client';
import type { Seats } from './live/types';
import { ROOM_OPEN_MS, frontDoor, isClosedRoom, retryCanHelp, type DoorLookup, type DoorRoom } from './front-door';

const NOW = Date.parse('2026-09-24T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const SEATS: Seats = [{ kind: 'human', userId: 'host', name: 'Abrar' }, { kind: 'human', userId: 'sana', name: 'Sana' }, { kind: 'bot', name: 'Bilal' }, null];

function room(status: DoorRoom['status'], ageMs: number): DoorRoom {
  return { status, updated_at: new Date(NOW - ageMs).toISOString(), seats: SEATS };
}

function lookup(found: DoorRoom | null | Error, userId: string | null | Error = null, configured = true) {
  const look = {
    configured,
    room: vi.fn(async () => {
      if (found instanceof Error) throw found;
      return found;
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
  });

  it('opens the lobby for a room waiting, playing, or finished within the week, without asking who is visiting', async () => {
    for (const r of [room('lobby', 30 * DAY), room('playing', 30 * DAY), room('finished', 6 * DAY), room('finished', ROOM_OPEN_MS)]) {
      const look = lookup(r, 'stranger');
      expect(await frontDoor('KHI-4287Q', look, NOW), `${r.status} ${r.updated_at}`).toBe('lobby');
      expect(look.userId).not.toHaveBeenCalled();
    }
  });

  it('closes a room a week past its last game to a newcomer', async () => {
    expect(await frontDoor('KHI-4287Q', lookup(room('finished', ROOM_OPEN_MS + 1), 'stranger'), NOW)).toBe('closed');
    expect(await frontDoor('KHI-4287Q', lookup(room('finished', 30 * DAY), null), NOW)).toBe('closed');
  });

  it("still lets a closed room's own people back in, as the join does", async () => {
    expect(await frontDoor('KHI-4287Q', lookup(room('finished', 30 * DAY), 'sana'), NOW)).toBe('lobby');
    expect(await frontDoor('KHI-4287Q', lookup(room('finished', 30 * DAY), 'host'), NOW)).toBe('lobby');
  });

  it('opens the lobby when the session check throws on a closed room', async () => {
    expect(await frontDoor('KHI-4287Q', lookup(room('finished', 30 * DAY), new Error('auth down')), NOW)).toBe('lobby');
  });
});

describe('isClosedRoom', () => {
  it('only a finished room closes, and only after the week', () => {
    expect(isClosedRoom(room('finished', ROOM_OPEN_MS + 1), NOW)).toBe(true);
    expect(isClosedRoom(room('finished', ROOM_OPEN_MS), NOW)).toBe(false);
    expect(isClosedRoom(room('lobby', 30 * DAY), NOW)).toBe(false);
    expect(isClosedRoom(room('playing', 30 * DAY), NOW)).toBe(false);
  });

  it('reads the timestamp the way the database writes it', () => {
    expect(isClosedRoom({ status: 'finished', updated_at: '2026-09-01T10:00:00.123456+00:00' }, NOW)).toBe(true);
    expect(isClosedRoom({ status: 'finished', updated_at: '2026-09-20T10:00:00.123456+00:00' }, NOW)).toBe(false);
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
