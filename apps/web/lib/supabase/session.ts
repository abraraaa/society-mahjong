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

/** Thrown when there is no session and creating one needs a captcha token we do not have. */
export class NeedsCaptcha extends Error {
  constructor() {
    super('a captcha is needed to sign in');
    this.name = 'NeedsCaptcha';
  }
}

/**
 * The front door is the invite link, and the only thing it asks for is a name.
 * A visitor with no session becomes an anonymous Supabase user bound to this
 * device; adding an email later links in place and keeps their seat history.
 *
 * Creating that user is the one bot-protected call, so it needs a captcha
 * token from the name gate. A returning visitor with a live session needs
 * nothing; one whose session has gone gets `NeedsCaptcha`, and the page shows
 * the gate again.
 */
export async function ensureSession(name: string, captchaToken?: string | null): Promise<{ supabase: SupabaseClient; userId: string }> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    const current = (data.session.user.user_metadata as { display_name?: string })?.display_name;
    if (name && current !== name) await supabase.auth.updateUser({ data: { display_name: name } });
    return { supabase, userId: data.session.user.id };
  }
  if (!captchaToken) throw new NeedsCaptcha();
  const { data: anon, error } = await supabase.auth.signInAnonymously({ options: { data: { display_name: name }, captchaToken } });
  if (error || !anon.user) throw error ?? new Error('could not sign in');
  return { supabase, userId: anon.user.id };
}
