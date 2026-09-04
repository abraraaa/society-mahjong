import type { NextRequest } from 'next/server';
import { currentUser } from '@/lib/live/auth';
import { errorResponse, json } from '@/lib/live/http';
import { HttpError, actOnGame } from '@/lib/live/service';
import type { ClientAction } from '@/lib/live/types';

/** One action against the table, judged against the version the client saw. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await currentUser();
    if (!user) throw new HttpError(401, 'sign in first');
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => null)) as { action?: ClientAction; expectedVersion?: number } | null;
    if (!body || !body.action || typeof body.action !== 'object' || typeof body.action.type !== 'string') throw new HttpError(400, 'an action is required');
    const expected = typeof body.expectedVersion === 'number' ? body.expectedVersion : null;
    return json(await actOnGame(id, user.id, body.action, expected));
  } catch (err) {
    return errorResponse(err);
  }
}
