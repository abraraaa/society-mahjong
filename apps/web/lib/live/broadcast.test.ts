import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { BROADCAST_TIMEOUT_MS, broadcast, gamePoke } from './broadcast';

const KEY = 'service-role-key-for-tests';

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', KEY);
});

afterEach(() => {
  vi.useRealTimers();
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

  it('gives up after 3 s when Realtime never answers, and logs it', async () => {
    vi.useFakeTimers();
    // Node's AbortSignal.timeout runs on its own timer, which fake timers cannot move, so stand in one that runs on setTimeout.
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const c = new AbortController();
      setTimeout(() => c.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError')), ms);
      return c.signal;
    });
    // A fetch that never settles unless its signal gives up, as a hung connection would.
    const fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal!.reason));
        }),
    );
    vi.stubGlobal('fetch', fetch);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    let done = false;
    const sent = broadcast([gamePoke('g-1', 4)]).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(BROADCAST_TIMEOUT_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await sent;
    expect(done).toBe(true);
    expect(BROADCAST_TIMEOUT_MS).toBe(3000);
    expect(timeout).toHaveBeenCalledWith(BROADCAST_TIMEOUT_MS);
    expect(log).toHaveBeenCalledWith('broadcast failed', 'The operation was aborted due to timeout');
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
