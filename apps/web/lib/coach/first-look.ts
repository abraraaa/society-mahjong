import type { PrivatePlayerView } from '@society/engine';
import { MY_MOVES } from './words';

/**
 * Someone who takes a seat over part-way through a hand (from a bot keeping
 * it, at a live table) sits down to tiles they didn't choose, in a hand they
 * didn't see start. Until they make a move of their own, the tutor gives them
 * what a player gets at the start of a hand: the round's aim, and the plan.
 */

/**
 * When this person took the seat: the hand index and view seq at the moment they took it over mid-hand. The live
 * snapshot's `joinedAt`, which is null unless the take-over was in this game's current hand, and after whose seq no bot
 * moved for this seat.
 */
export interface JoinedAt {
  readonly hand: number;
  readonly seq: number;
}

/**
 * True while the person who took this seat in this hand hasn't made a move of their own since: `joinedAt.hand` is
 * `view.progress.handIndex`, and there's no discarded, claimed or kong event by `view.me` after `joinedAt.seq`. The
 * bot's moves before it don't count: those were the bot's.
 */
export function firstLookFor(view: Pick<PrivatePlayerView, 'me' | 'events' | 'progress'>, joinedAt: JoinedAt | null | undefined): boolean {
  if (!joinedAt || joinedAt.hand !== view.progress.handIndex) return false;
  return !view.events.some((e) => e.seq > joinedAt.seq && e.seat === view.me && MY_MOVES.has(e.type));
}

/**
 * A snapshot's `joinedAt`, read the way the rest of a snapshot's JSON is: a table that sends none, or anything but a
 * hand and a seq, gives null, and so no first look.
 */
export function joinedAtOf(snapshot: object | null | undefined): JoinedAt | null {
  const value: unknown = snapshot && 'joinedAt' in snapshot ? snapshot.joinedAt : null;
  if (typeof value !== 'object' || value === null) return null;
  const { hand, seq } = value as { readonly hand?: unknown; readonly seq?: unknown };
  return Number.isSafeInteger(hand) && Number.isSafeInteger(seq) ? { hand: hand as number, seq: seq as number } : null;
}
