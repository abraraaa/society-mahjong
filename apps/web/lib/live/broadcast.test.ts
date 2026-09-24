import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { broadcast, gamePoke } from './broadcast';

const KEY = 'service-role-key-for-tests';

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', KEY);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('broadcast', () => {
  it('posts the pokes to Realtime, private by default', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 202 }));
    vi.stubGlobal('fetch', fetch);
    await broadcast([gamePoke('g-1', 4)]);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://example.supabase.co/realtime/v1/api/broadcast');
    expect(JSON.parse(init.body as string)).toEqual({ messages: [{ topic: 'game:g-1', event: 'state', payload: { version: 4 }, private: true }] });
  });

  it('logs and carries on when Realtime refuses: the move it announces is already saved', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(broadcast([gamePoke('g-1', 4)])).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith('broadcast failed', 500, 'nope');
  });

  it('logs and carries on when Realtime cannot be reached at all, without logging the key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(broadcast([gamePoke('g-1', 4)])).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith('broadcast failed', 'fetch failed');
    expect(JSON.stringify(log.mock.calls)).not.toContain(KEY);
  });

  it('sends nothing when Supabase is not configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_URL', '');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await broadcast([gamePoke('g-1', 4)]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
