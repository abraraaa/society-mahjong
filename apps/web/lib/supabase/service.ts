import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The service-role client: bypasses RLS, so it exists only inside route
 * handlers and only after the caller's session has been checked. Never
 * import this from anything a browser bundle can reach.
 */
export function createServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL must be set');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
