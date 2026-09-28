import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EVERYONE_HERE } from '../../../../../lib/live/absence';
import type { NextRequest } from 'next/server';
import type { GameRow, LiveMeta, RoomRow } from '../../../../../lib/live/store';
import type { GameOver } from '../../../../../lib/live/table-state';

/**
 * The host's "Play again". A room is startable unless its game is live: one
 * left "playing" by a game that has ended, one whose finish closed the room
 * but not yet the game, one whose game's end is saved but whose finish never
 * ran (it's finished first), and one whose game nobody has played for hours
 * (it's ended first), can all be dealt again. "The host" is whoever has the
 * host's powers: the room's host while seated, else whoever has sat longest.
 * A deal is one of the funnel's moments, counted once the room points at it.
 */
const db = vi.hoisted(() => ({
  room: null as unknown,
  game: null as unknown,
  meta: null as unknown,
  after: null as unknown,
  live: null as unknown,
  user: 'u-abrar',
  /** who has been seen at the room; null means everyone seated, a moment ago */
  members: null as { userId: string; lastSeenAt: number }[] | null,
  lastGame: null as unknown,
}));

vi.mock('server-only', () => ({}));
vi.mock('../../../../../lib/live/auth', () => ({ currentUser: vi.fn(async () => ({ id: db.user, name: 'Someone', isGuest: true })) }));
vi.mock('../../../../../lib/live/broadcast', () => ({
  broadcast: vi.fn(async () => {}),
  gamePoke: vi.fn(() => ({})),
  roomPoke: vi.fn(() => ({})),
}));
vi.mock('../../../../../lib/live/table', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../lib/live/table')>();
  return { ...actual, dealFirstHand: vi.fn(actual.dealFirstHand) };
});
vi.mock('../../../../../lib/live/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../lib/live/events')>();
  return { ...actual, recordEvent: vi.fn(async () => {}) };
});
vi.mock('../../../../../lib/live/store', () => ({
  roomByCode: vi.fn(async () => db.room),
  roomById: vi.fn(async () => db.after ?? db.room),
  gameById: vi.fn(async () => db.game),
  liveMeta: vi.fn(async () => db.meta),
  loadLive: vi.fn(async () => db.live),
  commitTable: vi.fn(async (_id: string, expected: number) => expected + 1),
  countHand: vi.fn(async () => {}),
  recordHand: vi.fn(async () => {}),
  finishGame: vi.fn(async () => {}),
  stagesBySeat: vi.fn(async (seats: readonly ({ kind: string } | null)[]) => seats.map((s) => (s?.kind === 'human' ? 'new' : null))),
  seatStages: vi.fn(async (seats: readonly ({ kind: string } | null)[]) => ({ levels: seats.map((s) => (s?.kind === 'human' ? 'new' : null)), read: true })),
  startGame: vi.fn(async () => ({ id: NEXT, room_id: 'r-1', seed: 'seed', status: 'active', hands_played: 0 })),
  roomMembers: vi.fn(
    async () =>
      db.members ??
      (db.room as { seats: ({ kind: string; userId?: string } | null)[] }).seats.flatMap((s) =>
        s?.kind === 'human' ? [{ userId: s.userId!, lastSeenAt: Date.now() - 60_000 }] : [],
      ),
  ),
  touchMember: vi.fn(async () => true),
  lastGameOf: vi.fn(async () => db.lastGame),
  lastFinishedGame: vi.fn(async () => null),
  recountMemberGames: vi.fn(async () => {}),
}));

