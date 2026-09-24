import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, REQUEST_TIMEOUT_MS, api } from './client';
import { plainError } from './plain';

/** A fetch that never answers on its own, and gives up the way a browser does when its signal aborts. */
function hangingFetch() {
  return vi.fn((_path: string, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')));
    });
  });
}

/** A response whose headers arrive at once but whose body never finishes, until the signal aborts. */
function stalledBody(init?: RequestInit): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      init?.signal?.addEventListener('abort', () => controller.error(new DOMException('This operation was aborted', 'AbortError')));
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('api requests give up after about ten seconds', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('rejects a request with no answer as timed out, with no status, and aborts the fetch', async () => {
    const fetch = hangingFetch();
    vi.stubGlobal('fetch', fetch);
    const move = api.act('g', { type: 'pass', seat: 0 }, 3);
    const caught = move.catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
    expect(fetch.mock.calls[0]![1]!.signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const err = await caught;
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
    expect(fetch.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    // And the player reads a plain line, never the words 'timed out'.
    expect(plainError(err)).toBe("The table's taking too long to answer. Give it a moment, then try again if nothing's changed.");
  });

  it('treats a body cut off by the timeout as no answer, not as an empty snapshot', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_path: string, init?: RequestInit) => stalledBody(init)),
    );
    const caught = api.view('g').catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    const err = await caught;
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
  });

  it('leaves a prompt answer alone, and clears its timer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ version: 4 }), { status: 200 })),
    );
    await expect(api.view('g')).resolves.toEqual({ version: 4 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('still hands back a 409 with the table attached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'stale version', snapshot: { version: 5 } }), { status: 409 })),
    );
    const err = await api.act('g', { type: 'pass', seat: 0 }, 3).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).snapshot).toEqual({ version: 5 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('passes a network failure through as it was, for plainError to call it a connection problem', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Load failed');
      }),
    );
    const err = await api.view('g').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect(plainError(err)).toBe("We couldn't reach the table. Check your connection and try again.");
  });
});
