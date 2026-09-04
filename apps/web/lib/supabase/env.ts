/**
 * Where the Supabase settings come from.
 *
 * The Supabase ⇄ Vercel integration sets a large family of variables on the
 * project (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, the
 * POSTGRES_* connection strings, the NEXT_PUBLIC_ pair for Next.js, and on
 * newer projects the publishable/secret key pair that replaces anon/service
 * role). Rather than insist on one spelling, each setting is resolved from the
 * names the integration has used, newest first, so nothing needs renaming in
 * the Vercel dashboard.
 *
 * Browser code must reference NEXT_PUBLIC_ names literally (Next inlines them
 * at build time), so the client-side resolver is a separate function that does.
 */

/** Server-side only: may read any variable. */
export function supabaseUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
}

/** The key that acts as the signed-in user (RLS applies). Server-side. */
export function supabaseAnonKey(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY
  );
}

/** The key that bypasses RLS. Server-side only, used after the session check. */
export function supabaseServiceKey(): string | undefined {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
}

/**
 * Browser-safe: only NEXT_PUBLIC_ names, each written out in full so the
 * bundler can inline them. Works on the server too.
 */
export function publicSupabaseConfig(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (or _PUBLISHABLE_KEY) must be set');
  return { url, key };
}
