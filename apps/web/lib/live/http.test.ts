import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { HttpError, SupabaseError } from './errors';
import { errorResponse } from './http';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('errorResponse', () => {
  it('answers an HttpError with its own status and message, and the snapshot when it carries one', async () => {
    const plain = errorResponse(new HttpError(404, 'no room with that code'));
    expect(plain.status).toBe(404);
    expect(await plain.json()).toEqual({ error: 'no room with that code' });

    const behind = errorResponse(new HttpError(409, 'stale version', { version: 7 }));
    expect(behind.status).toBe(409);
    expect(await behind.json()).toEqual({ error: 'stale version', snapshot: { version: 7 } });
  });

  it('turns a database failure into a 500 with a generic message, and keeps the detail in the log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new SupabaseError('read the room', { message: 'relation "public.rooms" does not exist', code: '42P01' });
    const res = errorResponse(failure);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'something went wrong' });
    expect(JSON.stringify(body)).not.toContain('rooms');
    expect(log).toHaveBeenCalledWith(failure);
  });

  it('turns anything else thrown into the same 500, whatever shape it has', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const thrown of [new Error('boom'), { message: 'a raw PostgREST error object', code: 'PGRST116' }, 'a string', undefined]) {
      const res = errorResponse(thrown);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'something went wrong' });
    }
  });
});
