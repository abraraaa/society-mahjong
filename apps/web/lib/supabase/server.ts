import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseAnonKey, supabaseUrl } from './env';

/** Request-scoped client that acts as the signed-in user (RLS applies). */
export async function createClient() {
  const cookieStore = await cookies();
  const url = supabaseUrl();
  const key = supabaseAnonKey();
  if (!url || !key) throw new Error('Supabase URL and anon/publishable key must be set');
  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // called from a Server Component; middleware refreshes sessions instead
        }
      },
    },
  });
}
