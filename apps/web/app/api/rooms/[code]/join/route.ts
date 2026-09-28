import type { NextRequest } from 'next/server';
// Relative, not '@/lib', so vitest can load this handler without an alias.
import { currentUser } from '../../../../../lib/live/auth';
import { broadcast, roomPoke } from '../../../../../lib/live/broadcast';
import { recordEvent } from '../../../../../lib/live/events';
import { errorResponse, json } from '../../../../../lib/live/http';
import { joinRoom, requireRoom, roomSnapshot } from '../../../../../lib/live/rooms';
import { HttpError, settleRoomGame } from '../../../../../lib/live/service';
import { cleanDisplayName } from '../../../../../lib/live/validate';

/**
 * A room code is enough to sit down. Idempotent: a returning player gets their seat back, and opening the link checks them in,
 * so the lobby knows they're here (R17). Between games a newcomer may be given the seat of someone who isn't here (R18); at a
 * game in play they're offered a bot's seat to take over instead (`offer`, R21), and nothing is written until they take it
 * (the sit route). A room whose game has ended,
 * but whose end isn't all recorded yet, is finished first (settleRoomGame), so a friend arriving after the last hand
 * finds the room between games rather than "already started".
 *
 * `rejoin: true` is the lobby asking by itself for someone it found without a seat between games: they're sat down again only
 * if a newcomer was given their seat, never after they left (joinRoom's 'rejoin').
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  try {
    const user = await currentUser();
    if (!user) throw new HttpError(401, 'sign in first');
    const { code } = await ctx.params;
    const body = (await req.json().catch(() => null)) as { name?: unknown; rejoin?: unknown } | null;
    const name = cleanDisplayName(body?.name) ?? user.name;
    const now = Date.now();
    const how = body?.rejoin === true ? 'rejoin' : 'open';
    const { room, seated, displaced, circle, offer } = await joinRoom(await settleRoomGame(await requireRoom(code), now), user.id, name, now, how);
    const snap = roomSnapshot(room, user.id, now, circle, offer);
    if (seated) {
      await broadcast([roomPoke(room.id, 'seats', { seats: snap.seats })]);
      // Only a new seat counts: someone coming back to the seat they already had took nothing. The status says whether they sat
      // down before the room's first game or between games; `displaced`, that the seat was someone's who wasn't here.
      await recordEvent({ type: 'seat_taken', roomId: room.id, userId: user.id, data: { how: displaced ? 'displaced' : 'join', status: room.status } });
    }
    return json(snap);
  } catch (err) {
    return errorResponse(err, '/api/rooms/[code]/join');
  }
}
