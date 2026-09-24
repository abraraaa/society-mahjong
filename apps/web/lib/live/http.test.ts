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
    const res = errorResponse(failure, '/api/rooms/[code]');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'something went wrong' });
    expect(JSON.stringify(body)).not.toContain('rooms');
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0]![0] as string)).toMatchObject({
      level: 'error',
      event: 'route_error',
      route: '/api/rooms/[code]',
      name: 'SupabaseError',
      message: 'could not read the room: relation "public.rooms" does not exist',
      code: '42P01',
    });
  });

  it('turns anything else thrown into the same 500, whatever shape it has, logging each once', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const thrown = [new Error('boom'), { message: 'a raw PostgREST error object', code: 'PGRST116' }, 'a string', undefined];
    for (const t of thrown) {
      const res = errorResponse(t);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'something went wrong' });
    }
    expect(log).toHaveBeenCalledTimes(thrown.length);
    for (const [line] of log.mock.calls) expect(JSON.parse(line as string)).toMatchObject({ level: 'error', event: 'route_error' });
  });

  it('does not log a refusal: a 4xx is the table working as meant', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const status of [400, 401, 403, 404, 409]) errorResponse(new HttpError(status, 'no'), '/api/games/[id]/act');
    expect(log).not.toHaveBeenCalled();
  });

  it('logs an HttpError of 500 or more, keeps its answer, and leaves its snapshot out of the log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = errorResponse(new HttpError(503, 'the table is resting', { view: { hand: ['secret-tile'] } }), '/api/games/[id]/tick');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'the table is resting', snapshot: { view: { hand: ['secret-tile'] } } });
    expect(log).toHaveBeenCalledTimes(1);
    const line = log.mock.calls[0]![0] as string;
    expect(JSON.parse(line)).toMatchObject({ event: 'route_error', route: '/api/games/[id]/tick', name: 'HttpError', status: 503 });
    expect(line).not.toContain('secret-tile');
  });
});
