'use client';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from './client';

const NAME_KEY = 'sm:name';

export function storedName(): string | null {
  try {
    return localStorage.getItem(NAME_KEY);
  } catch {
    return null;
  }
}

export function rememberName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // private mode, or storage blocked: the name still goes to the server
  }
}

/**
 * The front door is the invite link, and the only thing it asks for is a name.
 * A visitor with no session becomes an anonymous Supabase user bound to this
 * device; adding an email later links in place and keeps their seat history.
 */
export async function ensureSession(name: string): Promise<{ supabase: SupabaseClient; userId: string }> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    const current = (data.session.user.user_metadata as { display_name?: string })?.display_name;
    if (name && current !== name) await supabase.auth.updateUser({ data: { display_name: name } });
    return { supabase, userId: data.session.user.id };
  }
  const { data: anon, error } = await supabase.auth.signInAnonymously({ options: { data: { display_name: name } } });
  if (error || !anon.user) throw error ?? new Error('could not sign in');
  return { supabase, userId: anon.user.id };
}
