import 'server-only';
// Relative rather than '@/': vitest runs without the path alias, and the tests load this.
import { createClient } from '../supabase/server';
import { SupabaseError } from './errors';
import { cleanDisplayName } from './validate';

export interface Caller {
  readonly id: string;
  readonly name: string;
  readonly isGuest: boolean;
}

/**
 * The signed-in user (guests included) from the request's cookies, or null.
 * The name is the user's own metadata, which they can set to anything, so it
 * is cleaned and capped here, before any room or seat sees it.
 *
 * No session, or one Supabase turns down, is null (the route says "sign in
 * first"). Auth that could not be reached or failed on its side throws, so
 * the route answers 500: a blip must not tell a seated player they are a
 * stranger.
 */
export async function currentUser(): Promise<Caller | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error && authUnavailable(error)) throw new SupabaseError('check who is signed in', error);
  if (error || !data.user) return null;
  const u = data.user;
  const meta = (u.user_metadata ?? {}) as { display_name?: unknown };
  return { id: u.id, name: cleanDisplayName(meta.display_name) ?? 'Guest', isGuest: !!u.is_anonymous };
}

/**
 * Whether a failed getUser means Auth could not answer, rather than that the
 * caller has no good session. supabase-js names a network failure or a 5xx
 * AuthRetryableFetchError and a garbled reply AuthUnknownError; any other
 * 5xx is Auth's own failure too. Everything else (no session, an expired or
 * forged token, a deleted user) is a 4xx and means "not signed in".
 */
export function authUnavailable(error: { readonly name?: string; readonly status?: number | undefined }): boolean {
  if (error.name === 'AuthRetryableFetchError' || error.name === 'AuthUnknownError') return true;
  return typeof error.status === 'number' && error.status >= 500;
}
