import 'server-only';
import { createClient } from '@/lib/supabase/server';

export interface Caller {
  readonly id: string;
  readonly name: string;
  readonly isGuest: boolean;
}

/** The signed-in user (guests included) from the request's cookies, or null. */
export async function currentUser(): Promise<Caller | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const u = data.user;
  const meta = (u.user_metadata ?? {}) as { display_name?: string };
  return { id: u.id, name: meta.display_name?.trim() || 'Guest', isGuest: !!u.is_anonymous };
}
