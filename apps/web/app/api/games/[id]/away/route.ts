import type { NextRequest } from 'next/server';
// Relative, not '@/lib', so vitest can load this handler without an alias.
import { currentUser } from '../../../../../lib/live/auth';
import { errorResponse, json } from '../../../../../lib/live/http';
import { HttpError, changeSeat } from '../../../../../lib/live/service';

/**
 * The host lets a bot play someone's seat straight away: `{ seat, sawAt }`, where `sawAt` is the server's clock on the
 * table the host was looking at. The service checks both, and who may (changeSeat).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await currentUser();
    if (!user) throw new HttpError(401, 'sign in first');
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => null)) as { seat?: unknown; sawAt?: unknown } | null;
    return json(await changeSeat(id, user.id, { type: 'letBotPlay', seat: body?.seat, sawAt: body?.sawAt }));
  } catch (err) {
    return errorResponse(err, '/api/games/[id]/away');
  }
}
