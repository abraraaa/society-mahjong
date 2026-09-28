import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * The host's "End the game": the route signs the caller in and hands the game
 * and the caller to the service, which decides everything else (endGame).
 */
const auth = vi.hoisted(() => ({ user: { id: 'u-abrar', name: 'Abrar', isGuest: true } as { id: string; name: string; isGuest: boolean } | null }));

vi.mock('server-only', () => ({}));
vi.mock('../../../../../lib/live/auth', () => ({ currentUser: vi.fn(async () => auth.user) }));
vi.mock('../../../../../lib/live/service', async () => {
  const { HttpError } = await import('../../../../../lib/live/errors');
  return { HttpError, endGame: vi.fn(async (id: string) => ({ gameId: id, status: 'finished' })) };
});

import { POST } from './route';
import { HttpError } from '../../../../../lib/live/errors';
import * as service from '../../../../../lib/live/service';

const GAME = '6f1c2a9e-4b7d-4e3a-9c5f-2d8b0a7e1f34';

function end(): Promise<Response> {
  const req = new Request(`https://societymahjong.app/api/games/${GAME}/end`, { method: 'POST' }) as unknown as NextRequest;
  return POST(req, { params: Promise.resolve({ id: GAME }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = { id: 'u-abrar', name: 'Abrar', isGuest: true };
});

describe('POST /api/games/[id]/end', () => {
  it('asks someone with no session to sign in, and ends nothing', async () => {
    auth.user = null;
    const res = await end();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'sign in first' });
    expect(service.endGame).not.toHaveBeenCalled();
  });

  it('hands the game and the caller to the service, and gives back the table it returns', async () => {
    const res = await end();
    expect(res.status).toBe(200);
    expect(service.endGame).toHaveBeenCalledWith(GAME, 'u-abrar');
    expect(await res.json()).toEqual({ gameId: GAME, status: 'finished' });
  });

  it('passes the service’s refusal on, with the table when there is one', async () => {
    vi.mocked(service.endGame).mockRejectedValueOnce(new HttpError(403, 'only the host can end the game'));
    const res = await end();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'only the host can end the game' });

    vi.mocked(service.endGame).mockRejectedValueOnce(new HttpError(409, 'the table changed under you; try again', { version: 9 }));
    const again = await end();
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: 'the table changed under you; try again', snapshot: { version: 9 } });
  });
});
