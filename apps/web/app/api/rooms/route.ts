import type { NextRequest } from 'next/server';
import { currentUser } from '@/lib/live/auth';
import { errorResponse, json } from '@/lib/live/http';
import { HttpError } from '@/lib/live/service';
import { createRoom, roomByCode } from '@/lib/live/store';
import { parseRoomRequest } from '@/lib/live/validate';
import { generateRoomCode } from '@/lib/room-code';

/** Create a room. Guests may host. Only Karachi is offered, and only the options the server reads are kept. */
export async function POST(req: NextRequest) {
  try {
    const user = await currentUser();
    if (!user) throw new HttpError(401, 'sign in first');
    const request = parseRoomRequest(await req.json().catch(() => undefined));
    if (!request.ok) throw new HttpError(400, request.error);
    // Codes are short, so a clash is possible; take the first free one.
    let code = generateRoomCode();
    for (let i = 0; i < 5 && (await roomByCode(code)); i++) code = generateRoomCode();
    const room = await createRoom({ code, hostId: user.id, hostName: user.name, rulesetId: request.rulesetId, options: request.options });
    return json({ id: room.id, code: room.code }, 201);
  } catch (err) {
    return errorResponse(err, '/api/rooms');
  }
}
