import type { NextRequest } from 'next/server';
// Relative, not '@/lib', so vitest can load this handler without an alias.
import { currentUser } from '../../../../../lib/live/auth';
import { broadcast, roomPoke, seatsPoke } from '../../../../../lib/live/broadcast';
import { recordEvent } from '../../../../../lib/live/events';
import { errorResponse, json } from '../../../../../lib/live/http';
import { requireRoom, roomSnapshot, sitDown } from '../../../../../lib/live/rooms';
import { HttpError, noteTakeOver, settleRoomGame } from '../../../../../lib/live/service';
import { cleanDisplayName, parseSeat } from '../../../../../lib/live/validate';

/**
 * The take-over screen's answer (R21): take a bot's seat over at the game in play, carrying on with its tiles and points. A room
 * whose game has ended, or should have, is settled first (settleRoomGame), and a room that turns out not to be playing is joined
 * instead, as the invite link would. Once a seat is taken the table notes when (noteTakeOver, for the tutor's first look), the
 * lobby hears, and so does the table: the seats changed hands though the table may not have moved.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  try {
    const user = await currentUser();
    if (!user) throw new HttpError(401, 'sign in first');
    const { code } = await ctx.params;
    const body = (await req.json().catch(() => null)) as { seat?: unknown; name?: unknown } | null;
    const seat = parseSeat(body?.seat);
    if (seat === null) throw new HttpError(400, 'that is not a seat to sit in');
    const name = cleanDisplayName(body?.name) ?? user.name;
    const now = Date.now();
    const sat = await sitDown(await settleRoomGame(await requireRoom(code), now), user.id, name, seat, now);
    const r = sat.room;
    if (sat.took && r.current_game_id !== null) await noteTakeOver(r.current_game_id, user.id, now);
    const snap = roomSnapshot(r, user.id, now, sat.circle);
    if (sat.took || sat.joined) {
      await broadcast([roomPoke(r.id, 'seats', { seats: snap.seats }), ...(sat.took && r.current_game_id !== null ? [seatsPoke(r.current_game_id)] : [])]);
    }
    // A take-over was counted as it happened (sitDown); a join is counted as the invite link counts one.
    if (sat.joined) await recordEvent({ type: 'seat_taken', roomId: r.id, userId: user.id, data: { how: sat.displaced ? 'displaced' : 'join', status: r.status } });
    return json(snap);
  } catch (err) {
    return errorResponse(err, '/api/rooms/[code]/sit');
  }
}
