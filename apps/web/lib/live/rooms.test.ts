import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameRow, RoomRow } from './store';

/**
 * The room as the lobby and the start button see it. A room whose row still
 * says "playing" after its game has ended (a finish that failed part way,
 * before the room was written first) must read as finished: otherwise the
 * lobby sends everyone back to the final table and the host can never deal
 * again.
 */
const db = vi.hoisted(() => ({
  room: null as unknown,
  game: null as unknown,
  members: [] as { userId: string; lastSeenAt: number }[],
  current: null as unknown,
  lastFinished: null as unknown,
}));

vi.mock('server-only', () => ({}));
vi.mock('./store', () => ({
  roomByCode: vi.fn(async () => db.room),
  gameById: vi.fn(async () => db.game),
  saveSeats: vi.fn(async () => '2026-09-24T00:00:01Z'),
  roomMembers: vi.fn(async () => db.members),
  lastGameOf: vi.fn(async () => db.current),
  lastFinishedGame: vi.fn(async () => db.lastFinished),
  touchMember: vi.fn(async () => true),
}));

import { ROOM_OPEN_MS } from '../front-door';
import { HttpError, SupabaseError } from './errors';
import type { LastGameRow } from './final';
import { joinRoom, leaveRoom, requireRoom, roomCircle, roomSnapshot, type RoomCircle } from './rooms';
import { HERE_FOR_MS } from './seating';
import * as store from './store';

const GAME = '6f1c2a9e-4b7d-4e3a-9c5f-2d8b0a7e1f34';
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
  updated_at: new Date().toISOString(),
};
const game = (status: GameRow['status']): GameRow => ({ id: GAME, room_id: 'r-1', seed: 'seed', status, hands_played: 16 });

beforeEach(() => {
  vi.clearAllMocks();
  db.room = room;
  db.game = game('active');
  db.members = [];
  db.current = null;
  db.lastFinished = null;
});

describe('a room, as it stands', () => {
  it('is playing while its game is live', async () => {
    expect((await requireRoom('ABCD')).status).toBe('playing');
    expect(store.gameById).toHaveBeenCalledWith(GAME);
  });

  it.each(['finished', 'abandoned'] as const)('reads as finished when its row says playing but its game is %s', async (status) => {
    db.game = game(status);
    expect(await requireRoom('ABCD')).toEqual({ ...room, status: 'finished' });
  });

  it('reads as finished when its game is gone', async () => {
    db.game = null;
    expect((await requireRoom('ABCD')).status).toBe('finished');
    db.room = { ...room, current_game_id: null };
    vi.mocked(store.gameById).mockClear();
    expect((await requireRoom('ABCD')).status).toBe('finished');
    expect(store.gameById).not.toHaveBeenCalled();
  });

  it('takes a lobby or a finished room at its word, without reading the game', async () => {
    for (const status of ['lobby', 'finished'] as const) {
      db.room = { ...room, status };
      expect((await requireRoom('ABCD')).status).toBe(status);
    }
    expect(store.gameById).not.toHaveBeenCalled();
  });

  it('fails when the game cannot be read, rather than guessing either way', async () => {
    vi.mocked(store.gameById).mockRejectedValueOnce(new SupabaseError('read the game', { message: 'TypeError: fetch failed' }));
    await expect(requireRoom('ABCD')).rejects.toBeInstanceOf(SupabaseError);
  });

  it('keeps someone who comes back to a room like that in the lobby, not bounced to the final table', async () => {
    db.game = game('finished');
    const { room: back, seated } = await joinRoom(await requireRoom('ABCD'), 'u-abrar', 'Abrar');
    expect(seated).toBe(false);
    expect(back.status).toBe('finished');
  });
});

