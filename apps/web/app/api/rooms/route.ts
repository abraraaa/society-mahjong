import type { NextRequest } from 'next/server';
import type { RulesetId } from '@society/engine';
import { currentUser } from '@/lib/live/auth';
import { errorResponse, json } from '@/lib/live/http';
import { HttpError } from '@/lib/live/service';
import { createRoom, roomByCode } from '@/lib/live/store';
import { generateRoomCode } from '@/lib/room-code';

const RULESETS: readonly RulesetId[] = ['karachi', 'taiwanese'];

/** Create a room. Guests may host: the room is theirs on this device until they add an email. */
export async function POST(req: NextRequest) {
  try {
    const user = await currentUser();
    if (!user) throw new HttpError(401, 'sign in first');
    const body = (await req.json().catch(() => ({}))) as { rulesetId?: string; options?: Record<string, unknown> };
    const rulesetId = (RULESETS as readonly string[]).includes(body.rulesetId ?? '') ? (body.rulesetId as RulesetId) : 'karachi';
    // Codes are short, so a clash is possible; take the first free one.
    let code = generateRoomCode();
    for (let i = 0; i < 5 && (await roomByCode(code)); i++) code = generateRoomCode();
    const room = await createRoom({ code, hostId: user.id, hostName: user.name, rulesetId, options: body.options ?? {} });
    return json({ id: room.id, code: room.code }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
