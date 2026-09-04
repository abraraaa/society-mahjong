import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseServiceKey, supabaseUrl } from './env';

/**
 * The service-role client: bypasses RLS, so it exists only inside route
 * handlers and only after the caller's session has been checked. Never
 * import this from anything a browser bundle can reach.
 */
export function createServiceClient(): SupabaseClient {
  const url = supabaseUrl();
  const key = supabaseServiceKey();
  if (!url || !key) throw new Error('Supabase URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) must be set');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
