// Relative, not '@/lib', so vitest can load this handler without an alias.
import { currentUser } from '../../../../lib/live/auth';
import { HttpError } from '../../../../lib/live/errors';
import { errorResponse, json } from '../../../../lib/live/http';
import { answerWatchOffer, watchOffer } from '../../../../lib/live/store';

/**
 * The tutor's offer to just watch (coach/stage.ts asksToWatch). The result
 * sheet asks for it when a hand ends, after the tally for that hand is
 * written, so the third win is asked about on the hand it was won: `{ ask, wins }`.
 */
export async function GET() {
  try {
    const user = await currentUser();
    if (!user) throw new HttpError(401, 'sign in first');
    return json(await watchOffer(user.id));
  } catch (err) {
    return errorResponse(err, '/api/me/tutor');
  }
}

/** The answer: `{ watch: true }` for "just watch", `{ watch: false }` for "keep helping". Answers `{ stage }`, the level it makes. */
export async function POST(req: Request) {
  try {
    const user = await currentUser();
    if (!user) throw new HttpError(401, 'sign in first');
    const body = (await req.json().catch(() => null)) as { watch?: unknown } | null;
    if (typeof body?.watch !== 'boolean') throw new HttpError(400, 'say whether to watch');
    const stage = await answerWatchOffer(user.id, body.watch);
    if (stage === null) throw new HttpError(409, 'nothing to answer');
    return json({ stage });
  } catch (err) {
    return errorResponse(err, '/api/me/tutor');
  }
}
