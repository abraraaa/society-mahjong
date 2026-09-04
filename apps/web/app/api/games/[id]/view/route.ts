import type { NextRequest } from 'next/server';
import { currentUser } from '@/lib/live/auth';
import { errorResponse, json } from '@/lib/live/http';
import { HttpError, viewGame } from '@/lib/live/service';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await currentUser();
    if (!user) throw new HttpError(401, 'sign in first');
    const { id } = await ctx.params;
    return json(await viewGame(id, user.id));
  } catch (err) {
    return errorResponse(err);
  }
}
