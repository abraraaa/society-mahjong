import type { NextRequest } from 'next/server';
import { currentUser } from '@/lib/live/auth';
import { errorResponse, json } from '@/lib/live/http';
import { HttpError, actOnGame } from '@/lib/live/service';
import { parseClientAction } from '@/lib/live/validate';

/** One action against the table, judged against the version the client saw. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await currentUser();
    if (!user) throw new HttpError(401, 'sign in first');
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => null)) as { action?: unknown; expectedVersion?: unknown } | null;
    // Only a player's own kind of move, rebuilt from checked fields: never the server's resolveClaims, never extra keys.
    const action = parseClientAction(body?.action);
    if (!action) throw new HttpError(400, 'that is not a move a player can make');
    const expected = Number.isInteger(body?.expectedVersion) ? (body?.expectedVersion as number) : null;
    return json(await actOnGame(id, user.id, action, expected));
  } catch (err) {
    return errorResponse(err);
  }
}
