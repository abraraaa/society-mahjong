import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EVERYONE_HERE } from '../../../../../lib/live/absence';
import type { NextRequest } from 'next/server';
import type { GameRow, LiveMeta, RoomRow } from '../../../../../lib/live/store';
import type { GameOver } from '../../../../../lib/live/table-state';

/**
 * A room code is enough to sit down. A room whose game has ended, but whose
 * end isn't all recorded yet, is finished first, so the friend arriving after
 * the last hand finds it between games rather than "already started". A new
 * seat is one of the funnel's moments; coming back to one's own seat isn't.
 */
const db = vi.hoisted(() => ({ room: null as unknown, game: null as unknown, meta: null as unknown, after: null as unknown, members: [] as unknown[], lastGame: null as unknown }));

vi.mock('server-only', () => ({}));
vi.mock('../../../../../lib/live/auth', () => ({ currentUser: vi.fn(async () => ({ id: 'u-zara', name: 'Zara', isGuest: true })) }));
vi.mock('../../../../../lib/live/broadcast', () => ({
  broadcast: vi.fn(async () => {}),
  gamePoke: vi.fn(() => ({})),
  roomPoke: vi.fn(() => ({})),
}));
vi.mock('../../../../../lib/live/events', () => ({ recordEvent: vi.fn(async () => {}) }));
vi.mock('../../../../../lib/live/store', () => ({
  roomByCode: vi.fn(async () => db.room),
  roomById: vi.fn(async () => db.after ?? db.room),
  gameById: vi.fn(async () => db.game),
  liveMeta: vi.fn(async () => db.meta),
  finishGame: vi.fn(async () => {}),
  saveSeats: vi.fn(async () => '2026-09-24T00:06:00Z'),
  roomMembers: vi.fn(async () => db.members),
  touchMember: vi.fn(async () => true),
  lastGameOf: vi.fn(async () => db.lastGame),
  lastFinishedGame: vi.fn(async () => null),
  recountMemberGames: vi.fn(async () => {}),
}));

import { POST } from './route';
import * as events from '../../../../../lib/live/events';
import * as store from '../../../../../lib/live/store';
import { SEAT_ATTEMPTS } from '../../../../../lib/live/seating';

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
/** The table, last moved by a person a minute ago: a game in play, not one left for hours. */
const meta = (o: GameOver | null): LiveMeta => ({
  version: 40,
  table: { v: 1, scores: [9, -3, -3, -3], over: o, absence: EVERYONE_HERE, ready: null, extra: {} },
  legacy: false,
  actedAt: Date.now() - 60_000,
  updatedAt: Date.now() - 60_000,
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
  db.members = [];
  db.lastGame = null;
});

