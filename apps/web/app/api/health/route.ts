import type { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { supabaseAnonKey, supabaseServiceKey, supabaseUrl } from '@/lib/supabase/env';
import { json } from '@/lib/live/http';
import { secretMatches } from '@/lib/live/secret';

/**
 * One URL that says whether the server can play: which settings are present
 * (never their values), and whether the tables the live table needs exist.
 * Open /api/health?key=<CRON_SECRET> in a browser before blaming the lobby.
 * Without the key, or without CRON_SECRET set at all, it is a 404 like any
 * other missing route: which settings exist is nobody else's business.
 */
export async function GET(req: NextRequest) {
  if (!authorised(req)) return new Response(null, { status: 404 });
  const settings = {
    supabaseUrl: !!supabaseUrl(),
    anonKey: !!supabaseAnonKey(),
    serviceKey: !!supabaseServiceKey(),
    hcaptchaSiteKey: process.env.NEXT_PUBLIC_HCAPTCHA_SITEKEY ? 'from env' : 'project key in lib/captcha.ts',
  };
  const tables: Record<string, string> = {};
  if (settings.supabaseUrl && settings.serviceKey) {
    const db = createServiceClient();
    for (const t of ['profiles', 'rooms', 'games', 'live_state', 'hands', 'hand_results']) {
      const { error } = await db.from(t).select('*', { count: 'exact', head: true });
      tables[t] = error ? `missing or unreadable: ${error.message}` : 'ok';
    }
  }
  const ok = settings.supabaseUrl && settings.anonKey && settings.serviceKey && Object.values(tables).every((v) => v === 'ok') && Object.keys(tables).length > 0;
  return json(
    {
      ok,
      settings,
      tables,
      hint: ok ? 'Server can play. If the lobby still fails, the message it shows is the next clue.' : 'Something above is missing. Fix it, redeploy, reload this page.',
    },
    ok ? 200 : 503,
  );
}

/** The cron secret, as `Authorization: Bearer …` (how Vercel Cron sends it) or `?key=` (how a browser can). */
function authorised(req: NextRequest): boolean {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer /, '');
  return secretMatches(bearer ?? req.nextUrl.searchParams.get('key'), process.env.CRON_SECRET);
}
