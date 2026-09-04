import type { NextRequest } from 'next/server';
import { errorResponse, json } from '@/lib/live/http';
import { actOnGame } from '@/lib/live/service';
import { expiredGames } from '@/lib/live/store';

/**
 * Resolve deadlines on tables where nobody has sent anything. Vercel Cron calls
 * this with the CRON_SECRET; on Hobby that is once a day, so the client-side
 * tick does the real work and this is the backstop for abandoned tables.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return json({ error: 'unauthorised' }, 401);
  try {
    const now = Date.now();
    const ids = await expiredGames(now);
    const results: Record<string, string> = {};
    for (const id of ids) {
      try {
        await actOnGame(id, null, null, null, now);
        results[id] = 'ok';
      } catch (err) {
        results[id] = (err as Error).message;
      }
    }
    return json({ swept: ids.length, results });
  } catch (err) {
    return errorResponse(err);
  }
}
