import type { TileKind, TileSetConfig, Wind } from './tiles';
import type { HandInput, Seat } from './hand';
import type { Guards, MatchCtx, Pattern, PatternMatch } from './patterns/types';

export type RulesetId = 'karachi' | 'taiwanese' | 'hongkong';

export interface PreplayExchange {
  readonly type: 'exchange';
  readonly count: number;
  readonly order: readonly ('right' | 'across' | 'left')[];
}
export type PreplayStep = PreplayExchange;

/** What counts as a win for one particular hand of the game. */
export interface HandSpec {
  readonly kind: string;
  readonly label: string;
  readonly description?: string;
  readonly patterns: readonly Pattern[];
  readonly preplay?: readonly PreplayStep[];
}

export interface ClaimRules {
  readonly chowFromDiscard: 'never' | 'left';
  readonly pungFromDiscard: boolean;
  readonly kongFromDiscard: boolean;
  readonly winFromDiscard: boolean;
  readonly multipleWinners: boolean;
  /** a tile you declined to claim cannot be claimed again until you have discarded */
  readonly passingRule?: boolean;
}

export interface GameProgress {
  readonly roundWind: Wind;
  readonly roundIndex: number;
  readonly handInRound: number;
  readonly handIndex: number;
}

export interface ScoreLine {
  readonly id: string;
  readonly name: string;
  readonly value: number;
}
export interface Transfer {
  readonly from: Seat;
  readonly to: Seat;
  readonly amount: number;
}
export interface Settlement {
  readonly winner: Seat;
  readonly unit: 'points' | 'tai' | 'provisional';
  readonly total: number;
  readonly lines: readonly ScoreLine[];
  readonly transfers: readonly Transfer[];
  /** true while the ruleset's scoring table is unconfirmed */
  readonly provisional: boolean;
}

export interface WinInput {
  readonly seat: Seat;
  readonly dealer: Seat;
  readonly hand: HandInput;
  readonly matches: readonly PatternMatch[];
  readonly selfDrawn: boolean;
  readonly discarder?: Seat;
  readonly ctx: MatchCtx;
  readonly bonus: readonly TileKind[];
  readonly wallRemaining: number;
  /** hand index within the game, 0 for the first hand */
  readonly handIndex: number;
  /** where in the game the hand sits; what `handSpec` was called with to deal it */
  readonly progress: GameProgress;
  readonly flags: {
    readonly lastWallTile: boolean;
    readonly robbedKong: boolean;
    readonly afterKong: boolean;
    readonly firstDiscard: boolean;
    readonly heavenly: boolean;
  };
}

export interface Ruleset {
  readonly id: RulesetId;
  readonly name: string;
  readonly description: string;
  readonly tiles: TileSetConfig;
  readonly shape: { readonly handSize: 13 | 16; readonly sets: 4 | 5 };
  readonly deadWallSize: number;
  readonly claims: ClaimRules;
  readonly dealerRetainsOnWin: boolean;
  readonly roundsPerGame: number;
  readonly handsPerRound: number;
  handSpec(progress: GameProgress): HandSpec;
  readonly guards: Guards;
  score(win: WinInput): Settlement;
}

export const ROUND_WINDS: readonly Wind[] = ['E', 'S', 'W', 'N'];
