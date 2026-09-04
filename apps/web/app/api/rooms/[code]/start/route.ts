import type { NextRequest } from 'next/server';
import { getRuleset } from '@society/engine';
import type { CoachStage } from '@/lib/coach';
import { currentUser } from '@/lib/live/auth';
import { broadcast, roomPoke } from '@/lib/live/broadcast';
import { errorResponse, json } from '@/lib/live/http';
import { policyFor } from '@/lib/live/policy';
import { requireRoom, withBots } from '@/lib/live/rooms';
import { HttpError } from '@/lib/live/service';
import { stagesFor, startGame } from '@/lib/live/store';
import { dealFirstHand } from '@/lib/live/table';
import { newGameSeed } from '@/lib/seed';

/** The host starts the table. Empty seats get bots; the seed is minted here and never leaves the server. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  try {
    const user = await currentUser();
    if (!user) throw new HttpError(401, 'sign in first');
    const { code } = await ctx.params;
    const room = await requireRoom(code);
    if (room.host_id !== user.id) throw new HttpError(403, 'only the host can start');
    if (room.status !== 'lobby') throw new HttpError(409, 'already started');
    const seats = withBots(room.seats);
    const ruleset = getRuleset(room.ruleset_id);
    const policy = policyFor((await stagesFor(seats)) as CoachStage[], room.options['strict'] === true);
    const now = Date.now();
    const first = dealFirstHand(ruleset, seats, newGameSeed(), policy, now);
    const game = await startGame(room, first.state.seed, seats, first.state, first.deadlines);
    await broadcast([roomPoke(room.id, 'started', { gameId: game.id })]);
    return json({ gameId: game.id }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
