import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Keeps the Supabase session fresh on every request that could need it, so a
 * phone that has been asleep for a week still has a valid cookie when it opens
 * the table. It sets cookies and nothing else; authorisation happens in the
 * route handlers, where the seat is resolved from the session.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
  });

  // Refreshes the token if it has expired; the result itself is not needed here.
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ['/r/:path*', '/g/:path*', '/room', '/api/:path*'],
};