describe('POST /api/rooms/[code]/join', () => {
  it('finishes a game whose end is saved but not recorded, then seats the newcomer in the room it left', async () => {
    db.meta = meta(over);
    db.after = { ...room, status: 'finished', updated_at: CLOSED_AT };
    const res = await join();
    expect(res.status).toBe(200);
    expect(store.finishGame).toHaveBeenCalledWith(GAME, room, over, expect.anything());
    const order = [store.finishGame, store.saveSeats].map((fn) => vi.mocked(fn).mock.invocationCallOrder[0]!);
    expect(order[0]).toBeLessThan(order[1]!);
    // Seated in the room as the finish left it: a bot's seat, between games.
    expect(vi.mocked(store.saveSeats).mock.calls[0]![2]).toBe(CLOSED_AT);
    expect(await res.json()).toMatchObject({ status: 'finished', me: 1 });
    expect(events.recordEvent).toHaveBeenCalledTimes(1);
    expect(events.recordEvent).toHaveBeenCalledWith({ type: 'seat_taken', roomId: 'r-1', userId: 'u-zara', data: { how: 'join', status: 'finished' } });
  });

  it('offers a newcomer a bot’s seat at a game in play, with its points, writing nothing until they take it', async () => {
    db.meta = meta(null);
    const res = await join();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'playing', me: null, offer: { seat: 1, botName: 'Bilal', why: 'other', score: -3 } });
    expect(store.finishGame).not.toHaveBeenCalled();
    expect(store.saveSeats).not.toHaveBeenCalled();
    expect(store.touchMember).not.toHaveBeenCalled();
    expect(events.recordEvent).not.toHaveBeenCalled();
  });

  it('offers someone who left the seat a bot has kept for them first', async () => {
    db.meta = meta(null);
    db.room = { ...room, seats: [room.seats[0], room.seats[1], { kind: 'bot', name: 'Hamza', heldFor: 'u-zara', keptName: 'Zara', kept: 'left' }, room.seats[3]] };
    expect(await (await join()).json()).toMatchObject({ me: null, offer: { seat: 2, botName: 'Hamza', why: 'left', score: -3 } });
  });

  it('still turns a newcomer away from a game in play with no bot to take over from, without touching it', async () => {
    db.meta = meta(null);
    db.room = {
      ...room,
      seats: [room.seats[0], { kind: 'human', userId: 'u-b', name: 'B' }, { kind: 'human', userId: 'u-c', name: 'C' }, { kind: 'human', userId: 'u-d', name: 'D' }],
    };
    const res = await join();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'this table has already started' });
    expect(store.finishGame).not.toHaveBeenCalled();
    expect(store.saveSeats).not.toHaveBeenCalled();
    expect(events.recordEvent).not.toHaveBeenCalled();
  });

  it('asks nothing of the live table for a room between games whose game is recorded', async () => {
    db.room = { ...room, status: 'finished' };
    db.game = { ...active, status: 'finished' };
    const res = await join();
    expect(res.status).toBe(200);
    expect(store.liveMeta).not.toHaveBeenCalled();
    expect(store.finishGame).not.toHaveBeenCalled();
  });

  it('finishes a game whose finish closed the room but not the game, before seating anyone, so a seat it owes is given back first', async () => {
    // Bilal left as the last hand was scored and his seat went to a bot; the finish closed the room and failed to give it back.
    const bilal = { kind: 'human', userId: 'u-bilal', name: 'Bilal' } as const;
    const closed: RoomRow = { ...room, status: 'finished', seats: [room.seats[0], { kind: 'bot', name: 'Ayesha' }, room.seats[2], room.seats[3]] };
    db.room = closed;
    db.meta = meta({ ...over, seats: [room.seats[0], bilal, room.seats[2], room.seats[3]] });
    // Run again, the finish gives it back.
    db.after = { ...closed, seats: [room.seats[0], bilal, room.seats[2], room.seats[3]], updated_at: CLOSED_AT };
    const res = await join();
    expect(res.status).toBe(200);
    expect(store.finishGame).toHaveBeenCalledWith(GAME, closed, expect.objectContaining({ how: 'complete' }), expect.anything());
    // Zara takes the first bot's seat of the room as the finish left it: Sana's, not the one given back to Bilal.
    expect(vi.mocked(store.saveSeats).mock.calls[0]![2]).toBe(CLOSED_AT);
    expect(await res.json()).toMatchObject({ status: 'finished', me: 2 });
  });
});

