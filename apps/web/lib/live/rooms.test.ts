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
  meta: null as unknown,
  /** what requireRoom reads next time, after a lost seat write */
  next: null as unknown,
}));

vi.mock('server-only', () => ({}));
vi.mock('./events', () => ({ recordEvent: vi.fn(async () => {}) }));
vi.mock('./store', () => ({
  roomByCode: vi.fn(async () => db.next ?? db.room),
  liveMeta: vi.fn(async () => db.meta),
  followSeat: vi.fn(async () => {}),
  gameById: vi.fn(async () => db.game),
  saveSeats: vi.fn(async () => '2026-09-24T00:00:01Z'),
  roomMembers: vi.fn(async () => db.members),
  lastGameOf: vi.fn(async () => db.current),
  lastFinishedGame: vi.fn(async () => db.lastFinished),
  touchMember: vi.fn(async () => true),
}));

import { ROOM_OPEN_MS } from '../front-door';
import { HttpError, SupabaseError } from './errors';
import { lastGameFromOver, type LastGameRow } from './final';
import type { GameOver } from './table-state';
import { joinRoom, leaveRoom, requireRoom, roomCircle, roomSnapshot, sitDown, type RoomCircle } from './rooms';
import { HERE_FOR_MS } from './seating';
import * as events from './events';
import * as store from './store';
import { EVERYONE_HERE } from './absence';
import type { LiveMeta } from './store';

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
  db.meta = null;
  db.next = null;
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

  it('while the finish has closed the room but not written the game yet, goes by the end saved on the table: who’s here, and the last game', async () => {
    const seats: RoomRow['seats'] = [room.seats[0], { kind: 'human', userId: 'u-bilal', name: 'Bilal' }, { kind: 'bot', name: 'Sana' }, { kind: 'bot', name: 'Omar' }];
    const over: GameOver = { how: 'complete', by: null, at: 7, hands: 16, scores: [100, 14504, -8000, -6604], seats };
    db.current = { status: 'active', endedAt: null, how: null, hands: 15, players: [] } satisfies LastGameRow;
    db.lastFinished = ended('finished', 2);
    db.meta = playingMeta({ table: { ...playingMeta().table, over } });
    const circle = await roomCircle(finished, 'show');
    expect(circle!.lastEndedAt).toBe(7);
    expect(circle!.lastGame).toEqual(lastGameFromOver(over));
    expect(store.liveMeta).toHaveBeenCalledWith(GAME);
    expect(store.lastFinishedGame).not.toHaveBeenCalled();
    // The lobby shows this game, not the one before, with Bilal on top.
    expect(roomSnapshot({ ...finished, seats }, 'u-abrar', Date.now(), circle).lastGame).toMatchObject({
      hands: 16,
      me: 0,
      rows: expect.arrayContaining([{ seat: 1, name: 'Bilal', bot: false, score: 14504 }]),
    });
  });

  it('after an abandon saved on the table but not yet on the game, judges who’s here by its end and shows the last finished game', async () => {
    db.current = { status: 'active', endedAt: null, how: null, hands: 3, players: [] } satisfies LastGameRow;
    db.lastFinished = ended('finished', 2);
    db.meta = playingMeta({ table: { ...playingMeta().table, over: { how: 'abandoned', by: null, at: 9, hands: 3, scores: [0, 0, 0, 0], seats: room.seats } } });
    const circle = await roomCircle(finished, 'show');
    expect(circle!.lastEndedAt).toBe(9);
    expect(circle!.lastGame).toBe(db.lastFinished);
  });

  it('with no end saved on the table either, reads the game as it stands', async () => {
    db.current = { status: 'active', endedAt: null, how: null, hands: 3, players: [] } satisfies LastGameRow;
    db.lastFinished = ended('finished', 2);
    db.meta = playingMeta();
    const circle = await roomCircle(finished, 'show');
    expect(circle!.lastEndedAt).toBeNull();
    expect(circle!.lastGame).toBe(db.lastFinished);
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

  it('notes on the other seats that they got up, so their lobby on another tab is told they left, until they sit down again', async () => {
    const between: RoomRow = { ...room, status: 'finished', seats: [abrar, { kind: 'human', userId: 'u-sana', name: 'Sana' }, { kind: 'bot', name: 'Omar' }, null] };
    const after = await leaveRoom(between, 'u-sana');
    expect(after.seats).toEqual([{ ...abrar, leavers: ['u-sana'] }, null, { kind: 'bot', name: 'Omar', leavers: ['u-sana'] }, null]);
    await expect(joinRoom(after, 'u-sana', 'Sana', Date.now(), 'rejoin')).rejects.toMatchObject({ status: 409, message: 'you left this table' });
    // Opening the link sits her down, and nothing says she left any more.
    const back = await joinRoom(after, 'u-sana', 'Sana');
    expect(back.seated).toBe(true);
    expect(JSON.stringify(back.room.seats)).not.toContain('leavers');
  });

  it('refuses while a game is in play: that’s left from the table', async () => {
    await expect(leaveRoom({ ...room, seats: [abrar, { kind: 'human', userId: 'u-sana', name: 'Sana' }, null, null] }, 'u-sana')).rejects.toMatchObject({
      status: 409,
      message: 'the table has started; leave it from the game',
    });
    expect(store.saveSeats).not.toHaveBeenCalled();
  });

  it('with their seat already taken by a newcomer, forgets that it was, so a rejoin on its way or on another phone can’t sit them down again', async () => {
    const zaraForSana = { kind: 'human', userId: 'u-zara', name: 'Zara', displaced: 'u-sana' } as const;
    const between: RoomRow = { ...room, status: 'finished', seats: [abrar, zaraForSana, { kind: 'human', userId: 'u-hana', name: 'Hana' }, null] };
    const after = await leaveRoom(between, 'u-sana');
    expect(vi.mocked(store.saveSeats).mock.calls[0]![1]).toEqual([
      { ...abrar, leavers: ['u-sana'] },
      { kind: 'human', userId: 'u-zara', name: 'Zara', leavers: ['u-sana'] },
      { ...between.seats[2], leavers: ['u-sana'] },
      null,
    ]);
    // The rejoin lands after the Leave: nothing says her seat was taken, so she's not sat down again, and she's told she left.
    await expect(joinRoom(after, 'u-sana', 'Sana', Date.now(), 'rejoin')).rejects.toMatchObject({ status: 409, message: 'you left this table' });
    expect(store.saveSeats).toHaveBeenCalledTimes(1);
  });

  it('writes nothing for someone with no seat and nothing noting one', async () => {
    const between: RoomRow = { ...room, status: 'finished', seats: [abrar, null, null, null] };
    expect(await leaveRoom(between, 'u-sana')).toBe(between);
    expect(store.saveSeats).not.toHaveBeenCalled();
  });
});

