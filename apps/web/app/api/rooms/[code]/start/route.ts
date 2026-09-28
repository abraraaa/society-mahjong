import type { NextRequest } from 'next/server';
import { getRuleset } from '@society/engine';
// Relative, not '@/lib', so vitest can load this handler without an alias.
import { currentUser } from '../../../../../lib/live/auth';
import { broadcast, roomPoke } from '../../../../../lib/live/broadcast';
import { stamp } from '../../../../../lib/live/hand-log';
import { errorResponse, json } from '../../../../../lib/live/http';
import { emptySeatBots, humanLevels, policyFor } from '../../../../../lib/live/policy';
import { requireRoom, withBots } from '../../../../../lib/live/rooms';
import { HttpError } from '../../../../../lib/live/service';
import { stagesBySeat, startGame } from '../../../../../lib/live/store';
import { dealFirstHand } from '../../../../../lib/live/table';
import { newGameSeed } from '../../../../../lib/seed';

/** The host starts the table, or deals again after a game. Empty seats get bots; the seed is minted here and never leaves the server. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  try {
    const user = await currentUser();
    if (!user) throw new HttpError(401, 'sign in first');
    const { code } = await ctx.params;
    const room = await requireRoom(code);
    if (room.host_id !== user.id) throw new HttpError(403, 'only the host can start');
    // A finished room starts again with the same seats: the scores start from nought, the seed is fresh. The room is as requireRoom reads
    // it, so it is "playing" only while its game is live: one left "playing" by a game that has ended can be dealt again.
    if (room.status === 'playing') throw new HttpError(409, 'a game is in progress');
    const seats = withBots(room.seats);
    const ruleset = getRuleset(room.ruleset_id);
    const strict = room.options['strict'] === true;
    const levels = await stagesBySeat(seats);
    const now = Date.now();
    const first = dealFirstHand(ruleset, seats, newGameSeed(), policyFor(humanLevels(levels), strict), now, { bots: emptySeatBots(levels, strict) });
    // The bots' opening moves go in the first hand's log, stamped with the live table's first version.
    const game = await startGame(room, first.state.seed, seats, { ...first, moves: stamp(first.moves, 1) });
    await broadcast([roomPoke(room.id, 'started', { gameId: game.id })]);
    return json({ gameId: game.id }, 201);
  } catch (err) {
    return errorResponse(err, '/api/rooms/[code]/start');
  }
}
