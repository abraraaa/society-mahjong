import { SEATS, type PrivatePlayerView, type PublicGameView, type Seat } from '@society/engine';
import type { CoachStage } from '../coach/types';
import { reconcileAbsence } from './absence';
import type { NextHandWait, PublicGameOver } from './lifecycle';
import type { Absence, AwayPlayed } from './table-state';
import type { AwayReason, Deadlines, Move, Seats } from './types';

/**
 * A seat as everyone at the table sees it: who plays it, by name, and for a
 * person, whether a clock has run out on them (`missed`) or a bot is playing
 * their tiles for now (`away`). Never an id.
 */
export interface PublicSeat {
  readonly kind: 'human' | 'bot';
  readonly name: string;
  readonly presence?: 'missed' | 'away';
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
}

/** The seats as the table shows them to everyone (PublicSeat), each absence first matched to who sits there now. */
export function publicSeats(seats: Seats, a: Absence | undefined): (PublicSeat | null)[] {
  const now = a && reconcileAbsence(a, seats);
  return SEATS.map((seat) => {
    const s = seats[seat];
    if (!s) return null;
    const e = s.kind === 'human' ? now?.[seat] : undefined;
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
