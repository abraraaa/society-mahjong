import type { TileInstance, TileKind, Wind } from '../tiles';
import type { Meld, Seat } from '../hand';
import type { GameProgress, RulesetId, Settlement } from '../ruleset';

export type Phase = 'preplay' | 'turn' | 'claim' | 'finished';

export interface PlayerState {
  readonly seat: Seat;
  readonly seatWind: Wind;
  readonly concealed: readonly TileKind[];
  readonly melds: readonly Meld[];
  readonly bonus: readonly TileKind[];
  readonly discards: readonly TileKind[];
  /** kinds this player declined to claim since their last discard (passing rule) */
  readonly passed: readonly TileKind[];
}

export interface WallState {
  readonly live: readonly TileInstance[];
  readonly dead: readonly TileInstance[];
}

export interface ClaimOption {
  readonly type: 'chow' | 'pung' | 'kong' | 'win';
  /** for chow/pung/kong: the tiles taken from the claimant's hand */
  readonly tiles?: readonly TileKind[];
}
export type ClaimResponse = ClaimOption | 'pass';

export interface GameEvent {
  readonly seq: number;
  readonly type: string;
  readonly seat?: Seat;
  readonly tile?: TileKind;
  readonly tiles?: readonly TileKind[];
  readonly data?: Readonly<Record<string, unknown>>;
  /** true when the event's tile is only visible to `seat` */
  readonly secret?: boolean;
}

export type HandResult =
  | {
      readonly type: 'win';
      readonly winner: Seat;
      readonly patternId: string;
      readonly settlement: Settlement;
      readonly selfDrawn: boolean;
      readonly discarder?: Seat;
    }
  | { readonly type: 'draw' };

export interface HandState {
  readonly rulesetId: RulesetId;
  readonly seed: string;
  readonly progress: GameProgress;
  readonly dealer: Seat;
  readonly dealerStreak: number;
  readonly handKind: string;
  readonly phase: Phase;
  readonly preplayStep: number;
  readonly exchanges: Readonly<Partial<Record<Seat, readonly TileKind[]>>>;
  readonly wall: WallState;
  readonly players: readonly [PlayerState, PlayerState, PlayerState, PlayerState];
  readonly turn: Seat;
  /** the tile the turn player just drew (still in their concealed tiles) */
  readonly drawn: TileKind | null;
  readonly drawnWasLastWallTile: boolean;
  readonly lastDiscard: { readonly kind: TileKind; readonly from: Seat } | null;
  readonly claims: Readonly<Partial<Record<Seat, ClaimResponse>>>;
  readonly afterKong: boolean;
  readonly discardCount: number;
  readonly seq: number;
  readonly events: readonly GameEvent[];
  readonly result: HandResult | null;
}

export type Action =
  | { readonly type: 'exchange'; readonly seat: Seat; readonly tiles: readonly TileKind[] }
  | { readonly type: 'discard'; readonly seat: Seat; readonly tile: TileKind }
  | { readonly type: 'declareKong'; readonly seat: Seat; readonly tile: TileKind }
  | { readonly type: 'declareWin'; readonly seat: Seat }
  | { readonly type: 'claim'; readonly seat: Seat; readonly claim: ClaimOption }
  | { readonly type: 'pass'; readonly seat: Seat }
  | { readonly type: 'resolveClaims' };

export interface LegalActions {
  readonly exchange?: { readonly count: number };
  readonly discard?: readonly TileKind[];
  readonly kong?: readonly TileKind[];
  readonly win?: boolean;
  readonly claims?: readonly ClaimOption[];
  readonly pass?: boolean;
}

export class IllegalAction extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IllegalAction';
  }
}
