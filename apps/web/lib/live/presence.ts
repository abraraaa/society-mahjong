import { SEATS, tileName, type Seat } from '@society/engine';
import type { GameSnapshot } from './snapshot';
import type { AwayPlayed } from './table-state';
import type { AwayReason, Move } from './types';
// Relative rather than '@/': vitest runs without the path alias, and the tests load this.
import { countOf, isolate, nameList, numberWord, timesOf } from './words';

/**
 * What the table says about who's playing each seat: the marker on a bot's
 * pill or an away person's, the lines when someone leaves, steps away or
 * comes back, the plain words for a move a bot made because someone's clock
 * ran out, the note an away player comes back to, and the host's sheet for
 * handing a seat to a bot. Every string a player reads about that lives here,
 * word for word, so the tests can hold each one to the copy. Pure, and safe
 * to load in the browser.
 */

/** What the table marks a seat with when a person isn't playing it: a bot in it, or a bot playing for someone who's stepped away. */
export type SeatMark = 'bot' | 'away';

/** The marker for each seat a person isn't playing: "Sana · bot" on the pills and in the result rows, "Bilal · away" on the pills. */
export function seatMarks(snap: Pick<GameSnapshot, 'seats'>): Partial<Record<Seat, SeatMark>> {
  const marks: Partial<Record<Seat, SeatMark>> = {};
  for (const seat of SEATS) {
    const s = snap.seats[seat];
    if (s?.kind === 'bot') marks[seat] = 'bot';
    else if (s?.presence === 'away') marks[seat] = 'away';
  }
  return marks;
}

/** Someone got up from the table mid-game, and a bot took their seat. */
const leftLine = (name: string) => `${isolate(name)}'s left the table, so a bot's playing their seat for now.`;
/** Someone else stepped away, and a bot is playing their tiles. */
const awayLine = (name: string) => `${isolate(name)}'s away, so a bot's playing their tiles for now.`;
/** Someone else is back from being away. */
const backLine = (name: string) => `${isolate(name)}'s back.`;
/** For the host alone: a clock has just run out on someone for the first time. */
const missedHint = (name: string) => `${isolate(name)}'s time ran out. If they've stepped away, tap their name to let a bot play for them.`;

/** The reader is back from being away. */
export const WELCOME_BACK = 'Welcome back.';

/**
 * What changed at the table between two snapshots of the same game, as the
 * line the page shows at the top, or null when there's nothing to say. In
 * this order, each sentence after the last:
 * 1. the reader is back from being away;
 * 2. a clock ran out on the reader (who isn't away), and what the bot did,
 *    whichever phone's request found it;
 * 3. each other seat, in seat order: left (a person's seat now a bot's, named
 *    as it was, since the bot may carry another name), away, or back;
 * 4. for the host, a clock that has just run out on someone else for the
 *    first time, with what they can do about it.
 * The reader's own seat is told only in 1 and 2, and nothing is told in a
 * game that's no longer in play, or from a snapshot older than the one before it.
 */
export function tableNews(prev: GameSnapshot, next: GameSnapshot): string | null {
  if (prev.gameId !== next.gameId || next.version < prev.version || next.status !== 'active') return null;
  const lines: string[] = [];
  const mine = next.mine;
  if (mine && next.me !== null && prev.me === next.me) {
    if (prev.mine?.away && !mine.away) lines.push(WELCOME_BACK);
    if (!mine.away && mine.lastClockMove && mine.clockMoves > (prev.mine?.clockMoves ?? 0)) lines.push(clockMoveNotice(mine.lastClockMove));
  }
  const hints: string[] = [];
  for (const seat of SEATS) {
    if (seat === next.me || seat === prev.me) continue;
    const was = prev.seats[seat];
    const now = next.seats[seat];
    if (was?.kind !== 'human') continue;
    if (now?.kind === 'bot') lines.push(leftLine(was.name));
    else if (now?.kind !== 'human') continue;
    else if (now.presence === 'away' && was.presence !== 'away') lines.push(awayLine(now.name));
    else if (was.presence === 'away' && now.presence !== 'away') lines.push(backLine(now.name));
    else if (next.isHost && was.presence === undefined && now.presence === 'missed') hints.push(missedHint(now.name));
  }
  lines.push(...hints);
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

/**
 * Whether the reader can hand this seat to a bot straight away: they have the
 * host's powers at a game in play, and it's someone else's seat, a person's,
 * not already away.
 */
export function canLetBotPlay(snap: GameSnapshot, seat: Seat): boolean {
  const s = snap.seats[seat];
  return snap.isHost && snap.me !== null && snap.status === 'active' && seat !== snap.me && s?.kind === 'human' && s.presence !== 'away';
}

/** The away note's title: why a bot is playing the reader's tiles. */
export function awayTitle(reason: AwayReason): string {
  switch (reason) {
    case 'clock':
      return "Your time ran out twice, so a bot's playing your tiles for now.";
    case 'host':
      return 'The host asked a bot to play your tiles for now.';
    case 'self':
      return "You're taking a break, so a bot's playing your tiles for now.";
  }
}

const capitalised = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The away note's detail: what the bot has done for the reader so far, never in words a first-timer can't follow. */
export function awaySummary(played: AwayPlayed): string {
  const lines: string[] = [];
  const clauses = [
    played.turns > 0 ? `taken ${countOf(played.turns, 'turn')}` : null,
    played.sets > 0 ? `put down ${countOf(played.sets, 'set')}` : null,
    played.exchanges > 0 ? `passed tiles ${timesOf(played.exchanges)}` : null,
  ].filter((c): c is string => c !== null);
  if (clauses.length > 0) lines.push(`So far it's ${nameList(clauses)} for you.`);
  if (played.hands > 0) {
    const finished = played.hands === 1 ? 'A hand finished while you were away' : `${capitalised(countOf(played.hands, 'hand'))} finished while you were away`;
    const won = played.wins === 0 ? '.' : played.hands === 1 ? ', and the bot won it for you.' : `, and the bot won ${numberWord(played.wins)} of them for you.`;
    lines.push(finished + won);
  }
  if (lines.length === 0) lines.push("Nothing's come round to you yet.");
  return lines.join(' ');
}

/** The host's sheet for handing someone's seat to a bot. */
export function letBotPlaySheet(name: string): { title: string; body: string; confirmLabel: string; cancelLabel: string } {
  return {
    title: `Let a bot play for ${isolate(name)}?`,
    body: `A bot will play ${isolate(name)}'s tiles straight away, as well as it can, so nobody's kept waiting. They can take over again with one tap.`,
    confirmLabel: 'Let a bot play',
    cancelLabel: 'Keep waiting',
  };
}

/** What a screen reader hears on a name the host can tap. */
export function letBotPlayLabel(name: string): string {
  return `Let a bot play for ${isolate(name)}`;
}

/** The away note's button. */
export const IM_BACK = "I'm back";
