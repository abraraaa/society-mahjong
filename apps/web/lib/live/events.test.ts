import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The funnel's moments against a fake Supabase client: one app_events row
 * per moment, and a write that fails is only ever a log line, never a failed
 * request.
 */
const supabase = vi.hoisted(() => ({
  inserts: [] as { table: string; row: unknown }[],
  answer: (): { error: { message: string; code?: string } | null } => ({ error: null }),
  settings: true,
}));

vi.mock('server-only', () => ({}));
vi.mock('../supabase/service', () => ({
  createServiceClient: () => {
    if (!supabase.settings) throw new Error('Supabase URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) must be set');
    return {
      from: (table: string) => ({
        insert: async (row: unknown) => {
          supabase.inserts.push({ table, row });
          return { data: null, ...supabase.answer() };
        },
      }),
    };
  },
}));

import { EVENT_TYPES, gameDealt, gameEnded, recordEvent } from './events';
import type { GameOver } from './table-state';
import type { Seats } from './types';

const ROOM = '3b9d2f6e-1a4c-4e8b-9d7f-5c2a0e6b8f13';
const GAME = '6f1c2a9e-4b7d-4e3a-9c5f-2d8b0a7e1f34';

/** Every JSON line written to console.error so far. */
function logged(log: { mock: { calls: unknown[][] } }): Record<string, unknown>[] {
  return log.mock.calls.map(([line]) => JSON.parse(line as string) as Record<string, unknown>);
}

beforeEach(() => {
  supabase.inserts = [];
  supabase.answer = () => ({ error: null });
  supabase.settings = true;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('recordEvent', () => {
  it('writes one app_events row: the type, the ids and the data', async () => {
    await recordEvent({ type: 'game_dealt', roomId: ROOM, gameId: GAME, userId: 'u-abrar', data: { humans: 2, bots: 2 } });
    expect(supabase.inserts).toEqual([{ table: 'app_events', row: { type: 'game_dealt', room_id: ROOM, game_id: GAME, user_id: 'u-abrar', data: { humans: 2, bots: 2 } } }]);
  });

  it('leaves what a moment has no part in empty: no ids, and data as {}', async () => {
    await recordEvent({ type: 'room_made' });
    await recordEvent({ type: 'game_finished', roomId: ROOM, gameId: GAME, userId: null, data: { how: 'idle' } });
    expect(supabase.inserts.map((i) => i.row)).toEqual([
      { type: 'room_made', room_id: null, game_id: null, user_id: null, data: {} },
      { type: 'game_finished', room_id: ROOM, game_id: GAME, user_id: null, data: { how: 'idle' } },
    ]);
  });

  it('logs a refused write as event_write_failed, with which moment and where but never who, and does not throw', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    supabase.answer = () => ({ error: { message: 'permission denied for table app_events', code: '42501' } });
    await expect(recordEvent({ type: 'seat_taken', roomId: ROOM, userId: 'u-zara', data: { how: 'join' } })).resolves.toBeUndefined();
    expect(logged(log)).toEqual([
      expect.objectContaining({
        level: 'error',
        event: 'event_write_failed',
        type: 'seat_taken',
        roomId: ROOM,
        name: 'SupabaseError',
        code: '42501',
        message: 'could not count the moment: permission denied for table app_events',
      }),
    ]);
    expect(log.mock.calls[0]![0]).not.toContain('u-zara');
  });

  it('logs, and does not throw, when the database cannot even be asked', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    supabase.settings = false;
    await expect(recordEvent({ type: 'room_made', roomId: ROOM, userId: 'u-abrar' })).resolves.toBeUndefined();
    supabase.settings = true;
    supabase.answer = () => {
      throw new TypeError('fetch failed');
    };
    await expect(recordEvent({ type: 'game_abandoned', roomId: ROOM, gameId: GAME, userId: 'u-abrar' })).resolves.toBeUndefined();
    expect(logged(log)).toEqual([
      expect.objectContaining({ event: 'event_write_failed', type: 'room_made', roomId: ROOM, name: 'Error' }),
      expect.objectContaining({ event: 'event_write_failed', type: 'game_abandoned', gameId: GAME, name: 'TypeError', message: 'fetch failed' }),
    ]);
  });

  it('knows the five moments the funnel counts', () => {
    expect(EVENT_TYPES).toEqual(['room_made', 'seat_taken', 'game_dealt', 'game_finished', 'game_abandoned']);
  });
});

