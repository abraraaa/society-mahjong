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

/** How sending one move ended: it landed, it was let go without a word, or it failed with `err` for the player to hear about. */
export type MoveOutcome = { readonly kind: 'landed' } | { readonly kind: 'quiet' } | { readonly kind: 'failed'; readonly err: unknown };

/**
 * Send one move made on `sent` (the table the player tapped on). A 409 that
 * carries the table as it now stands is handed to `take` at once, and the move
 * goes once more, against the newest table held (`latest`, normally that very
 * snapshot), when afterConflict says so. Never against the version that was
 * just refused, and never more than twice in all.
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
      if (!(err instanceof ApiError) || !err.snapshot) return { kind: 'failed', err };
      take(err.snapshot);
      const fresh = latest() ?? err.snapshot;
      const next = afterConflict(action, sent, fresh, retried);
      if (next !== 'retry') return next === 'quiet' ? { kind: 'quiet' } : { kind: 'failed', err };
      against = fresh;
    }
  }
}

/** Whether the slow poll should look at the table now: a game still in play, on screen, with no move of ours on its way. */
export function shouldPoll({ status, visible, sending }: { status: GameSnapshot['status'] | null; visible: boolean; sending: boolean }): boolean {
  return status === 'active' && visible && !sending;
}
