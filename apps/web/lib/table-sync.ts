import type { ClaimOption, PrivatePlayerView, PublicGameView, TileKind } from '@society/engine';
import { ApiError } from './live/client';
import { isPrivate, type GameSnapshot } from './live/snapshot';
import type { ClientAction } from './live/types';
import { canDiscard } from './table-flow';

/**
 * How a live table keeps up with the server when Realtime, the network or
 * another player's tap gets in the way. Pure, or with the request passed in,
 * so the page's decisions can be tested without a server.
 */

/** How often a visible table looks again on its own, in case Realtime has gone quiet without saying so. */
export const POLL_MS = 12_000;

/** Whether this seat could make `action` in `view`: its own seat, the right phase, and a move the table offers. */
export function stillLegal(action: ClientAction, view: PrivatePlayerView | PublicGameView): boolean {
  if (!isPrivate(view)) return false;
  if (action.type === 'nextHand') return view.phase === 'finished';
  if (action.seat !== view.me) return false;
  const myTurn = view.phase === 'turn' && view.turn === view.me;
  switch (action.type) {
    case 'discard':
      return canDiscard(view, action.tile);
    case 'declareKong':
      return myTurn && !!view.legal.kong?.includes(action.tile);
    case 'declareWin':
      return myTurn && view.legal.win === true;
    case 'pass':
      return view.phase === 'claim' && view.legal.pass === true;
    case 'claim':
      return view.phase === 'claim' && !!view.legal.claims?.some((c) => sameClaim(c, action.claim));
    case 'exchange':
      return view.phase === 'preplay' && view.legal.exchange?.count === action.tiles.length && holds(view.concealed, action.tiles);
  }
}

function sameClaim(a: ClaimOption, b: ClaimOption): boolean {
  return a.type === b.type && (a.tiles ?? []).join() === (b.tiles ?? []).join();
}

/** Whether `hand` holds every tile in `tiles`, counting repeats. */
function holds(hand: readonly TileKind[], tiles: readonly TileKind[]): boolean {
  const left = [...hand];
  for (const t of tiles) {
    const i = left.indexOf(t);
    if (i < 0) return false;
    left.splice(i, 1);
  }
  return true;
}

/**
 * What a move does after it bounced off a newer table (a 409 carrying the
 * table as it now stands):
 *
 * - `retry` — send it once more, against the newer table. Only when nothing
 *   has happened at the table since the player tapped (same hand, same event
 *   sequence: someone else's exchange or pass, which log no event), and the
 *   move is still one the table offers. Several humans exchanging or answering
 *   one discard at once is the everyday case.
 * - `quiet` — let it go without a word: the tap asked for the next hand, and
 *   someone else's tap has already dealt it (or ended the game).
 * - `tell`  — the table has moved on, or this was already the retry: the tap
 *   is void, and the player is told so rather than left wondering.
 *
 * `sent` is the table the player tapped on; `fresh` is the newest one held
 * after the 409.
 */
export type AfterConflict = 'retry' | 'quiet' | 'tell';

export function afterConflict(action: ClientAction, sent: GameSnapshot, fresh: GameSnapshot, retried: boolean): AfterConflict {
  if (action.type === 'nextHand' && (fresh.status === 'finished' || fresh.view.progress.handIndex > sent.view.progress.handIndex)) return 'quiet';
  if (retried || fresh.status !== 'active' || fresh.version === sent.version) return 'tell';
  const sameStretch = fresh.view.progress.handIndex === sent.view.progress.handIndex && fresh.view.seq === sent.view.seq;
  return sameStretch && stillLegal(action, fresh.view) ? 'retry' : 'tell';
}

/**
 * How sending one move ended: it landed, it was let go without a word, or it
 * failed with `err` for the player to hear about. A quiet end with `look` set
 * came back without the table attached, so the page should look at it again.
 */
export type MoveOutcome = { readonly kind: 'landed' } | { readonly kind: 'quiet'; readonly look?: boolean } | { readonly kind: 'failed'; readonly err: unknown };

/**
 * The server's refusal of any move once the game has ended. It carries no
 * table, so afterConflict never sees it; for a Next hand tap it means someone
 * else's tap already ended the game, which is no news to the player.
 */
function gameOverRefusal(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409 && err.message === 'game is over';
}

