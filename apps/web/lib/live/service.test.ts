import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analysisBot, karachi, viewFor } from '@society/engine';
import type { GameRow, LiveRow, RoomRow } from './store';
import { dealFirstHand } from './table';
import type { ClientAction, Seats } from './types';
import { policyFor } from './policy';

/**
 * actOnGame against an in-memory store: who may tick a table (resolve its
 * expired clocks and read it back) and who may act at it. The store and the
 * broadcaster are the only things faked; the table itself is the real one.
 */
const db = vi.hoisted(() => ({
  game: null as unknown,
  room: null as unknown,
  live: null as unknown,
}));

vi.mock('server-only', () => ({}));
vi.mock('./store', () => ({
  gameById: vi.fn(async () => db.game),
  roomById: vi.fn(async () => db.room),
  loadLive: vi.fn(async () => db.live),
  saveLive: vi.fn(async () => true),
  stagesFor: vi.fn(async () => ['new']),
  appendAction: vi.fn(async () => {}),
  openHand: vi.fn(async () => {}),
  closeHand: vi.fn(async () => [0, 0, 0, 0]),
  finishGame: vi.fn(async () => {}),
  abandonGame: vi.fn(async () => {}),
  saveSeats: vi.fn(async () => null),
  roomByCode: vi.fn(async () => null),
}));
vi.mock('./broadcast', () => ({
  broadcast: vi.fn(async () => {}),
  gamePoke: vi.fn(() => ({ topic: 't', event: 'e', payload: {} })),
  roomPoke: vi.fn(() => ({ topic: 't', event: 'e', payload: {} })),
}));

import { HttpError, actOnGame } from './service';
import { SupabaseError } from './errors';
import * as broadcaster from './broadcast';
import * as store from './store';

const T0 = 1_700_000_000_000;
const policy = policyFor(['new']);

/** Abrar is seated; Hana hosts but has stood up (a bot has her old seat); Zed has only the game id. */
const seats: Seats = [
  { kind: 'human', userId: 'u-abrar', name: 'Abrar' },
  { kind: 'bot', name: 'Bilal' },
  { kind: 'bot', name: 'Sana' },
  { kind: 'bot', name: 'Ayesha' },
];

function setTable(): LiveRow {
  const first = dealFirstHand(karachi, seats, 'svc-1', policy, T0);
  const live: LiveRow = { version: 3, state: first.state, deadlines: first.deadlines };
  db.game = { id: 'g-1', room_id: 'r-1', seed: 'svc-1', status: 'active', hands_played: 0 } satisfies GameRow;
  db.room = {
    id: 'r-1',
    code: 'ABCD',
    host_id: 'u-hana',
    ruleset_id: 'karachi',
    options: {},
    status: 'playing',
    seats,
    current_game_id: 'g-1',
    ledger: [0, 0, 0, 0],
    updated_at: '2026-09-24T00:00:00Z',
  } satisfies RoomRow;
  db.live = live;
  return live;
}

/** A moment after whatever clock the table is running has run out. */
function expired(live: LiveRow): number {
  return (live.deadlines.turn ?? live.deadlines.claim)! + 1;
}

async function rejection(p: Promise<unknown>): Promise<HttpError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HttpError);
  return err as HttpError;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ticking a table', () => {
  it('refuses a stranger with the game id: no clock resolves and no table comes back', async () => {
    const live = setTable();
    const err = await rejection(actOnGame('g-1', 'u-zed', null, null, expired(live)));
    expect(err.status).toBe(403);
    expect(err.body).toBeUndefined();
    expect(store.loadLive).not.toHaveBeenCalled();
    expect(store.saveLive).not.toHaveBeenCalled();
  });

  it('lets a seated player resolve an expired clock and see their own hand', async () => {
    const live = setTable();
    const snap = await actOnGame('g-1', 'u-abrar', null, null, expired(live));
    expect(store.saveLive).toHaveBeenCalledTimes(1);
    expect(snap.version).toBe(live.version + 1);
    expect(snap.me).toBe(0);
    expect(snap.view.seq).toBeGreaterThan(live.state.seq);
  });

  it('lets the host tick without a seat, and shows them only the public table', async () => {
    const live = setTable();
    const snap = await actOnGame('g-1', 'u-hana', null, null, expired(live));
    expect(store.saveLive).toHaveBeenCalledTimes(1);
    expect(snap.me).toBeNull();
    expect(snap.isHost).toBe(true);
    expect('me' in snap.view).toBe(false);
  });

  it('still lets the server itself sweep a table with nobody signed in', async () => {
    const live = setTable();
    const snap = await actOnGame('g-1', null, null, null, expired(live));
    expect(store.saveLive).toHaveBeenCalledTimes(1);
    expect(snap.me).toBeNull();
  });

  it('writes nothing when a seated player ticks before any clock has run out', async () => {
    const live = setTable();
    const snap = await actOnGame('g-1', 'u-abrar', null, null, T0 + 1000);
    expect(store.saveLive).not.toHaveBeenCalled();
    expect(snap.version).toBe(live.version);
  });
});

describe('acting at a table', () => {
  it('needs a seat: a stranger and a seatless host are both refused', async () => {
    setTable();
    const pass: ClientAction = { type: 'pass', seat: 0 };
    for (const who of ['u-zed', 'u-hana']) {
      const err = await rejection(actOnGame('g-1', who, pass, 3, T0));
      expect(err.status).toBe(403);
    }
    expect(store.saveLive).not.toHaveBeenCalled();
  });

  it('refuses resolveClaims from a seated player, whatever seat it names', async () => {
    setTable();
    const forged = { type: 'resolveClaims', seat: 0 } as unknown as ClientAction;
    const err = await rejection(actOnGame('g-1', 'u-abrar', forged, 3, T0));
    expect(err.status).toBe(403);
    expect(store.saveLive).not.toHaveBeenCalled();
    expect(store.appendAction).not.toHaveBeenCalled();
  });
});

describe('when the database fails after the table has moved', () => {
  it('still tells the others the table moved, and gives the caller the failure', async () => {
    const live = setTable();
    const move = analysisBot(viewFor(live.state, karachi, 0), karachi) as ClientAction;
    vi.mocked(store.appendAction).mockRejectedValueOnce(new SupabaseError('log the move', { message: 'TypeError: fetch failed' }));
    await expect(actOnGame('g-1', 'u-abrar', move, live.version, T0 + 1000)).rejects.toBeInstanceOf(SupabaseError);
    expect(store.saveLive).toHaveBeenCalledTimes(1);
    expect(broadcaster.broadcast).toHaveBeenCalledTimes(1);
    expect(broadcaster.gamePoke).toHaveBeenCalledWith('g-1', live.version + 1, expect.anything());
  });

  it('fails outright, saving nothing, when the table cannot be read', async () => {
    setTable();
    vi.mocked(store.loadLive).mockRejectedValueOnce(new SupabaseError('read the table', { message: 'TypeError: fetch failed' }));
    await expect(actOnGame('g-1', 'u-abrar', null, null, T0)).rejects.toBeInstanceOf(SupabaseError);
    expect(store.saveLive).not.toHaveBeenCalled();
    expect(broadcaster.broadcast).not.toHaveBeenCalled();
  });
});
