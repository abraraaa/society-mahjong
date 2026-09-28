import { SEATS, tileName, type Seat } from '@society/engine';
import type { GameSnapshot } from './snapshot';
import type { Move } from './types';
// Relative rather than '@/': vitest runs without the path alias, and the tests load this.
import { isolate } from './words';

/**
 * What the table says about who's playing each seat: the marker on a bot's
 * pill, the line when someone leaves, and the plain words for a move a bot
 * made because someone's clock ran out. Every string a player reads about
 * that lives here, word for word, so the tests can hold each one to the copy.
 * Pure, and safe to load in the browser.
 */

/** What the table marks a seat with when a person isn't playing it: a bot in it (`'away'`, a bot playing for someone who's stepped away, is still to come). */
export type SeatMark = 'bot' | 'away';

/** The marker for each seat a bot plays: "Sana · bot" on the pills and in the result rows. */
export function seatMarks(snap: Pick<GameSnapshot, 'seats'>): Partial<Record<Seat, SeatMark>> {
  const marks: Partial<Record<Seat, SeatMark>> = {};
  for (const seat of SEATS) if (snap.seats[seat]?.kind === 'bot') marks[seat] = 'bot';
  return marks;
}

/** Someone got up from the table mid-game, and a bot took their seat. */
const leftLine = (name: string) => `${isolate(name)}'s left the table, so a bot's playing their seat for now.`;

/**
 * What changed at the table between two snapshots of the same game, as the
 * line the page shows at the top, or null when there's nothing to say. Seats
 * are told in seat order, each sentence after the last. A seat that was a
 * person and is now a bot has been left, and it's named as it was (the bot
 * may carry another name). The reader's own seat is never news to them, and
 * nor is anything in a game that's no longer in play, or from a snapshot
 * older than the one before it.
 */
export function tableNews(prev: GameSnapshot, next: GameSnapshot): string | null {
  if (prev.gameId !== next.gameId || next.version < prev.version || next.status !== 'active') return null;
  const lines: string[] = [];
  for (const seat of SEATS) {
    if (seat === next.me || seat === prev.me) continue;
    const was = prev.seats[seat];
    if (was?.kind === 'human' && next.seats[seat]?.kind === 'bot') lines.push(leftLine(was.name));
  }
  return lines.length > 0 ? lines.join(' ') : null;
}

/** A clock ran out on the reader, and a bot made this move for them: what it did, in words a first-timer can follow. */
export function clockMoveNotice(move: Move): string {
  const a = move.a;
  switch (a.type) {
    case 'discard':
      return `You ran out of time, so a bot discarded the ${tileName(a.tile)} for you.`;
    case 'pass':
      return 'You ran out of time, so a bot let that tile go for you.';
    case 'claim':
      return a.claim.type === 'win' ? 'Time ran out, so a bot called Mahjong for you.' : 'You ran out of time, so a bot picked up that tile to make a set for you.';
    case 'declareWin':
      return 'Time ran out, so a bot called Mahjong for you.';
    case 'declareKong':
      return 'You ran out of time, so a bot put down four of a kind for you.';
    case 'exchange':
      return 'You ran out of time, so a bot chose which tiles to pass for you.';
    default:
      return 'You ran out of time, so a bot moved for you.';
  }
}
