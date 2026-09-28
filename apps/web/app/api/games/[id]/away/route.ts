import type { NextRequest } from 'next/server';
// Relative, not '@/lib', so vitest can load this handler without an alias.
import { currentUser } from '../../../../../lib/live/auth';
import { errorResponse, json } from '../../../../../lib/live/http';
import { HttpError, changeSeat } from '../../../../../lib/live/service';

/**
 * A bot plays a seat straight away. Either the host hands someone's seat over: `{ seat, sawAt, sawVersion }`, where
 * `sawVersion` is the version of the table the host was looking at and `sawAt` the server's clock on it; or the caller
 * takes a break, and a bot plays their own seat until they're back: `{ self: true }`. The service checks the rest, and
 * who may (changeSeat).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await currentUser();
    if (!user) throw new HttpError(401, 'sign in first');
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => null)) as { seat?: unknown; sawAt?: unknown; sawVersion?: unknown; self?: unknown } | null;
    if (body?.self === true) return json(await changeSeat(id, user.id, { type: 'break' }));
    return json(await changeSeat(id, user.id, { type: 'letBotPlay', seat: body?.seat, sawAt: body?.sawAt, sawVersion: body?.sawVersion }));
  } catch (err) {
    return errorResponse(err, '/api/games/[id]/away');
  }
}
