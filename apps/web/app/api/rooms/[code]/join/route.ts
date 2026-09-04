import type { NextRequest } from 'next/server';
import { currentUser } from '@/lib/live/auth';
import { broadcast, roomPoke } from '@/lib/live/broadcast';
import { errorResponse, json } from '@/lib/live/http';
import { joinRoom, requireRoom, roomSnapshot } from '@/lib/live/rooms';
import { HttpError } from '@/lib/live/service';

/** A room code is enough to sit down. Idempotent: a returning player gets their seat back. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  try {
    const user = await currentUser();
    if (!user) throw new HttpError(401, 'sign in first');
    const { code } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { name?: string };
    const name = (body.name ?? user.name).trim().slice(0, 24) || user.name;
    const { room, seated } = await joinRoom(await requireRoom(code), user.id, name);
    const snap = roomSnapshot(room, user.id);
    if (seated) await broadcast([roomPoke(room.id, 'seats', { seats: snap.seats })]);
    return json(snap);
  } catch (err) {
    return errorResponse(err);
  }
}
