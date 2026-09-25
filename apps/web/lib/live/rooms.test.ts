import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameRow, RoomRow } from './store';

/**
 * The room as the lobby and the start button see it. A room whose row still
 * says "playing" after its game has ended (a finish that failed part way,
 * before the room was written first) must read as finished: otherwise the
 * lobby sends everyone back to the final table and the host can never deal
 * again.
 */
const db = vi.hoisted(() => ({ room: null as unknown, game: null as unknown }));

vi.mock('server-only', () => ({}));
vi.mock('./store', () => ({
  roomByCode: vi.fn(async () => db.room),
  gameById: vi.fn(async () => db.game),
  saveSeats: vi.fn(async () => '2026-09-24T00:00:01Z'),
}));

import { ROOM_OPEN_MS } from '../front-door';
import { HttpError, SupabaseError } from './errors';
import { joinRoom, requireRoom } from './rooms';
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

describe('a finished room, a week on', () => {
  // The front door's rule (isClosedRoom in lib/front-door.ts) is the join's too, so the two can't drift apart.
  const finished = (ageMs: number): RoomRow => ({ ...room, status: 'finished', updated_at: new Date(Date.now() - ageMs).toISOString() });
  const MINUTE = 60_000;

  it('turns a newcomer away once the week is up', async () => {
    const err = await joinRoom(finished(ROOM_OPEN_MS + MINUTE), 'u-sana', 'Sana').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 410, message: 'this table has closed' });
    expect(store.saveSeats).not.toHaveBeenCalled();
  });

  it('still seats a newcomer within the week', async () => {
    const { room: after, seated } = await joinRoom(finished(ROOM_OPEN_MS - MINUTE), 'u-sana', 'Sana');
    expect(seated).toBe(true);
    expect(after.seats[1]).toEqual({ kind: 'human', userId: 'u-sana', name: 'Sana' });
  });

  it('lets its own people back in after the week', async () => {
    const { seated } = await joinRoom(finished(30 * ROOM_OPEN_MS), 'u-abrar', 'Abrar');
    expect(seated).toBe(false);
  });
});
