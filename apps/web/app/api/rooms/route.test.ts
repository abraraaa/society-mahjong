import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { RoomRow } from '../../../lib/live/store';

/**
 * Hosting a table. Each room made is one of the funnel's moments, counted
 * once the room exists, with its host and whether they're still a guest.
 */
const db = vi.hoisted(() => ({ user: { id: 'u-abrar', name: 'Abrar', isGuest: true } as { id: string; name: string; isGuest: boolean } | null }));

vi.mock('server-only', () => ({}));
vi.mock('../../../lib/live/auth', () => ({ currentUser: vi.fn(async () => db.user) }));
vi.mock('../../../lib/live/events', () => ({ recordEvent: vi.fn(async () => {}) }));
vi.mock('../../../lib/live/store', () => ({
  roomByCode: vi.fn(async () => null),
  createRoom: vi.fn(async (input: { code: string; hostId: string; hostName: string }) => ({ ...ROOM, code: input.code, host_id: input.hostId }) satisfies RoomRow),
}));

import { POST } from './route';
import * as events from '../../../lib/live/events';
import * as store from '../../../lib/live/store';
import { SupabaseError } from '../../../lib/live/errors';

const ROOM: RoomRow = {
  id: '3b9d2f6e-1a4c-4e8b-9d7f-5c2a0e6b8f13',
  code: 'ABCD',
  host_id: 'u-abrar',
  ruleset_id: 'karachi',
  options: {},
  status: 'lobby',
  seats: [{ kind: 'human', userId: 'u-abrar', name: 'Abrar' }, null, null, null],
  current_game_id: null,
  ledger: [0, 0, 0, 0],
  updated_at: '2026-09-28T19:00:00Z',
};

function host(body?: unknown): Promise<Response> {
  const req = new Request('https://societymahjong.app/api/rooms', { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) }) as unknown as NextRequest;
  return POST(req);
}

beforeEach(() => {
  vi.clearAllMocks();
  db.user = { id: 'u-abrar', name: 'Abrar', isGuest: true };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/rooms', () => {
  it('counts the room made, by its host, once the room exists', async () => {
    const res = await host();
    expect(res.status).toBe(201);
    const { id, code } = (await res.json()) as { id: string; code: string };
    expect(id).toBe(ROOM.id);
    expect(events.recordEvent).toHaveBeenCalledTimes(1);
    expect(events.recordEvent).toHaveBeenCalledWith({ type: 'room_made', roomId: ROOM.id, userId: 'u-abrar', data: { ruleset: 'karachi', guest: true } });
    expect(vi.mocked(store.createRoom).mock.calls[0]![0]).toMatchObject({ code, hostId: 'u-abrar', rulesetId: 'karachi' });
    const order = [store.createRoom, events.recordEvent].map((fn) => vi.mocked(fn).mock.invocationCallOrder[0]!);
    expect(order[0]).toBeLessThan(order[1]!);
  });

  it('says whether the host is still a guest', async () => {
    db.user = { id: 'u-hana', name: 'Hana', isGuest: false };
    expect((await host({ rulesetId: 'karachi', options: { strict: true } })).status).toBe(201);
    expect(events.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u-hana', data: { ruleset: 'karachi', guest: false } }));
  });

  it('counts nothing when no room was made: not signed in, a request it refuses, or a write that failed', async () => {
    db.user = null;
    expect((await host()).status).toBe(401);
    db.user = { id: 'u-abrar', name: 'Abrar', isGuest: true };
    expect((await host({ rulesetId: 'taiwanese' })).status).toBe(400);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(store.createRoom).mockRejectedValueOnce(new SupabaseError('create the room', { message: 'TypeError: fetch failed' }));
    expect((await host()).status).toBe(500);
    expect(events.recordEvent).not.toHaveBeenCalled();
  });
});