describe('a quiet room, six weeks on', () => {
  // The front door's rule (isClosedRoom in lib/front-door.ts) is the join's too, so the two can't drift apart.
  const quiet = (status: RoomRow['status'], ageMs: number): RoomRow => ({ ...room, status, updated_at: new Date(Date.now() - ageMs).toISOString() });
  const MINUTE = 60_000;

  it('turns a newcomer away once six weeks have passed with nothing written and nobody seen, before the first game as well as after the last', async () => {
    for (const status of ['finished', 'lobby'] as const) {
      const err = await joinRoom(quiet(status, ROOM_OPEN_MS + MINUTE), 'u-sana', 'Sana').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpError);
      expect(err).toMatchObject({ status: 410, message: 'this table has closed' });
    }
    expect(store.saveSeats).not.toHaveBeenCalled();
  });

  it('still seats a newcomer within the six weeks', async () => {
    const { room: after, seated } = await joinRoom(quiet('finished', ROOM_OPEN_MS - MINUTE), 'u-sana', 'Sana');
    expect(seated).toBe(true);
    // Stamped with when she sat, for who has sat longest and a fresh absence.
    expect(after.seats[1]).toEqual({ kind: 'human', userId: 'u-sana', name: 'Sana', since: expect.any(String) });
    expect(Date.now() - Date.parse((after.seats[1] as { since: string }).since)).toBeLessThan(60_000);
  });

  it('stays open while one of its people has been seen there lately, however long since the room was written', async () => {
    db.members = [{ userId: 'u-omar', lastSeenAt: Date.now() - 3 * 24 * 60 * MINUTE }];
    const { seated } = await joinRoom(quiet('finished', 3 * ROOM_OPEN_MS), 'u-sana', 'Sana');
    expect(seated).toBe(true);
  });

  it('lets its own people back in after the six weeks: anyone seated, or who has ever sat there', async () => {
    expect((await joinRoom(quiet('finished', 30 * ROOM_OPEN_MS), 'u-abrar', 'Abrar')).seated).toBe(false);
    db.members = [{ userId: 'u-omar', lastSeenAt: Date.now() - 2 * ROOM_OPEN_MS }];
    expect((await joinRoom(quiet('finished', 30 * ROOM_OPEN_MS), 'u-omar', 'Omar')).seated).toBe(true);
  });

  it('won’t turn anyone away on a guess: when who has sat there can’t be read, the join fails and can be tried again', async () => {
    vi.mocked(store.roomMembers).mockRejectedValueOnce(new SupabaseError('read who has sat here', { message: 'TypeError: fetch failed' }));
    await expect(joinRoom(quiet('finished', ROOM_OPEN_MS + MINUTE), 'u-sana', 'Sana')).rejects.toBeInstanceOf(SupabaseError);
    expect(store.saveSeats).not.toHaveBeenCalled();
  });
});

describe('opening the link checks you in', () => {
  const finished: RoomRow = { ...room, status: 'finished' };

  it('checks a seated person in and writes no seats, and the circle it returns has them here', async () => {
    db.room = finished;
    const now = Date.now();
    const { seated, circle } = await joinRoom(finished, 'u-abrar', 'Abrar', now);
    expect(seated).toBe(false);
    expect(store.touchMember).toHaveBeenCalledWith('r-1', 'u-abrar', now);
    expect(store.saveSeats).not.toHaveBeenCalled();
    expect(circle!.seen.get('u-abrar')).toBe(now);
  });

  it('checks a newcomer in once they’re seated', async () => {
    db.room = finished;
    const now = Date.now();
    const { seated, circle } = await joinRoom(finished, 'u-sana', 'Sana', now);
    expect(seated).toBe(true);
    expect(vi.mocked(store.saveSeats).mock.invocationCallOrder[0]!).toBeLessThan(vi.mocked(store.touchMember).mock.invocationCallOrder[0]!);
    expect(store.touchMember).toHaveBeenCalledWith('r-1', 'u-sana', now);
    expect(circle!.seen.get('u-sana')).toBe(now);
  });

  it('doesn’t fail the join when the check-in doesn’t land, and doesn’t pretend it did: the lobby’s next poll tries again', async () => {
    db.room = finished;
    vi.mocked(store.touchMember).mockResolvedValueOnce(false);
    const { seated, circle } = await joinRoom(finished, 'u-abrar', 'Abrar');
    expect(seated).toBe(false);
    expect(circle!.seen.has('u-abrar')).toBe(false);
    expect(roomSnapshot(finished, 'u-abrar', Date.now(), circle).seats[0]).toMatchObject({ notHere: true });
  });

  it('checks someone in at a game in play too, without reading who else has been seen', async () => {
    const { circle } = await joinRoom(room, 'u-abrar', 'Abrar');
    expect(store.touchMember).toHaveBeenCalledTimes(1);
    expect(store.roomMembers).not.toHaveBeenCalled();
    expect(circle).toBeNull();
  });
});

