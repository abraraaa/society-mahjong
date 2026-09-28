import type { PrivatePlayerView, PublicGameView, Seat } from '@society/engine';
import type { CoachStage } from '../coach/types';
import type { PublicGameOver } from './lifecycle';
import type { StandIn } from './table';
import type { Deadlines } from './types';

/**
 * What a client gets back from every game route: enough to render, nothing
 * more. Shared by the server (which builds it) and the browser (which reads
 * it), so it must stay free of server-only imports.
 */
export interface GameSnapshot {
  readonly gameId: string;
  readonly roomId: string;
  readonly roomCode: string;
  /** the room's host: the one who can deal again when the game is over (for a game that has ended, only if they were at the table at the end) */
  readonly isHost: boolean;
  readonly rulesetId: string;
  readonly version: number;
  readonly deadlines: Deadlines;
  /** who sits where; for a game that has ended, who sat where at the end */
  readonly seats: readonly ({ readonly kind: 'human' | 'bot'; readonly name: string } | null)[];
  /** running totals per seat for this game, as the table holds them: a finished hand's own points are already in, and a game that has ended has its final scores */
  readonly scores: readonly number[];
  readonly me: Seat | null;
  readonly view: PrivatePlayerView | PublicGameView;
  readonly status: 'active' | 'finished' | 'abandoned';
  readonly now: number;
  /** the caller's own level, as their profile has tallied it (`new` until a hand is on it); null for someone not seated */
  readonly stage?: CoachStage | null;
  /** moves an expired clock had a bot make for absent humans, in the request that produced this snapshot */
  readonly standIns?: readonly StandIn[];
  /** how the game ended, once it has (and whether it was the caller who ended it); null while it's in play, or for a game that ended before this was kept */
  readonly ended?: PublicGameOver | null;
}

export function isPrivate(view: GameSnapshot['view']): view is PrivatePlayerView {
  return 'me' in view;
}