/**
 * Send one move made on `sent` (the table the player tapped on). A 409 that
 * carries the table as it now stands is handed to `take` at once, and the move
 * goes once more, against the newest table held (`latest`, normally that very
 * snapshot), when afterConflict says so. Never against the version that was
 * just refused, and never more than twice in all. A Next hand tap refused
 * because the game has ended goes quietly too, with word to look again.
 */
export async function sendMove(
  action: ClientAction,
  sent: GameSnapshot,
  act: (expectedVersion: number) => Promise<GameSnapshot>,
  take: (snapshot: GameSnapshot) => void,
  latest: () => GameSnapshot | null,
): Promise<MoveOutcome> {
  let against = sent;
  for (let retried = false; ; retried = true) {
    try {
      take(await act(against.version));
      return { kind: 'landed' };
    } catch (err) {
      if (action.type === 'nextHand' && gameOverRefusal(err)) return { kind: 'quiet', look: true };
      if (!(err instanceof ApiError) || !err.snapshot) return { kind: 'failed', err };
      take(err.snapshot);
      const fresh = latest() ?? err.snapshot;
      const next = afterConflict(action, sent, fresh, retried);
      if (next !== 'retry') return next === 'quiet' ? { kind: 'quiet' } : { kind: 'failed', err };
      against = fresh;
    }
  }
}

/** Whether the slow poll should look at the table now: a game still in play, on screen, with no move of ours or look already on its way. */
export function shouldPoll({
  status,
  visible,
  sending,
  looking = false,
}: {
  status: GameSnapshot['status'] | null;
  visible: boolean;
  sending: boolean;
  looking?: boolean;
}): boolean {
  return status === 'active' && visible && !sending && !looking;
}

/**
 * What a look at the table that failed should do about it:
 *
 * - `ignore` — nothing. A newer table has come in since the look set out (a
 *   move's answer, a tick, another look), or another look is about to go:
 *   either answers for it, and a working table mustn't be told otherwise.
 * - `record` — keep the error for the Trouble screen, without a notice: there's
 *   no table on screen yet for a notice to sit over, or the look was the poll's.
 * - `tell` — keep the error and say so over the table.
 *
 * `before` is the newest table held when the look set out, `latest` the newest
 * held now (the same object when nothing newer has come in).
 */
export function afterFailedLook({
  before,
  latest,
  another,
  quiet,
}: {
  before: GameSnapshot | null;
  latest: GameSnapshot | null;
  another: boolean;
  quiet: boolean;
}): 'ignore' | 'record' | 'tell' {
  if (latest !== before || another) return 'ignore';
  return quiet || latest === null ? 'record' : 'tell';
}

/** Looks at the table one at a time: `ask` asks for a look, and `looking` says whether one is on its way. */
export interface LookQueue {
  readonly ask: (quiet?: boolean) => Promise<void>;
  readonly looking: () => boolean;
}

/**
 * One look at the table at a time, however many pokes, rejoins and wake-ups
 * ask for one. An ask while a look is on its way doesn't start another
 * request. It's folded into a single look straight after that one, because the
 * look on its way may have left before whatever prompted the ask (a poke, a
 * rejoin after a dropped connection) and so can't answer it. However many asks
 * come in meanwhile, exactly one more look follows.
 *
 * `look` handles its own failures. It's told whether another look is already
 * waiting to go after it, in which case a failure needn't be reported: the
 * next look will answer for it. That look is quiet only if every ask it
 * answers was quiet. Each ask's promise settles once the look that answers it
 * is done.
 */
export function singleFlight(look: (quiet: boolean, another: () => boolean) => Promise<void>): LookQueue {
  let running = false;
  let queued: { quiet: boolean; done: Promise<void>; settle: () => void } | null = null;
  const another = () => queued !== null;

  const run = async (quiet: boolean): Promise<void> => {
    running = true;
    try {
      await look(quiet, another);
    } catch {
      // A look reports its own failures; a throw must not stop the next one.
    }
    const next = queued;
    queued = null;
    running = false;
    if (next) void run(next.quiet).then(next.settle);
  };

  return {
    ask: (quiet = false) => {
      if (!running) return run(quiet);
      if (queued) {
        queued.quiet &&= quiet;
        return queued.done;
      }
      let settle = () => {};
      const done = new Promise<void>((resolve) => (settle = resolve));
      queued = { quiet, done, settle };
      return done;
    },
    looking: () => running,
  };
}
