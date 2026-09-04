import type { NextRequest } from 'next/server';
import { currentUser } from '@/lib/live/auth';
import { errorResponse, json } from '@/lib/live/http';
import { HttpError, leaveGame } from '@/lib/live/service';

/** Stand up from the table. A bot plays the seat from here; the last one out closes the game. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await currentUser();
    if (!user) throw new HttpError(401, 'sign in first');
    const { id } = await ctx.params;
    return json(await leaveGame(id, user.id));
  } catch (err) {
    return errorResponse(err);
  }
}
