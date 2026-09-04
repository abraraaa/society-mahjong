import type { NextRequest } from 'next/server';
import { currentUser } from '@/lib/live/auth';
import { errorResponse, json } from '@/lib/live/http';
import { HttpError, actOnGame } from '@/lib/live/service';

/**
 * "The clock ran out": a client whose countdown reached zero asks the table to
 * resolve whatever expired. Any seated player may send it; it applies no action
 * of theirs. This is what keeps a table moving on a plan without a minute cron.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await currentUser();
    if (!user) throw new HttpError(401, 'sign in first');
    const { id } = await ctx.params;
    return json(await actOnGame(id, user.id, null, null));
  } catch (err) {
    return errorResponse(err);
  }
}
