import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * The host's "Let a bot play": the route signs the caller in and hands the
 * game, the caller and the body's seat and sawAt, unchecked, to the service,
 * which checks them and decides everything else (changeSeat).
 */
const auth = vi.hoisted(() => ({ user: { id: 'u-abrar', name: 'Abrar', isGuest: true } as { id: string; name: string; isGuest: boolean } | null }));

vi.mock('server-only', () => ({}));
vi.mock('../../../../../lib/live/auth', () => ({ currentUser: vi.fn(async () => auth.user) }));
vi.mock('../../../../../lib/live/service', async () => {
  const { HttpError } = await import('../../../../../lib/live/errors');
  return { HttpError, changeSeat: vi.fn(async (id: string) => ({ gameId: id, status: 'active' })) };
});

import { POST } from './route';
import { HttpError } from '../../../../../lib/live/errors';
import * as service from '../../../../../lib/live/service';

const GAME = '6f1c2a9e-4b7d-4e3a-9c5f-2d8b0a7e1f34';

function away(body?: string): Promise<Response> {
  const req = new Request(`https://societymahjong.app/api/games/${GAME}/away`, { method: 'POST', ...(body === undefined ? {} : { body }) }) as unknown as NextRequest;
  return POST(req, { params: Promise.resolve({ id: GAME }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = { id: 'u-abrar', name: 'Abrar', isGuest: true };
});

describe('POST /api/games/[id]/away', () => {
  it('asks someone with no session to sign in, and changes nothing', async () => {
    auth.user = null;
    const res = await away(JSON.stringify({ seat: 1, sawAt: 5 }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'sign in first' });
    expect(service.changeSeat).not.toHaveBeenCalled();
  });

  it('hands the seat and sawAt to the service as they came, and gives back the table', async () => {
    const res = await away(JSON.stringify({ seat: 1, sawAt: 1_700_000_000_000, extra: true }));
    expect(res.status).toBe(200);
    expect(service.changeSeat).toHaveBeenCalledWith(GAME, 'u-abrar', { type: 'letBotPlay', seat: 1, sawAt: 1_700_000_000_000 });
    expect(await res.json()).toEqual({ gameId: GAME, status: 'active' });
  });

  it('leaves checking a missing or broken body to the service', async () => {
    await away('not json');
    expect(service.changeSeat).toHaveBeenLastCalledWith(GAME, 'u-abrar', { type: 'letBotPlay', seat: undefined, sawAt: undefined });
    await away(JSON.stringify({ seat: 'one', sawAt: 'now' }));
    expect(service.changeSeat).toHaveBeenLastCalledWith(GAME, 'u-abrar', { type: 'letBotPlay', seat: 'one', sawAt: 'now' });
  });

  it('passes the service’s refusal on, with the table when there is one', async () => {
    vi.mocked(service.changeSeat).mockRejectedValueOnce(new HttpError(403, 'only the host can hand a seat to a bot'));
    const res = await away(JSON.stringify({ seat: 1, sawAt: 5 }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'only the host can hand a seat to a bot' });

    vi.mocked(service.changeSeat).mockRejectedValueOnce(new HttpError(409, 'that player has just played', { version: 9 }));
    const again = await away(JSON.stringify({ seat: 1, sawAt: 5 }));
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: 'that player has just played', snapshot: { version: 9 } });
  });
});