import { karachi } from '@society/engine';
import { POST } from './route';
import { HttpError } from '../../../../../lib/live/errors';
import * as events from '../../../../../lib/live/events';
import { STALE_GAME_MS } from '../../../../../lib/live/lifecycle';
import { policyFor } from '../../../../../lib/live/policy';
import * as store from '../../../../../lib/live/store';
import * as table from '../../../../../lib/live/table';
import type { LiveRow } from '../../../../../lib/live/store';

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
  db.live = null;
  db.user = 'u-abrar';
  db.members = null;
  db.lastGame = null;
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
    db.meta = {
      version: 40,
      table: { v: 1, scores: [0, 0, 0, 0], over, absence: EVERYONE_HERE, ready: null, extra: {} },
      legacy: false,
      actedAt: 0,
      updatedAt: 0,
      hand: 15,
      seq: 99,
    } satisfies LiveMeta;
    // The finish closes the room, which moves its updated_at: the deal is guarded by the room as the finish left it.
    db.after = { ...room, status: 'finished', updated_at: '2026-09-24T00:05:00Z' };
    const res = await start();
    expect(res.status).toBe(201);
    expect(store.finishGame).toHaveBeenCalledWith(GAME, room, over, expect.anything());
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

describe('POST /api/rooms/[code]/start, a room nobody is playing in', () => {
  it('ends a game nobody has played for hours as idle, then deals again in the room the finish left', async () => {
    const seats: RoomRow['seats'] = [room.seats[0], { kind: 'bot', name: 'Bilal' }, { kind: 'bot', name: 'Sana' }, { kind: 'bot', name: 'Omar' }];
    const stale = Date.now() - STALE_GAME_MS - 60_000;
    const first = table.dealFirstHand(karachi, seats, 'stale-1', policyFor(['new']), stale);
    db.room = { ...room, seats };
    db.game = game('active');
    db.meta = {
      version: 7,
      table: { v: 1, scores: [0, 0, 0, 0], over: null, absence: EVERYONE_HERE, ready: null, extra: {} },
      legacy: false,
      actedAt: stale,
      updatedAt: stale,
      hand: 0,
      seq: 1,
    } satisfies LiveMeta;
    db.live = {
      version: 7,
      state: first.state,
      deadlines: first.deadlines,
      table: { v: 1, scores: [0, 0, 0, 0], over: null, absence: EVERYONE_HERE, ready: null, extra: {} },
      legacy: false,
      wakeAt: null,
      actedAt: stale,
      updatedAt: stale,
    } satisfies LiveRow;
    // The finish closes the room.
    vi.mocked(store.finishGame).mockImplementationOnce(async () => {
      db.after = { ...room, seats, status: 'finished', updated_at: '2026-09-24T06:00:00Z' };
    });
    const res = await start();
    expect(res.status).toBe(201);
    const [, expected, w] = vi.mocked(store.commitTable).mock.calls[0]!;
    expect(expected).toBe(7);
    expect(w.table.over).toMatchObject({ how: 'idle', by: null });
    expect(w.acted).toBe(false);
    const order = [store.commitTable, store.finishGame, store.startGame].map((fn) => vi.mocked(fn).mock.invocationCallOrder[0]!);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(vi.mocked(store.startGame).mock.calls[0]![0]).toMatchObject({ status: 'finished', updated_at: '2026-09-24T06:00:00Z' });
  });

  it('leaves a game someone played within the hours alone, and refuses to deal over it', async () => {
    db.room = room;
    db.game = game('active');
    db.meta = {
      version: 7,
      table: { v: 1, scores: [0, 0, 0, 0], over: null, absence: EVERYONE_HERE, ready: null, extra: {} },
      legacy: false,
      actedAt: Date.now() - 60_000,
      updatedAt: 0,
      hand: 0,
      seq: 1,
    } satisfies LiveMeta;
    const res = await start();
    expect(res.status).toBe(409);
    expect(store.loadLive).not.toHaveBeenCalled();
    expect(store.commitTable).not.toHaveBeenCalled();
  });
});