describe('gameDealt', () => {
  const seats: Seats = [
    { kind: 'human', userId: 'u-abrar', name: 'Abrar' },
    { kind: 'bot', name: 'Bilal' },
    { kind: 'human', userId: 'u-hana', name: 'Hana' },
    { kind: 'human', userId: 'u-zara', name: 'Zara' },
  ];

  it('counts who sat down to the deal, how far along the people are, and whether the room had dealt before', () => {
    expect(gameDealt({ roomId: ROOM, gameId: GAME, userId: 'u-abrar', seats, levels: ['solid', null, 'first_hand', 'solid'], again: true })).toEqual({
      type: 'game_dealt',
      roomId: ROOM,
      gameId: GAME,
      userId: 'u-abrar',
      data: { humans: 3, bots: 1, again: true, levels: { new: 0, first_hand: 1, learning: 0, solid: 2 } },
    });
  });

  it('counts a person whose level is unknown as new, and never counts a bot', () => {
    const alone: Seats = [seats[0], seats[1], { kind: 'bot', name: 'Sana' }, { kind: 'bot', name: 'Omar' }];
    const e = gameDealt({ roomId: ROOM, gameId: GAME, userId: 'u-abrar', seats: alone, levels: [null, 'solid', null, null], again: false });
    expect(e.data).toEqual({ humans: 1, bots: 3, again: false, levels: { new: 1, first_hand: 0, learning: 0, solid: 0 } });
  });

  it('says the levels are unknown when they couldn’t be read, still counting the people and the bots', () => {
    const e = gameDealt({ roomId: ROOM, gameId: GAME, userId: 'u-abrar', seats, levels: null, again: true });
    expect(e.data).toEqual({ humans: 3, bots: 1, again: true, levels: null });
  });
});

describe('gameEnded', () => {
  const seats: Seats = [
    { kind: 'human', userId: 'u-abrar', name: 'Abrar' },
    { kind: 'human', userId: 'u-hana', name: 'Hana' },
    { kind: 'bot', name: 'Sana' },
    { kind: 'bot', name: 'Omar' },
  ];
  const over = (o: Partial<GameOver>): GameOver => ({ how: 'complete', by: null, at: 1, hands: 16, scores: [0, 0, 0, 0], seats, ...o });

  it('counts a game played out, by nobody, with its hands and the people at the table at the end', () => {
    expect(gameEnded({ roomId: ROOM, gameId: GAME, over: over({}), leaver: 'u-abrar' })).toEqual({
      type: 'game_finished',
      roomId: ROOM,
      gameId: GAME,
      userId: null,
      data: { how: 'complete', hands: 16, humans: 2 },
    });
  });

  it('counts a host’s end by the host, and an idle end by nobody', () => {
    const host = gameEnded({ roomId: ROOM, gameId: GAME, over: over({ how: 'host', by: { userId: 'u-hana', name: 'Hana' }, hands: 5 }), leaver: 'u-hana' });
    expect(host).toMatchObject({ type: 'game_finished', userId: 'u-hana', data: { how: 'host', hands: 5, humans: 2 } });
    const idle = gameEnded({ roomId: ROOM, gameId: GAME, over: over({ how: 'idle', hands: 3 }), leaver: null });
    expect(idle).toMatchObject({ type: 'game_finished', userId: null, data: { how: 'idle', hands: 3, humans: 2 } });
  });

  it('counts an abandon by the last person to leave, with how many hands finished and nothing more', () => {
    expect(gameEnded({ roomId: ROOM, gameId: GAME, over: over({ how: 'abandoned', hands: 2 }), leaver: 'u-abrar' })).toEqual({
      type: 'game_abandoned',
      roomId: ROOM,
      gameId: GAME,
      userId: 'u-abrar',
      data: { hands: 2 },
    });
  });
});
