import type { NextRequest } from 'next/server';
import { errorResponse, json } from '@/lib/live/http';
import { sweepGames } from '@/lib/live/service';
import { secretMatches } from '@/lib/live/secret';
import { expiredGames } from '@/lib/live/store';

/**
 * Resolve deadlines on tables where nobody has sent anything. Vercel Cron calls
 * this with the CRON_SECRET; on Hobby that is once a day, so the client-side
 * tick does the real work and this is the backstop for abandoned tables.
 *
 * It is also the daily query that keeps a free Supabase project awake. 200
 * means the database answered; 500, that it did not; 401, that CRON_SECRET
 * is missing or wrong and nothing was asked of it. See docs/ops/README.md.
 */
export async function GET(req: NextRequest) {
  if (!secretMatches(req.headers.get('authorization')?.replace(/^Bearer /, ''), process.env.CRON_SECRET)) return json({ error: 'unauthorised' }, 401);
  try {
    const now = Date.now();
    const ids = await expiredGames(now);
    // One stuck table does not stop the rest; see sweepGames for what each result means.
    return json({ swept: ids.length, results: await sweepGames(ids, now) });
  } catch (err) {
    return errorResponse(err, '/api/cron/sweep');
  }
}