describe('POST /api/rooms/[code]/start, who may', () => {
  const bilal = { kind: 'human', userId: 'u-bilal', name: 'Bilal' } as const;
  const sana = { kind: 'human', userId: 'u-sana', name: 'Sana' } as const;

  it('lets whoever has sat longest start once the host has stood up', async () => {
    db.room = { ...room, status: 'finished', seats: [{ ...sana, since: '2026-09-24T19:05:00Z' }, { ...bilal, since: '2026-09-24T19:00:00Z' }, null, null] };
    db.game = game('finished');
    db.user = 'u-bilal';
    expect((await start()).status).toBe(201);
    expect(store.startGame).toHaveBeenCalledTimes(1);
  });

  it('refuses everyone else: someone seated without the powers, and the room’s host while not seated', async () => {
    db.room = { ...room, status: 'finished', seats: [{ ...sana, since: '2026-09-24T19:05:00Z' }, { ...bilal, since: '2026-09-24T19:00:00Z' }, null, null] };
    db.game = game('finished');
    for (const who of ['u-sana', 'u-abrar', 'u-zed']) {
      db.user = who;
      const res = await start();
      expect(res.status, who).toBe(403);
      expect(await res.json()).toEqual({ error: 'only the host can start' });
    }
    expect(store.startGame).not.toHaveBeenCalled();
  });

  it('still lets the room’s host start while seated, whoever has sat longer', async () => {
    db.room = {
      ...room,
      status: 'lobby',
      seats: [{ ...bilal, since: '2026-09-24T19:00:00Z' }, { ...room.seats[0]!, since: '2026-09-24T19:30:00Z' } as RoomRow['seats'][number], null, null],
    };
    db.game = null;
    expect((await start()).status).toBe(201);
    db.user = 'u-bilal';
    expect((await start()).status).toBe(403);
  });
});

describe('POST /api/rooms/[code]/start, who’s here', () => {
  const HOUR = 60 * 60 * 1000;
  const bilal = { kind: 'human', userId: 'u-bilal', name: 'Bilal', since: '2026-09-21T19:05:00Z' } as const;
  const hana = { kind: 'human', userId: 'u-hana', name: 'Hana', since: '2026-09-21T19:10:00Z' } as const;
  const finished = (): RoomRow => ({ ...room, status: 'finished', seats: [{ ...room.seats[0]!, since: '2026-09-21T19:00:00Z' } as RoomRow['seats'][number], bilal, hana, null] });

  it('passes the host’s powers to whoever here has sat longest while the room’s host hasn’t opened the link tonight', async () => {
    db.room = finished();
    db.game = game('finished');
    db.members = [
      { userId: 'u-abrar', lastSeenAt: Date.now() - 7 * 24 * HOUR },
      { userId: 'u-bilal', lastSeenAt: Date.now() - HOUR },
      { userId: 'u-hana', lastSeenAt: Date.now() - HOUR },
    ];
    // Bilal has sat longer than Hana, and both are here: Bilal has the powers.
    db.user = 'u-hana';
    const res = await start();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'only the host can start' });
    db.user = 'u-bilal';
    expect((await start()).status).toBe(201);
    // Tapping Start is being here, so the room's host, checked in by it, has their powers back.
    db.user = 'u-abrar';
    expect((await start()).status).toBe(201);
  });

  it('checks the starter in, and counts them here even when that check-in doesn’t land', async () => {
    db.room = finished();
    db.game = game('finished');
    // The host's lobby has been open for hours: last seen long ago, and the check-in fails.
    db.members = [
      { userId: 'u-abrar', lastSeenAt: Date.now() - 9 * HOUR },
      { userId: 'u-hana', lastSeenAt: Date.now() - HOUR },
    ];
    vi.mocked(store.touchMember).mockResolvedValueOnce(false);
    expect((await start()).status).toBe(201);
    expect(store.touchMember).toHaveBeenCalledWith('r-1', 'u-abrar', expect.any(Number));
  });

  it('judges who’s here against the end of the room’s last game', async () => {
    db.room = finished();
    db.game = game('finished');
    const endedAt = Date.now() - HOUR;
    db.lastGame = { status: 'finished', endedAt, how: 'complete', hands: 16, players: [] };
    // Bilal, who has sat longer, was last seen before the game ended (a bot was playing for him at the end): not here, so the
    // powers are Hana's, who was at the table at the end.
    db.members = [
      { userId: 'u-bilal', lastSeenAt: endedAt - 60_000 },
      { userId: 'u-hana', lastSeenAt: endedAt },
    ];
    db.user = 'u-hana';
    expect((await start()).status).toBe(201);
    expect(store.lastGameOf).toHaveBeenCalledWith(GAME);
    // Seen since the end, he's here, and they're his.
    db.members = [
      { userId: 'u-bilal', lastSeenAt: endedAt + 60_000 },
      { userId: 'u-hana', lastSeenAt: endedAt },
    ];
    expect((await start()).status).toBe(403);
  });

  it('deals nobody out on a guess: when who’s here can’t be read, the start fails and can be tried again', async () => {
    db.room = finished();
    db.game = game('finished');
    vi.mocked(store.roomMembers).mockRejectedValueOnce(new Error('fetch failed'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await start()).status).toBe(500);
    expect(store.startGame).not.toHaveBeenCalled();
  });

  it('checks nobody in, and reads nobody, for a room whose game is in play or for someone not seated', async () => {
    db.room = room;
    db.game = game('active');
    expect((await start()).status).toBe(409);
    db.room = finished();
    db.game = game('finished');
    db.user = 'u-zed';
    expect((await start()).status).toBe(403);
    expect(store.touchMember).not.toHaveBeenCalled();
    expect(store.roomMembers).not.toHaveBeenCalled();
  });
});

