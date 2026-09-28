import type { NextRequest } from 'next/server';
// Relative, not '@/lib', so vitest can load this handler without an alias.
import { currentUser } from '../../../../lib/live/auth';
import { errorResponse, json } from '../../../../lib/live/http';
import { requireRoom, roomCircle, roomSnapshot, withCheckIn } from '../../../../lib/live/rooms';
import { SEEN_REFRESH_MS, isHere } from '../../../../lib/live/seating';
import { HttpError } from '../../../../lib/live/service';
import { touchMember } from '../../../../lib/live/store';
import { seatOf } from '../../../../lib/live/types';

/**
 * The lobby, for someone already seated (and its five-second poll). Joining is a POST to /join. Between games it says who's
 * here, from the room's members (R17), and the poll keeps the caller here: a seated caller with no member row yet (their join's
 * check-in failed, or their page was loaded before rooms kept members), one last seen over SEEN_REFRESH_MS ago, or one who reads
 * not here all the same, is checked in, so someone with the lobby open for hours stays here at no more than two writes an hour. When who's been seen couldn't be read,
 * nobody is checked in, since there's no telling who needs it.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  try {
    const user = await currentUser();
    if (!user) throw new HttpError(401, 'sign in first');
    const { code } = await ctx.params;
    const room = await requireRoom(code);
    if (seatOf(room.seats, user.id) === null && room.host_id !== user.id) throw new HttpError(403, 'not at this table');
    const now = Date.now();
    // A room in play sends everyone to the table, so its lobby needs no circle.
    let circle = room.status === 'playing' ? null : await roomCircle(room, 'show');
    const me = seatOf(room.seats, user.id);
    const seen = circle?.seen.get(user.id);
    // Also one who reads not here for another reason (last seen before the last game ended, their check-in since then lost): they're
    // plainly here now.
    const stale = circle !== null && me !== null && (seen === undefined || now - seen > SEEN_REFRESH_MS || !isHere(room.seats[me] ?? null, circle, now));
    if (stale && (await touchMember(room.id, user.id, now))) circle = withCheckIn(circle!, user.id, now);
    return json(roomSnapshot(room, user.id, now, circle));
  } catch (err) {
    return errorResponse(err, '/api/rooms/[code]');
  }
}