describe('who has been seen at a room', () => {
  const finished: RoomRow = { ...room, status: 'finished' };
  const ended = (status: LastGameRow['status'], endedAt: number): LastGameRow => ({
    status,
    endedAt,
    how: status === 'finished' ? 'complete' : 'abandoned',
    hands: 3,
    players: [],
  });

  it('reads the members, and the current game’s end between games', async () => {
    db.members = [{ userId: 'u-abrar', lastSeenAt: 5 }];
    db.current = ended('finished', 4);
    const circle = await roomCircle(finished, 'show');
    expect(circle).toEqual({ seen: new Map([['u-abrar', 5]]), lastEndedAt: 4, lastGame: db.current });
    expect(store.lastGameOf).toHaveBeenCalledWith(GAME);
    expect(store.lastFinishedGame).not.toHaveBeenCalled();
  });

  it('after an abandon, judges who’s here by that game’s end but shows the room’s last finished game', async () => {
    db.current = ended('abandoned', 9);
    db.lastFinished = ended('finished', 2);
    const circle = await roomCircle(finished, 'show');
    expect(circle!.lastEndedAt).toBe(9);
    expect(circle!.lastGame).toBe(db.lastFinished);
    expect(store.lastFinishedGame).toHaveBeenCalledWith('r-1');
  });

  it('reads no game before the room’s first, or while one is in play', async () => {
    for (const r of [{ ...room, status: 'lobby' as const, current_game_id: null }, room]) {
      expect(await roomCircle(r, 'show')).toEqual({ seen: new Map(), lastEndedAt: null, lastGame: null });
    }
    expect(store.lastGameOf).not.toHaveBeenCalled();
  });

  it('gives null for the lobby when it can’t be read, logged; throws when a decision rests on it', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(store.roomMembers).mockRejectedValueOnce(new SupabaseError('read who has sat here', { message: 'TypeError: fetch failed' }));
    expect(await roomCircle(finished, 'show')).toBeNull();
    expect(JSON.parse(log.mock.calls[0]![0] as string)).toMatchObject({ event: 'room_circle_failed', roomId: 'r-1' });
    vi.mocked(store.lastGameOf).mockRejectedValueOnce(new SupabaseError('read the last game', { message: 'TypeError: fetch failed' }));
    await expect(roomCircle(finished, 'decide')).rejects.toBeInstanceOf(SupabaseError);
    log.mockRestore();
  });
});

describe('the lobby, between games', () => {
  const NOW = Date.parse('2026-09-28T19:30:00Z');
  const HOUR = 60 * 60 * 1000;
  const abrar = { kind: 'human', userId: 'u-abrar', name: 'Abrar', since: '2026-09-21T18:00:00Z' } as const;
  const bilal = { kind: 'human', userId: 'u-bilal', name: 'Bilal', since: '2026-09-21T18:05:00Z' } as const;
  const hana = { kind: 'human', userId: 'u-hana', name: 'Hana', since: '2026-09-21T18:10:00Z' } as const;
  const finished: RoomRow = { ...room, status: 'finished', seats: [abrar, bilal, hana, { kind: 'bot', name: 'Sana' }] };
  const lastGame: LastGameRow = {
    status: 'finished',
    endedAt: NOW - 7 * 24 * HOUR,
    how: 'complete',
    hands: 16,
    players: [
      { seat: 0, userId: 'u-abrar', kind: 'human', name: 'Abrar', score: 2000, place: 2 },
      { seat: 1, userId: 'u-bilal', kind: 'human', name: 'Bilal', score: 14504, place: 1 },
      { seat: 2, userId: 'u-hana', kind: 'human', name: 'Hana', score: -8000, place: 3 },
      { seat: 3, userId: null, kind: 'bot', name: 'Sana', score: -8504, place: 4 },
    ],
  };
  const circle = (seen: Record<string, number>): RoomCircle => ({ seen: new Map(Object.entries(seen)), lastEndedAt: lastGame.endedAt, lastGame });

  it('marks who isn’t here yet, and hands the powers to whoever here has sat longest while the host isn’t', () => {
    const snap = roomSnapshot(finished, 'u-hana', NOW, circle({ 'u-hana': NOW - HOUR, 'u-bilal': NOW - 2 * HOUR }));
    expect(snap.seats).toEqual([
      { kind: 'human', name: 'Abrar', notHere: true },
      { kind: 'human', name: 'Bilal' },
      { kind: 'human', name: 'Hana' },
      { kind: 'bot', name: 'Sana' },
    ]);
    expect(snap.hostSeat).toBe(1);
    expect(snap.isHost).toBe(false);
    expect(roomSnapshot(finished, 'u-bilal', NOW, circle({ 'u-hana': NOW - HOUR, 'u-bilal': NOW - 2 * HOUR })).isHost).toBe(true);
  });

  it('gives the powers back to the host once they’re here', () => {
    const snap = roomSnapshot(finished, 'u-abrar', NOW, circle({ 'u-abrar': NOW, 'u-hana': NOW - HOUR }));
    expect(snap.isHost).toBe(true);
    expect(snap.hostSeat).toBe(0);
  });

  it('counts a check-in from before the last game ended, or more than six hours ago, as not here', () => {
    const snap = roomSnapshot(finished, 'u-abrar', NOW, circle({ 'u-abrar': NOW, 'u-bilal': lastGame.endedAt! - 1, 'u-hana': NOW - HERE_FOR_MS - 1 }));
    expect(snap.seats.map((s) => s && 'notHere' in s)).toEqual([false, true, true, false]);
  });

  it('shows the last game, with the reader’s seat in it and no ids', () => {
    const snap = roomSnapshot(finished, 'u-hana', NOW, circle({ 'u-hana': NOW }));
    expect(snap.lastGame).toEqual({
      how: 'complete',
      hands: 16,
      rows: [
        { seat: 0, name: 'Abrar', bot: false, score: 2000 },
        { seat: 1, name: 'Bilal', bot: false, score: 14504 },
        { seat: 2, name: 'Hana', bot: false, score: -8000 },
        { seat: 3, name: 'Sana', bot: true, score: -8504 },
      ],
      me: 2,
    });
    expect(JSON.stringify(snap)).not.toContain('u-');
  });

  it('with no circle (the routes before they read one, or one that failed), tags nobody and shows no last game', () => {
    const snap = roomSnapshot(finished, 'u-abrar');
    expect(snap.seats.some((s) => s && 'notHere' in s)).toBe(false);
    expect(snap.lastGame).toBeNull();
    expect(snap.isHost).toBe(true);
    expect(snap.hostSeat).toBe(0);
  });

  it('before the first game, tags who hasn’t opened the link in six hours, and shows no last game', () => {
    const lobby: RoomRow = { ...finished, status: 'lobby', current_game_id: null };
    const snap = roomSnapshot(lobby, 'u-abrar', NOW, { seen: new Map([['u-abrar', NOW - 5 * HOUR]]), lastEndedAt: null, lastGame: null });
    expect(snap.seats.map((s) => s && 'notHere' in s)).toEqual([false, true, true, false]);
    expect(snap.lastGame).toBeNull();
  });

  it('while a game is in play, tags nobody: the table says who’s away', () => {
    const snap = roomSnapshot({ ...finished, status: 'playing' }, 'u-abrar', NOW, circle({}));
    expect(snap.seats.some((s) => s && 'notHere' in s)).toBe(false);
    expect(snap.lastGame).toBeNull();
  });
});