describe('POST /api/rooms/[code]/start, counted for the funnel', () => {
  const hana = { kind: 'human', userId: 'u-hana', name: 'Hana' } as const;

  it('counts the deal once the room points at it: who dealt, who sat down to it, how new they are, and that the room had dealt before', async () => {
    db.room = { ...room, status: 'finished', seats: [room.seats[0], null, hana, null] };
    db.game = game('finished');
    vi.mocked(store.seatStages).mockResolvedValueOnce({ levels: ['solid', null, 'learning', null], read: true });
    expect((await start()).status).toBe(201);
    expect(events.recordEvent).toHaveBeenCalledTimes(1);
    expect(events.recordEvent).toHaveBeenCalledWith({
      type: 'game_dealt',
      roomId: 'r-1',
      gameId: NEXT,
      userId: 'u-abrar',
      data: { humans: 2, bots: 2, again: true, levels: { new: 0, first_hand: 0, learning: 1, solid: 1 } },
    });
    const order = [store.startGame, events.recordEvent].map((fn) => vi.mocked(fn).mock.invocationCallOrder[0]!);
    expect(order[0]).toBeLessThan(order[1]!);
  });

  it('says the levels are unknown when they couldn’t be read, rather than counting everyone as new', async () => {
    db.room = { ...room, status: 'finished', seats: [room.seats[0], null, hana, null] };
    db.game = game('finished');
    // The read failed: the table is dealt with everyone as new (the most patient clocks), but the count doesn't say they are.
    vi.mocked(store.seatStages).mockResolvedValueOnce({ levels: ['new', null, 'new', null], read: false });
    expect((await start()).status).toBe(201);
    expect(vi.mocked(table.dealFirstHand).mock.calls[0]![3]).toEqual(policyFor(['new', 'new']));
    expect(events.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'game_dealt', data: { humans: 2, bots: 2, again: true, levels: null } }));
  });

  it('counts a room’s first deal as not again', async () => {
    db.room = { ...room, status: 'lobby', current_game_id: null };
    db.game = null;
    expect((await start()).status).toBe(201);
    expect(events.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'game_dealt', data: expect.objectContaining({ humans: 1, bots: 3, again: false }) }));
  });

  it('counts nothing for a deal that lost to a seat change, or one refused before it began', async () => {
    db.room = { ...room, status: 'finished' };
    db.game = game('finished');
    vi.mocked(store.startGame).mockRejectedValueOnce(new HttpError(409, 'the seats changed; start again'));
    expect((await start()).status).toBe(409);
    db.user = 'u-zed';
    expect((await start()).status).toBe(403);
    expect(events.recordEvent).not.toHaveBeenCalled();
  });
});
