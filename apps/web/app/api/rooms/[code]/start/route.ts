import type { NextRequest } from 'next/server';
import { getRuleset } from '@society/engine';
// Relative, not '@/lib', so vitest can load this handler without an alias.
import { currentUser } from '../../../../../lib/live/auth';
import { broadcast, roomPoke } from '../../../../../lib/live/broadcast';
import { gameDealt, recordEvent } from '../../../../../lib/live/events';
import { stamp } from '../../../../../lib/live/hand-log';
import { errorResponse, json } from '../../../../../lib/live/http';
import { emptySeatBots, humanLevels, policyFor } from '../../../../../lib/live/policy';
import { powersIn, requireRoom, roomCircle, withCheckIn } from '../../../../../lib/live/rooms';
import { isHere, seatsForDeal } from '../../../../../lib/live/seating';
import { HttpError, settleRoomGame } from '../../../../../lib/live/service';
import { seatStages, startGame, touchMember } from '../../../../../lib/live/store';
import { dealFirstHand } from '../../../../../lib/live/table';
import { seatOf } from '../../../../../lib/live/types';
import { newGameSeed } from '../../../../../lib/seed';

/**
 * The host starts the table, or deals again after a game. Empty seats get bots, and so does anyone seated who isn't here: a bot
 * keeps their seat, so they can take it when they arrive (seatsForDeal, R19). The seed is minted here and never leaves the server.
 * "The host" is whoever has the host's powers (hostOf): the room's host while seated and here, else whoever here has sat longest,
 * so a room whose host has stood up, or hasn't come tonight, isn't stuck. Who's here is read from the room's members (R17), and the
 * starter is checked in first: tapping Start is being here, however long their lobby has been open.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  try {
    const user = await currentUser();
    if (!user) throw new HttpError(401, 'sign in first');
    const { code } = await ctx.params;
    const now = Date.now();
    // A game that has ended but isn't all recorded yet is finished first, and one nobody has played for hours is ended, so the
    // room reads as between games and can be dealt again.
    const room = await settleRoomGame(await requireRoom(code), now);
    if (seatOf(room.seats, user.id) === null) throw new HttpError(403, 'only the host can start');
    // Between games the powers go by who's here, so it's read for real, not guessed. The starter is here whether or not their
    // check-in lands. (A room in play is refused below; while it plays, the powers go by who's seated.)
    const playing = room.status === 'playing';
    const [seen] = playing ? [null] : await Promise.all([roomCircle(room, 'decide'), touchMember(room.id, user.id, now)]);
    const circle = seen && withCheckIn(seen, user.id, now);
    if (powersIn(room, circle, now) !== user.id) throw new HttpError(403, 'only the host can start');
    // A finished room starts again with the same seats: the scores start from nought, the seed is fresh. The room is as requireRoom and
    // settleRoomGame leave it, so it is "playing" only while its game is live: one left "playing" by a game that has ended can be dealt again.
    if (playing || !circle) throw new HttpError(409, 'a game is in progress');
    const seats = seatsForDeal(room.seats, (seat) => isHere(room.seats[seat] ?? null, circle, now));
    const ruleset = getRuleset(room.ruleset_id);
    const strict = room.options['strict'] === true;
    const { levels, read } = await seatStages(seats);
    const first = dealFirstHand(ruleset, seats, newGameSeed(), policyFor(humanLevels(levels), strict), now, { bots: emptySeatBots(levels, strict) });
    // The bots' opening moves go in the first hand's log, stamped with the live table's first version.
    const game = await startGame(room, first.state.seed, seats, { ...first, moves: stamp(first.moves, 1) });
    await broadcast([roomPoke(room.id, 'started', { gameId: game.id })]);
    // Counted once the room points at the game: a deal that lost to a seat change threw above, and counts nothing. "Again" is a
    // room that had a game before this one. Levels that couldn't be read are counted as unknown, not as everyone new.
    await recordEvent(gameDealt({ roomId: room.id, gameId: game.id, userId: user.id, seats, levels: read ? levels : null, again: room.current_game_id !== null }));
    return json({ gameId: game.id }, 201);
  } catch (err) {
    return errorResponse(err, '/api/rooms/[code]/start');
  }
}
