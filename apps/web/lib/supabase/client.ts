import { createBrowserClient } from '@supabase/ssr';
import { publicSupabaseConfig } from './env';

export function createClient() {
  const { url, key } = publicSupabaseConfig();
  return createBrowserClient(url, key);
}
