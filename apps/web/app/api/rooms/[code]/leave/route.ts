import type { NextRequest } from 'next/server';
import { currentUser } from '@/lib/live/auth';
import { broadcast, roomPoke } from '@/lib/live/broadcast';
import { errorResponse, json } from '@/lib/live/http';
import { leaveRoom, requireRoom, roomSnapshot } from '@/lib/live/rooms';
import { HttpError } from '@/lib/live/service';

/** Leave the lobby before the table starts. The seat empties for whoever comes next. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  try {
    const user = await currentUser();
    if (!user) throw new HttpError(401, 'sign in first');
    const { code } = await ctx.params;
    const room = await leaveRoom(await requireRoom(code), user.id);
    const snap = roomSnapshot(room, user.id);
    await broadcast([roomPoke(room.id, 'seats', { seats: snap.seats })]);
    return json(snap);
  } catch (err) {
    return errorResponse(err);
  }
}
