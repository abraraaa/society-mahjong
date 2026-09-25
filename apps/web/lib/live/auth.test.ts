import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApiError, AuthInvalidJwtError, AuthRetryableFetchError, AuthSessionMissingError, AuthUnknownError } from '@supabase/supabase-js';

/** What the request's Supabase client says about the caller: set per test. */
const auth = vi.hoisted(() => ({ result: { data: { user: null as unknown }, error: null as unknown } }));

vi.mock('server-only', () => ({}));
vi.mock('../supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => auth.result } }),
}));

import { authUnavailable, currentUser } from './auth';
import { SupabaseError } from './errors';

beforeEach(() => {
  auth.result = { data: { user: null }, error: null };
});

describe('authUnavailable', () => {
  it('counts a network failure, a 5xx or a garbled reply as Auth not answering', () => {
    expect(authUnavailable(new AuthRetryableFetchError('fetch failed', 0))).toBe(true);
    expect(authUnavailable(new AuthRetryableFetchError('Service Unavailable', 503))).toBe(true);
    expect(authUnavailable(new AuthUnknownError('Unexpected token < in JSON', null))).toBe(true);
    expect(authUnavailable(new AuthApiError('internal error', 500, 'unexpected_failure'))).toBe(true);
  });

  it('counts no session, a bad token or a deleted user as simply not signed in', () => {
    expect(authUnavailable(new AuthSessionMissingError())).toBe(false);
    expect(authUnavailable(new AuthInvalidJwtError('invalid JWT'))).toBe(false);
    expect(authUnavailable(new AuthApiError('invalid JWT: token is expired', 403, 'bad_jwt'))).toBe(false);
    expect(authUnavailable(new AuthApiError('User from sub claim in JWT does not exist', 403, 'user_not_found'))).toBe(false);
  });
});

describe('currentUser', () => {
  it('is null for a visitor with no session, so the route can say "sign in first"', async () => {
    auth.result = { data: { user: null }, error: new AuthSessionMissingError() };
    expect(await currentUser()).toBeNull();
  });

  it('throws when Auth cannot be reached, rather than calling a seated player a stranger', async () => {
    auth.result = { data: { user: null }, error: new AuthRetryableFetchError('fetch failed', 0) };
    await expect(currentUser()).rejects.toBeInstanceOf(SupabaseError);
  });

  it('returns the guest with their name cleaned', async () => {
    auth.result = { data: { user: { id: 'u-1', is_anonymous: true, user_metadata: { display_name: '  Hana\u0007  ' } } }, error: null };
    expect(await currentUser()).toEqual({ id: 'u-1', name: 'Hana', isGuest: true });
  });
});
