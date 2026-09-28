import { SEATS, type PrivatePlayerView, type PublicGameView, type Seat } from '@society/engine';
import type { CoachStage } from '../coach/types';
import { reconcileAbsence } from './absence';
import type { LastGame } from './final';
import type { NextHandWait, PublicGameOver } from './lifecycle';
import type { SeatOffer } from './seating';
import type { Absence, AwayPlayed } from './table-state';
import type { AwayReason, Deadlines, Move, RoomStatus, Seats } from './types';

/**
 * A seat as everyone at the table sees it: who plays it, by name, and for a
 * person, whether a clock has run out on them (`missed`) or a bot is playing
 * their tiles for now (`away`); for a bot keeping the seat for someone who
 * left or wasn't here at the deal, their name (`keptFor`). Never an id.
 */
export interface PublicSeat {
  readonly kind: 'human' | 'bot';
  readonly name: string;
  readonly presence?: 'missed' | 'away';
  readonly keptFor?: string;
}

/**
 * The caller's own absence, sent to them alone: how many clocks in a row have
 * run out on them, whether a bot is playing for them and why, the clock moves
 * made for them (a count, and the last, which can hold the tiles they passed)
 * and what the bot has played for them while they've been away.
 */
export interface OwnAbsence {
  readonly misses: number;
  readonly away: AwayReason | null;
  readonly clockMoves: number;
  readonly lastClockMove: Move | null;
  readonly played: AwayPlayed;
}

/**
 * What a client gets back from every game route: enough to render, nothing
 * more. Shared by the server (which builds it) and the browser (which reads
 * it), so it must stay free of server-only imports.
 */
export interface GameSnapshot {
  readonly gameId: string;
  readonly roomId: string;
  readonly roomCode: string;
  /** the caller has the host's powers (seating.ts hostOf: the room's host while seated and here, else whoever here has sat longest): they can end the game, let a bot play for someone, and deal again once it's over; for a game that has ended, whoever had them at the end */
  readonly isHost: boolean;
  readonly rulesetId: string;
  readonly version: number;
  readonly deadlines: Deadlines;
  /** who sits where, and who's away; for a game that has ended, who sat where at the end */
  readonly seats: readonly (PublicSeat | null)[];
  /** running totals per seat for this game, as the table holds them: a finished hand's own points are already in, and a game that has ended has its final scores */
  readonly scores: readonly number[];
  readonly me: Seat | null;
  readonly view: PrivatePlayerView | PublicGameView;
  readonly status: 'active' | 'finished' | 'abandoned';
  readonly now: number;
  /** the caller's own level, as their profile has tallied it (`new` until a hand is on it); null for someone not seated */
  readonly stage?: CoachStage | null;
  /** the caller's own absence (OwnAbsence); null for someone not seated, or a game that has ended */
  readonly mine?: OwnAbsence | null;
  /** how the game ended, once it has (and whether it was the caller who ended it); null while it's in play, or for a game that ended before this was kept */
  readonly ended?: PublicGameOver | null;
  /** on a finished hand of a game in play, who here has tapped Next hand, who hasn't, and when the next hand starts regardless (NextHandWait); null otherwise */
  readonly nextHand?: NextHandWait | null;
  /** for someone not seated at a game in play, a bot's seat they may take over (seating.ts seatOffer: a seat kept for them first); null otherwise */
  readonly offer?: SeatOffer | null;
  /**
   * the hand index and view seq at which the caller took this seat over from a bot, when they did so during this game's hand
   * being played; null otherwise. No bot move for this seat has a later seq (table-state.ts TakeOver). The tutor's first look.
   */
  readonly joinedAt?: { readonly hand: number; readonly seq: number } | null;
}

/**
 * What the lobby shows (rooms.ts roomSnapshot): who sits where, by name, and
 * between games who isn't here yet; who has the host's powers; and the room's
 * last game. Shared by the server and the browser, like GameSnapshot. User
 * ids stay on the server.
 */
export interface RoomSnapshot {
  readonly id: string;
  readonly code: string;
  readonly rulesetId: string;
  readonly status: RoomStatus;
  /** `notHere` marks a person seated between games who hasn't opened the link lately (seating.ts isHere) */
  readonly seats: readonly ({ readonly kind: 'human' | 'bot'; readonly name: string; readonly notHere?: true } | null)[];
  readonly me: number | null;
  /** the caller has the host's powers (seating.ts hostOf): the room's host while seated and here, else whoever here has sat longest */
  readonly isHost: boolean;
  /** the seat of whoever has the host's powers, or null when nobody does */
  readonly hostSeat: number | null;
  readonly gameId: string | null;
  /** between games, how the room's latest finished game ended (final.ts lastGameFrom); null otherwise */
  readonly lastGame?: LastGame | null;
  /** for someone not seated at the game in play, a bot's seat they may take over (seating.ts seatOffer); null otherwise */
  readonly offer?: SeatOffer | null;
}

/** The seats as the table shows them to everyone (PublicSeat), each absence first matched to who sits there now. */
export function publicSeats(seats: Seats, a: Absence | undefined): (PublicSeat | null)[] {
  const now = a && reconcileAbsence(a, seats);
  return SEATS.map((seat) => {
    const s = seats[seat];
    if (!s) return null;
    if (s.kind === 'bot') return typeof s.keptName === 'string' ? { kind: s.kind, name: s.name, keptFor: s.keptName } : { kind: s.kind, name: s.name };
    const e = now?.[seat];
    const presence = e?.away ? 'away' : e && e.misses > 0 ? 'missed' : null;
    return presence ? { kind: s.kind, name: s.name, presence } : { kind: s.kind, name: s.name };
  });
}

/** The caller's own absence (OwnAbsence), matched to who sits there now; null for someone not seated. */
export function ownAbsence(seats: Seats, a: Absence | undefined, me: Seat | null): OwnAbsence | null {
  if (me === null || seats[me]?.kind !== 'human') return null;
  const e = a ? reconcileAbsence(a, seats)[me] : undefined;
  return {
    misses: e?.misses ?? 0,
    away: e?.away ?? null,
    clockMoves: e?.clockMoves ?? 0,
    lastClockMove: e?.lastClockMove ?? null,
    played: e ? { ...e.played } : { turns: 0, sets: 0, exchanges: 0, wins: 0, hands: 0 },
  };
}

export function isPrivate(view: GameSnapshot['view']): view is PrivatePlayerView {
  return 'me' in view;
}
