import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The tutor's offer to just watch: the route signs the caller in, and the
 * store reads and writes their tally (watchOffer, answerWatchOffer). The body
 * must say yes or no; whether there's anything to answer is the store's call.
 */
const auth = vi.hoisted(() => ({ user: { id: 'u-abrar', name: 'Abrar', isGuest: true } as { id: string; name: string; isGuest: boolean } | null }));
const offer = vi.hoisted(() => ({ stage: 'solid' as string | null }));

vi.mock('server-only', () => ({}));
vi.mock('../../../../lib/live/auth', () => ({ currentUser: vi.fn(async () => auth.user) }));
vi.mock('../../../../lib/live/store', () => ({
  watchOffer: vi.fn(async () => ({ ask: true, wins: 3 })),
  answerWatchOffer: vi.fn(async () => offer.stage),
}));

import { GET, POST } from './route';
import * as store from '../../../../lib/live/store';

function answer(body?: string): Promise<Response> {
  return POST(new Request('https://societymahjong.app/api/me/tutor', { method: 'POST', ...(body === undefined ? {} : { body }) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = { id: 'u-abrar', name: 'Abrar', isGuest: true };
  offer.stage = 'solid';
});

describe('GET /api/me/tutor', () => {
  it('gives the signed-in player their offer', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ask: true, wins: 3 });
    expect(store.watchOffer).toHaveBeenCalledWith('u-abrar');
  });

  it('asks someone with no session to sign in, and reads nothing', async () => {
    auth.user = null;
    const res = await GET();
    expect(res.status).toBe(401);
    expect(store.watchOffer).not.toHaveBeenCalled();
  });
});

describe('POST /api/me/tutor', () => {
  it('records "just watch" and answers the level it makes', async () => {
    const res = await answer(JSON.stringify({ watch: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stage: 'solid' });
    expect(store.answerWatchOffer).toHaveBeenCalledWith('u-abrar', true);
  });

  it('records "keep helping"', async () => {
    offer.stage = 'learning';
    const res = await answer(JSON.stringify({ watch: false }));
    expect(await res.json()).toEqual({ stage: 'learning' });
    expect(store.answerWatchOffer).toHaveBeenCalledWith('u-abrar', false);
  });

  it('turns down a body that says neither, and writes nothing', async () => {
    for (const body of [undefined, 'not json', '{}', JSON.stringify({ watch: 'yes' })]) {
      const res = await answer(body);
      expect(res.status).toBe(400);
    }
    expect(store.answerWatchOffer).not.toHaveBeenCalled();
  });

  it('says so when there is no offer to answer', async () => {
    offer.stage = null;
    const res = await answer(JSON.stringify({ watch: true }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'nothing to answer' });
  });

  it('asks someone with no session to sign in, and writes nothing', async () => {
    auth.user = null;
    const res = await answer(JSON.stringify({ watch: true }));
    expect(res.status).toBe(401);
    expect(store.answerWatchOffer).not.toHaveBeenCalled();
  });
});