describe('standing up from the lobby', () => {
  const abrar = { kind: 'human', userId: 'u-abrar', name: 'Abrar' } as const;

  it('works before the first game and between games, emptying the seat', async () => {
    for (const status of ['lobby', 'finished'] as const) {
      const after = await leaveRoom({ ...room, status, seats: [abrar, { kind: 'human', userId: 'u-sana', name: 'Sana' }, null, null] }, 'u-sana');
      expect(after.seats[1], status).toBeNull();
    }
  });

  it('refuses while a game is in play: that’s left from the table', async () => {
    await expect(leaveRoom({ ...room, seats: [abrar, { kind: 'human', userId: 'u-sana', name: 'Sana' }, null, null] }, 'u-sana')).rejects.toMatchObject({
      status: 409,
      message: 'the table has started; leave it from the game',
    });
    expect(store.saveSeats).not.toHaveBeenCalled();
  });
});

describe('who the lobby calls host', () => {
  const abrar = { kind: 'human', userId: 'u-abrar', name: 'Abrar' } as const;
  const bilal = { kind: 'human', userId: 'u-bilal', name: 'Bilal' } as const;
  const sana = { kind: 'human', userId: 'u-sana', name: 'Sana' } as const;

  it('is the room’s host while they’re seated, and nobody else', () => {
    const r: RoomRow = { ...room, status: 'lobby', seats: [bilal, abrar, null, null] };
    expect(roomSnapshot(r, 'u-abrar').isHost).toBe(true);
    expect(roomSnapshot(r, 'u-bilal').isHost).toBe(false);
  });

  it('passes to whoever has sat longest once the host has stood up, as the table and the start button have it', () => {
    const r: RoomRow = {
      ...room,
      status: 'finished',
      seats: [{ kind: 'bot', name: 'Omar' }, { ...sana, since: '2026-09-24T19:05:00Z' }, { ...bilal, since: '2026-09-24T19:00:00Z' }, null],
    };
    expect(roomSnapshot(r, 'u-bilal').isHost).toBe(true);
    expect(roomSnapshot(r, 'u-sana').isHost).toBe(false);
    // The room's host, not seated, has no powers here until they sit down again.
    expect(roomSnapshot(r, 'u-abrar').isHost).toBe(false);
  });
});
