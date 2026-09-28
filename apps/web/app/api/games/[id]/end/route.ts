import type { NextRequest } from 'next/server';
// Relative, not '@/lib', so vitest can load this handler without an alias.
import { currentUser } from '../../../../../lib/live/auth';
import { errorResponse, json } from '../../../../../lib/live/http';
import { HttpError, endGame } from '../../../../../lib/live/service';

/**
 * The host ends the game for everyone, from the result sheet or, mid-hand, the Leave sheet. Only whoever has the host's
 * powers may (endGame); everyone gets the final table.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await currentUser();
    if (!user) throw new HttpError(401, 'sign in first');
    const { id } = await ctx.params;
    return json(await endGame(id, user.id));
  } catch (err) {
    return errorResponse(err, '/api/games/[id]/end');
  }
}
