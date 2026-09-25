import { describe, expect, it } from 'vitest';
import { HttpError, SupabaseError, must } from './errors';

/** What `fn` throws; fails the test if it returns. */
function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected a throw');
}

describe('must', () => {
  it('hands back the data when the call worked, including a read that found nothing', () => {
    expect(must({ data: { id: 'r-1' }, error: null }, 'read the room')).toEqual({ id: 'r-1' });
    expect(must({ data: null, error: null }, 'read the room')).toBeNull();
    expect(must({ data: [], error: null }, 'find tables past their clocks')).toEqual([]);
  });

  it('throws a SupabaseError, never an HttpError, when the call failed', () => {
    const failure = { message: 'permission denied for table rooms', code: '42501', details: '', hint: 'GRANT SELECT ON public.rooms TO service_role;' };
    const err = thrownBy(() => must({ data: null, error: failure }, 'read the room'));
    expect(err).toBeInstanceOf(SupabaseError);
    expect(err).not.toBeInstanceOf(HttpError);
    const e = err as SupabaseError;
    expect(e.message).toBe('could not read the room: permission denied for table rooms');
    expect(e.what).toBe('read the room');
    expect(e.code).toBe('42501');
    // The whole original error rides along for the log, hint and all.
    expect(e.cause).toBe(failure);
  });

  it('throws on a network failure too, which supabase-js reports with an empty code', () => {
    const failure = { message: 'TypeError: fetch failed', details: 'Caused by: ConnectTimeoutError', hint: '', code: '' };
    const err = thrownBy(() => must({ data: null, error: failure }, 'save the table'));
    expect(err).toBeInstanceOf(SupabaseError);
    expect((err as SupabaseError).message).toBe('could not save the table: TypeError: fetch failed');
    expect((err as SupabaseError).code).toBeUndefined();
  });
});