describe('POST /api/rooms/[code]/join, counted for the funnel', () => {
  it('counts a seat taken before the first game, once the seat is saved', async () => {
    db.room = { ...room, status: 'lobby', current_game_id: null, seats: [room.seats[0], null, null, null] };
    expect((await join()).status).toBe(200);
    expect(events.recordEvent).toHaveBeenCalledWith({ type: 'seat_taken', roomId: 'r-1', userId: 'u-zara', data: { how: 'join', status: 'lobby' } });
    const order = [store.saveSeats, events.recordEvent].map((fn) => vi.mocked(fn).mock.invocationCallOrder[0]!);
    expect(order[0]).toBeLessThan(order[1]!);
  });

  it('counts a host who stood up in their own lobby and sat back down by the link, as funnel.sql query 9 says', async () => {
    // Zara made this room, so her first seat counted as room_made; she stood up, and the link seats her again.
    db.room = { ...room, host_id: 'u-zara', status: 'lobby', current_game_id: null, seats: [null, room.seats[0], null, null] };
    expect((await join()).status).toBe(200);
    expect(events.recordEvent).toHaveBeenCalledWith({ type: 'seat_taken', roomId: 'r-1', userId: 'u-zara', data: { how: 'join', status: 'lobby' } });
  });

  it('counts a seat that was someone’s who isn’t here as displaced, never the host’s', async () => {
    const full: RoomRow['seats'] = [
      room.seats[0],
      { kind: 'human', userId: 'u-b', name: 'B' },
      { kind: 'human', userId: 'u-c', name: 'C' },
      { kind: 'human', userId: 'u-d', name: 'D' },
    ];
    db.room = { ...room, status: 'lobby', current_game_id: null, seats: full };
    // C is here; B and D were last here a week ago, D before B. Abrar, the host, hasn't been seen at all.
    db.members = [
      { userId: 'u-c', lastSeenAt: Date.now() - 60_000 },
      { userId: 'u-b', lastSeenAt: Date.now() - 7 * 24 * 60 * 60_000 },
      { userId: 'u-d', lastSeenAt: Date.now() - 8 * 24 * 60 * 60_000 },
    ];
    const res = await join();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ me: 3 });
    expect(vi.mocked(store.saveSeats).mock.calls[0]![1][3]).toMatchObject({ kind: 'human', userId: 'u-zara' });
    expect(events.recordEvent).toHaveBeenCalledWith({ type: 'seat_taken', roomId: 'r-1', userId: 'u-zara', data: { how: 'displaced', status: 'lobby' } });
  });

  it('counts nothing for someone coming back to the seat they already have', async () => {
    db.room = { ...room, status: 'lobby', current_game_id: null, seats: [room.seats[0], { kind: 'human', userId: 'u-zara', name: 'Zara' }, null, null] };
    const res = await join();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ me: 1 });
    expect(store.saveSeats).not.toHaveBeenCalled();
    expect(events.recordEvent).not.toHaveBeenCalled();
  });

  it('counts nothing when the seat was never saved: a full table, or someone else sitting first every time', async () => {
    const full: RoomRow['seats'] = [
      room.seats[0],
      { kind: 'human', userId: 'u-b', name: 'B' },
      { kind: 'human', userId: 'u-c', name: 'C' },
      { kind: 'human', userId: 'u-d', name: 'D' },
    ];
    db.room = { ...room, status: 'lobby', current_game_id: null, seats: full };
    // Everyone's here, so nobody's seat can be given away.
    db.members = ['u-abrar', 'u-b', 'u-c', 'u-d'].map((userId) => ({ userId, lastSeenAt: Date.now() - 60_000 }));
    expect((await join()).status).toBe(409);
    db.members = [];
    db.room = { ...room, status: 'lobby', current_game_id: null, seats: [room.seats[0], null, null, null] };
    for (let i = 0; i < SEAT_ATTEMPTS; i++) vi.mocked(store.saveSeats).mockResolvedValueOnce(null);
    const lost = await join();
    expect(lost.status).toBe(409);
    expect(await lost.json()).toEqual({ error: 'that seat was just taken; try again' });
    expect(store.saveSeats).toHaveBeenCalledTimes(SEAT_ATTEMPTS);
    expect(events.recordEvent).not.toHaveBeenCalled();
  });
});

describe('POST /api/rooms/[code]/join, who’s here', () => {
  const lastGame = {
    status: 'finished',
    endedAt: Date.now() - 60 * 60_000,
    how: 'complete',
    hands: 16,
    players: [
      { seat: 0, userId: 'u-abrar', kind: 'human', name: 'Abrar', score: -3, place: 2 },
      { seat: 1, userId: 'u-zara', kind: 'human', name: 'Zara', score: 9, place: 1 },
      { seat: 2, userId: null, kind: 'bot', name: 'Sana', score: -3, place: 2 },
      { seat: 3, userId: null, kind: 'bot', name: 'Omar', score: -3, place: 2 },
    ],
  };

  it('answers with the room as the lobby shows it: who isn’t here yet, who has the powers, and the last game, with Zara checked in', async () => {
    const zara = { kind: 'human', userId: 'u-zara', name: 'Zara' } as const;
    db.room = { ...room, status: 'finished', seats: [room.seats[0], zara, room.seats[2], room.seats[3]] };
    db.game = { ...active, status: 'finished' };
    db.lastGame = lastGame;
    // Abrar hosts, but was last seen before that game ended.
    db.members = [{ userId: 'u-abrar', lastSeenAt: Date.now() - 2 * 60 * 60_000 }];
    const res = await join();
    expect(res.status).toBe(200);
    expect(store.touchMember).toHaveBeenCalledWith('r-1', 'u-zara', expect.any(Number));
    const snap = await res.json();
    expect(snap).toMatchObject({
      me: 1,
      isHost: true,
      hostSeat: 1,
      seats: [
        { kind: 'human', name: 'Abrar', notHere: true },
        { kind: 'human', name: 'Zara' },
        { kind: 'bot', name: 'Sana' },
        { kind: 'bot', name: 'Omar' },
      ],
      lastGame: { how: 'complete', hands: 16, me: 1 },
    });
    expect(JSON.stringify(snap)).not.toContain('u-');
    expect(store.saveSeats).not.toHaveBeenCalled();
  });
});
