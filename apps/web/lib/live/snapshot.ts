import type { PrivatePlayerView, PublicGameView, Seat } from '@society/engine';
import type { Deadlines } from './types';

/**
 * What a client gets back from every game route: enough to render, nothing
 * more. Shared by the server (which builds it) and the browser (which reads
 * it), so it must stay free of server-only imports.
 */
export interface GameSnapshot {
  readonly gameId: string;
  readonly roomCode: string;
  readonly rulesetId: string;
  readonly version: number;
  readonly deadlines: Deadlines;
  readonly seats: readonly ({ readonly kind: 'human' | 'bot'; readonly name: string } | null)[];
  readonly me: Seat | null;
  readonly view: PrivatePlayerView | PublicGameView;
  readonly status: 'active' | 'finished' | 'abandoned';
  readonly now: number;
}

export function isPrivate(view: GameSnapshot['view']): view is PrivatePlayerView {
  return 'me' in view;
}