describe('the lobby sitting someone down again by itself (rejoin)', () => {
  const HOUR = 60 * 60 * 1000;
  const abrar = { kind: 'human', userId: 'u-abrar', name: 'Abrar' } as const;
  const bilal = { kind: 'human', userId: 'u-bilal', name: 'Bilal' } as const;
  const hana = { kind: 'human', userId: 'u-hana', name: 'Hana' } as const;
  const zara = { kind: 'human', userId: 'u-zara', name: 'Zara' } as const;
  const zaraForOmar = { ...zara, displaced: 'u-omar' } as const;

  it('sits down again someone whose seat went to a newcomer, in a free seat or a bot’s, and forgets the note', async () => {
    const out = await joinRoom({ ...room, status: 'finished', seats: [abrar, bilal, { kind: 'bot', name: 'Sana' }, zaraForOmar] }, 'u-omar', 'Omar', Date.now(), 'rejoin');
    expect(out).toMatchObject({ seated: true, displaced: false });
    expect(out.room.seats[2]).toMatchObject({ kind: 'human', userId: 'u-omar' });
    expect(out.room.seats[3]).toEqual(zara);
  });

  it('turns away someone who got up themselves, on this phone or another, saying so, and writes nothing', async () => {
    const rejoin = (seats: RoomRow['seats']) => joinRoom({ ...room, status: 'finished', seats }, 'u-omar', 'Omar', Date.now(), 'rejoin');
    // Up from the lobby, as the other seats note; or up from the last game, whose bot still keeps his seat.
    await expect(rejoin([{ ...abrar, leavers: ['u-omar'] }, bilal, null, null])).rejects.toMatchObject({ status: 409, message: 'you left this table' });
    await expect(rejoin([abrar, bilal, { kind: 'bot', name: 'Sana', heldFor: 'u-omar', keptName: 'Omar', kept: 'left' }, null])).rejects.toMatchObject({
      status: 409,
      message: 'you left this table',
    });
    // Opening the link is another matter: that sits them down.
    expect((await joinRoom({ ...room, status: 'finished', seats: [{ ...abrar, leavers: ['u-omar'] }, bilal, null, null] }, 'u-omar', 'Omar')).seated).toBe(true);
    expect(store.saveSeats).toHaveBeenCalledTimes(1);
  });

  it('never tells someone who didn’t get up that they did', async () => {
    const rejoin = (seats: RoomRow['seats']) => joinRoom({ ...room, status: 'finished', seats }, 'u-omar', 'Omar', Date.now(), 'rejoin');
    // A bot has kept his seat since a game was dealt while his lobby slept: it's waiting for him, and stays kept until he taps.
    await expect(rejoin([abrar, bilal, { kind: 'bot', name: 'Sana', heldFor: 'u-omar', keptName: 'Omar', kept: 'late' }, null])).rejects.toMatchObject({
      status: 409,
      message: 'a bot is keeping your seat',
    });
    // Zara was given his seat, then got up herself, and the note went with her: nothing says why he has no seat.
    await expect(rejoin([{ ...abrar, leavers: ['u-zara'] }, bilal, null, null])).rejects.toMatchObject({ status: 409, message: 'no seat to give back' });
    expect(store.saveSeats).not.toHaveBeenCalled();
    expect(store.touchMember).not.toHaveBeenCalled();
  });

  it('never takes anyone’s seat, so two lobbies that can’t check in can’t swap seats back and forth by themselves', async () => {
    // Neither Omar nor Zara can be checked in (no member row); Bilal and Hana are here.
    db.members = ['u-bilal', 'u-hana'].map((userId) => ({ userId, lastSeenAt: Date.now() - HOUR }));
    const full: RoomRow = { ...room, status: 'finished', seats: [abrar, zaraForOmar, bilal, hana] };
    await expect(joinRoom(full, 'u-omar', 'Omar', Date.now(), 'rejoin')).rejects.toMatchObject({ status: 409, message: 'this table is full' });
    expect(store.roomMembers).not.toHaveBeenCalled();
    expect(store.saveSeats).not.toHaveBeenCalled();
    // Omar taps Check again, which is opening the link: Zara isn't here, so he's given her seat back, noting it.
    const back = await joinRoom(full, 'u-omar', 'Omar');
    expect(back).toMatchObject({ seated: true, displaced: true });
    expect(back.room.seats[1]).toMatchObject({ userId: 'u-omar', displaced: 'u-zara' });
    // Zara's lobby asks by itself once: nowhere free, and it stops there.
    await expect(joinRoom(back.room, 'u-zara', 'Zara', Date.now(), 'rejoin')).rejects.toMatchObject({ status: 409, message: 'this table is full' });
    expect(store.saveSeats).toHaveBeenCalledTimes(1);
  });

  it('gives someone already seated their seat, and offers a bot’s seat at a game in play, as opening the link does', async () => {
    const seated = await joinRoom({ ...room, status: 'finished', seats: [abrar, { ...bilal, since: 'x' }, null, null] }, 'u-bilal', 'Bilal', Date.now(), 'rejoin');
    expect(seated).toMatchObject({ seated: false, room: { seats: [abrar, { ...bilal, since: 'x' }, null, null] } });
    db.meta = playingMeta();
    const offered = await joinRoom({ ...room, seats: [abrar, { kind: 'bot', name: 'Sana' }, hana, bilal] }, 'u-omar', 'Omar', Date.now(), 'rejoin');
    expect(offered.offer).toMatchObject({ seat: 1, botName: 'Sana' });
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

/** The table of the game in play, as liveMeta reads it: running totals, in play, hand 5 at seq 40. */
const playingMeta = (extra: Partial<LiveMeta> = {}): LiveMeta => ({
  version: 12,
  table: { v: 1, scores: [100, -3000, 2000, 900], over: null, absence: EVERYONE_HERE, ready: null, extra: {} },
  legacy: false,
  actedAt: Date.now(),
  updatedAt: Date.now(),
  hand: 5,
  seq: 40,
  ...extra,
});

describe('a newcomer between games, when every seat is taken', () => {
  const HOUR = 60 * 60 * 1000;
  const people: RoomRow['seats'] = [
    { kind: 'human', userId: 'u-abrar', name: 'Abrar' },
    { kind: 'human', userId: 'u-bilal', name: 'Bilal' },
    { kind: 'human', userId: 'u-hana', name: 'Hana' },
    { kind: 'human', userId: 'u-omar', name: 'Omar' },
  ];
  const full: RoomRow = { ...room, status: 'finished', seats: people };

  it('takes the seat of the regular seen longest ago who isn’t here tonight, and says so', async () => {
    db.members = [
      { userId: 'u-bilal', lastSeenAt: Date.now() - 7 * 24 * HOUR },
      { userId: 'u-hana', lastSeenAt: Date.now() - HOUR },
      { userId: 'u-omar', lastSeenAt: Date.now() - 8 * 24 * HOUR },
    ];
    const out = await joinRoom(full, 'u-zara', 'Zara');
    expect(out).toMatchObject({ seated: true, displaced: true, offer: null });
    // Her seat notes whose it was, so Omar's lobby can tell he didn't get up (the lobby's rejoin).
    expect(out.room.seats[3]).toMatchObject({ kind: 'human', userId: 'u-zara', displaced: 'u-omar' });
    expect(out.room.seats.slice(0, 3)).toEqual(people.slice(0, 3));
  });

  it('never takes the host’s seat, even when the host hasn’t been seen at all', async () => {
    db.members = ['u-bilal', 'u-hana', 'u-omar'].map((userId) => ({ userId, lastSeenAt: Date.now() - HOUR }));
    await expect(joinRoom(full, 'u-zara', 'Zara')).rejects.toMatchObject({ status: 409, message: 'this table is full' });
    expect(store.saveSeats).not.toHaveBeenCalled();
  });

  it('seats someone displaced who comes back like any other newcomer: a bot’s seat if there is one', async () => {
    const after: RoomRow = { ...full, seats: [people[0], people[1], people[2], { kind: 'bot', name: 'Sana' }] };
    const out = await joinRoom(after, 'u-omar', 'Omar');
    expect(out).toMatchObject({ seated: true, displaced: false });
    expect(out.room.seats[3]).toMatchObject({ userId: 'u-omar' });
  });
});

describe('a newcomer’s join reads only what their seat rests on', () => {
  const finished: RoomRow = { ...room, status: 'finished' };
  const down = () => new SupabaseError('read the last game', { message: 'TypeError: fetch failed' });

  it('sits them down in an open room with a free seat when the last game, or who has been seen, can’t be read', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(store.lastGameOf).mockRejectedValueOnce(down());
    const first = await joinRoom(finished, 'u-sana', 'Sana');
    expect(first).toMatchObject({ seated: true, displaced: false });
    // The lobby's snapshot tags nobody this once; its next poll reads again.
    expect(first.circle).toBeNull();
    vi.mocked(store.roomMembers).mockRejectedValueOnce(down());
    expect((await joinRoom(finished, 'u-hana', 'Hana')).seated).toBe(true);
    expect(JSON.parse(log.mock.calls[0]![0] as string)).toMatchObject({ event: 'room_circle_failed' });
    log.mockRestore();
  });

  it('asks who’s here only once every other seat is a person’s, and then for real', async () => {
    await joinRoom(finished, 'u-sana', 'Sana');
    // Seated first; the circle read after is only for the lobby's snapshot.
    expect(vi.mocked(store.saveSeats).mock.invocationCallOrder[0]!).toBeLessThan(vi.mocked(store.lastGameOf).mock.invocationCallOrder[0]!);
    vi.clearAllMocks();
    const full: RoomRow = {
      ...finished,
      seats: [room.seats[0], { kind: 'human', userId: 'u-b', name: 'B' }, { kind: 'human', userId: 'u-c', name: 'C' }, { kind: 'human', userId: 'u-d', name: 'D' }],
    };
    vi.mocked(store.lastGameOf).mockRejectedValueOnce(down());
    await expect(joinRoom(full, 'u-sana', 'Sana')).rejects.toBeInstanceOf(SupabaseError);
    expect(store.saveSeats).not.toHaveBeenCalled();
  });

  it('never gives a newcomer the host’s own kept seat, so the host is never told their own table is full', async () => {
    const HOUR = 60 * 60 * 1000;
    const keptForHost = { kind: 'bot', name: 'Sana', heldFor: 'u-abrar', keptName: 'Abrar', kept: 'left' } as const;
    const people = [
      { kind: 'human', userId: 'u-bilal', name: 'Bilal' },
      { kind: 'human', userId: 'u-hana', name: 'Hana' },
      { kind: 'human', userId: 'u-omar', name: 'Omar' },
    ] as const;
    const r: RoomRow = { ...finished, seats: [keptForHost, ...people] };
    db.members = ['u-bilal', 'u-hana', 'u-omar'].map((userId) => ({ userId, lastSeenAt: Date.now() - HOUR }));
    await expect(joinRoom(r, 'u-zara', 'Zara')).rejects.toMatchObject({ status: 409, message: 'this table is full' });
    expect(store.saveSeats).not.toHaveBeenCalled();
    // The host sits back down in it.
    const back = await joinRoom(r, 'u-abrar', 'Abrar');
    expect(back).toMatchObject({ seated: true, displaced: false });
    expect(back.room.seats[0]).toMatchObject({ kind: 'human', userId: 'u-abrar' });
  });
});

describe('a newcomer at a game in play', () => {
  const playing: RoomRow = {
    ...room,
    seats: [room.seats[0], { kind: 'bot', name: 'Bilal' }, { kind: 'bot', name: 'Hamza', heldFor: 'u-zara', keptName: 'Zara', kept: 'late' }, { kind: 'bot', name: 'Omar' }],
  };

  it('is offered a bot’s seat with its running total, and nothing is written', async () => {
    db.meta = playingMeta();
    const out = await joinRoom(playing, 'u-sana', 'Sana');
    expect(out).toMatchObject({ seated: false, circle: null, offer: { seat: 1, botName: 'Bilal', why: 'other', score: -3000 } });
    expect(store.saveSeats).not.toHaveBeenCalled();
    expect(store.touchMember).not.toHaveBeenCalled();
    expect(store.liveMeta).toHaveBeenCalledWith(GAME);
    // The lobby snapshot carries it.
    expect(roomSnapshot(out.room, 'u-sana', Date.now(), null, out.offer)).toMatchObject({ me: null, offer: { seat: 1 } });
  });

  it('is offered the seat kept for them first', async () => {
    db.meta = playingMeta();
    expect((await joinRoom(playing, 'u-zara', 'Zara')).offer).toEqual({ seat: 2, botName: 'Hamza', why: 'late', score: 2000 });
  });

  it('reads a legacy table’s totals from the room’s ledger', async () => {
    db.meta = playingMeta({ legacy: true, table: { v: 1, scores: null, over: null, absence: EVERYONE_HERE, ready: null, extra: {} } });
    const out = await joinRoom({ ...playing, ledger: [5, 6, 7, 8] }, 'u-sana', 'Sana');
    expect(out.offer).toMatchObject({ seat: 1, score: 6 });
  });

  it('is turned away when no bot is playing, or the table can’t be found', async () => {
    const people: RoomRow = {
      ...room,
      seats: [room.seats[0], { kind: 'human', userId: 'u-b', name: 'B' }, { kind: 'human', userId: 'u-c', name: 'C' }, { kind: 'human', userId: 'u-d', name: 'D' }],
    };
    db.meta = playingMeta();
    await expect(joinRoom(people, 'u-sana', 'Sana')).rejects.toMatchObject({ status: 409, message: 'this table has already started' });
    db.meta = null;
    await expect(joinRoom(playing, 'u-sana', 'Sana')).rejects.toMatchObject({ status: 409, message: 'this table has already started' });
    expect(store.saveSeats).not.toHaveBeenCalled();
  });
});

describe('sitting down from the take-over screen', () => {
  const kept = { kind: 'bot', name: 'Hamza', heldFor: 'u-zara', keptName: 'Zara', kept: 'left' } as const;
  const playing: RoomRow = { ...room, seats: [room.seats[0], { kind: 'bot', name: 'Bilal' }, kept, { kind: 'human', userId: 'u-omar', name: 'Omar' }] };

  it('takes a bot’s seat over, then checks them in, has the game’s record follow the seat, and counts it', async () => {
    const now = Date.now();
    const out = await sitDown(playing, 'u-sana', 'Sana', 1, now);
    expect(out).toMatchObject({ took: true, how: 'take_over', joined: false, circle: null });
    const entry = { kind: 'human', userId: 'u-sana', name: 'Sana', since: new Date(now).toISOString() };
    expect(out.room.seats[1]).toEqual(entry);
    expect(vi.mocked(store.saveSeats).mock.calls[0]![2]).toBe(playing.updated_at);
    expect(store.touchMember).toHaveBeenCalledWith('r-1', 'u-sana', now);
    expect(store.followSeat).toHaveBeenCalledWith(GAME, 1, entry);
    expect(events.recordEvent).toHaveBeenCalledWith({ type: 'seat_taken', roomId: 'r-1', gameId: GAME, userId: 'u-sana', data: { how: 'take_over', status: 'playing' } });
  });

  it('says how someone came back to a kept seat: since they left, or since the deal they missed', async () => {
    expect((await sitDown(playing, 'u-zara', 'Zara', 2)).how).toBe('sit_back');
    const late: RoomRow = { ...playing, seats: [playing.seats[0], playing.seats[1], { ...kept, kept: 'late' }, playing.seats[3]] };
    expect((await sitDown(late, 'u-zara', 'Zara', 2)).how).toBe('kept_seat');
  });

  it('refuses a person’s seat, someone else’s kept seat while a free bot is there, and an empty seat', async () => {
    await expect(sitDown(playing, 'u-sana', 'Sana', 3)).rejects.toMatchObject({ status: 409, message: 'that seat is taken' });
    await expect(sitDown(playing, 'u-sana', 'Sana', 2)).rejects.toMatchObject({ status: 409, message: 'that seat is kept for someone' });
    const emptied: RoomRow = { ...playing, seats: [playing.seats[0], null, playing.seats[2], playing.seats[3]] };
    await expect(sitDown(emptied, 'u-sana', 'Sana', 1)).rejects.toMatchObject({ status: 409, message: 'that is not a seat to sit in' });
    expect(store.saveSeats).not.toHaveBeenCalled();
    expect(events.recordEvent).not.toHaveBeenCalled();
  });

  it('reads the room again when someone else’s write lands first, and gives up on the third', async () => {
    vi.mocked(store.saveSeats).mockResolvedValueOnce(null);
    db.next = playing;
    db.game = game('active');
    expect((await sitDown(playing, 'u-sana', 'Sana', 1)).took).toBe(true);
    expect(store.saveSeats).toHaveBeenCalledTimes(2);
    vi.mocked(store.saveSeats).mockClear();
    for (let i = 0; i < 3; i++) vi.mocked(store.saveSeats).mockResolvedValueOnce(null);
    await expect(sitDown(playing, 'u-sana', 'Sana', 1)).rejects.toMatchObject({ status: 409, message: 'that seat was just taken; try again' });
    expect(store.saveSeats).toHaveBeenCalledTimes(3);
  });

  it('finds the seat taken by someone else on the fresh read, and says so', async () => {
    vi.mocked(store.saveSeats).mockResolvedValueOnce(null);
    db.next = { ...playing, seats: [playing.seats[0], { kind: 'human', userId: 'u-hana', name: 'Hana' }, playing.seats[2], playing.seats[3]] };
    await expect(sitDown(playing, 'u-sana', 'Sana', 1)).rejects.toMatchObject({ status: 409, message: 'that seat is taken' });
  });

  it('takes nothing for someone already seated', async () => {
    const out = await sitDown(playing, 'u-omar', 'Omar', 1);
    expect(out).toMatchObject({ took: false, joined: false });
    expect(store.saveSeats).not.toHaveBeenCalled();
  });

  it('joins instead when the game has ended since the offer, with the join’s circle', async () => {
    const finished: RoomRow = { ...playing, status: 'finished' };
    const out = await sitDown(finished, 'u-sana', 'Sana', 1);
    expect(out).toMatchObject({ took: false, joined: true, displaced: false });
    expect(out.circle).not.toBeNull();
    expect(out.room.seats[1]).toMatchObject({ userId: 'u-sana' });
    expect(store.followSeat).not.toHaveBeenCalled();
    expect(events.recordEvent).not.toHaveBeenCalled();
  });
});
