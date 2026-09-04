import type { NextRequest } from 'next/server';
import { currentUser } from '@/lib/live/auth';
import { errorResponse, json } from '@/lib/live/http';
import { requireRoom, roomSnapshot } from '@/lib/live/rooms';
import { HttpError } from '@/lib/live/service';
import { seatOf } from '@/lib/live/types';

/** The lobby, for someone already seated. Joining is a POST to /join. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  try {
    const user = await currentUser();
    if (!user) throw new HttpError(401, 'sign in first');
    const { code } = await ctx.params;
    const room = await requireRoom(code);
    if (seatOf(room.seats, user.id) === null && room.host_id !== user.id) throw new HttpError(403, 'not at this table');
    return json(roomSnapshot(room, user.id));
  } catch (err) {
    return errorResponse(err);
  }
}
