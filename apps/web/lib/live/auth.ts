import 'server-only';
import { createClient } from '@/lib/supabase/server';
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
 */
export async function currentUser(): Promise<Caller | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const u = data.user;
  const meta = (u.user_metadata ?? {}) as { display_name?: unknown };
  return { id: u.id, name: cleanDisplayName(meta.display_name) ?? 'Guest', isGuest: !!u.is_anonymous };
}
