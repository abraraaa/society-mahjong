import type { NextRequest } from 'next/server';
// Relative, not '@/lib', so vitest can load this handler without an alias.
import { currentUser } from '../../../../../lib/live/auth';
import { errorResponse, json } from '../../../../../lib/live/http';
import { HttpError, changeSeat } from '../../../../../lib/live/service';

/** "I'm back": the caller takes their own seat back from the bot that's been playing it for them (changeSeat). */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await currentUser();
    if (!user) throw new HttpError(401, 'sign in first');
    const { id } = await ctx.params;
    return json(await changeSeat(id, user.id, { type: 'back' }));
  } catch (err) {
    return errorResponse(err, '/api/games/[id]/back');
  }
}
