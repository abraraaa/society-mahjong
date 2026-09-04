import { createServiceClient } from '@/lib/supabase/service';
import { supabaseAnonKey, supabaseServiceKey, supabaseUrl } from '@/lib/supabase/env';
import { json } from '@/lib/live/http';

/**
 * One URL that says whether the server can play: which settings are present
 * (never their values), and whether the tables the live table needs exist.
 * Open it in a browser before blaming the lobby.
 */
export async function GET() {
  const settings = {
    supabaseUrl: !!supabaseUrl(),
    anonKey: !!supabaseAnonKey(),
    serviceKey: !!supabaseServiceKey(),
    cronSecret: !!process.env.CRON_SECRET,
    hcaptchaSiteKey: !!process.env.NEXT_PUBLIC_HCAPTCHA_SITEKEY || 'built-in default',
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
  return json({ ok, settings, tables, hint: ok ? 'Server can play. If the lobby still fails, the message it shows is the next clue.' : 'Something above is missing. Fix it, redeploy, reload this page.' }, ok ? 200 : 503);
}
