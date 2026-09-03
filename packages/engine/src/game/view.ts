import type { TileKind, Wind } from '../tiles';
import type { Meld, Seat } from '../hand';
import type { GameProgress, RulesetId, Ruleset } from '../ruleset';
import { SEATS } from '../hand';
import type { HandResult, HandState, LegalActions, Phase } from './types';
import { legalActions } from './reducer';

/**
 * What everyone at the table can see. By construction this type has no seed,
 * no wall contents and no concealed tiles, so a route handler that returns a
 * PublicGameView cannot leak them without a type error.
 */
export interface PublicPlayerView {
  readonly seat: Seat;
  readonly seatWind: Wind;
  readonly concealedCount: number;
  readonly melds: readonly Meld[];
  readonly bonus: readonly TileKind[];
  readonly discards: readonly TileKind[];
  readonly exchanged: boolean;
  readonly responded: boolean;
}

export interface PublicGameView {
  readonly rulesetId: RulesetId;
  readonly progress: GameProgress;
  readonly dealer: Seat;
  readonly dealerStreak: number;
  readonly handKind: string;
  readonly phase: Phase;
  readonly preplayStep: number;
  readonly wallRemaining: number;
  readonly deadRemaining: number;
  readonly players: readonly [PublicPlayerView, PublicPlayerView, PublicPlayerView, PublicPlayerView];
  readonly turn: Seat;
  readonly lastDiscard: HandState['lastDiscard'];
  readonly afterKong: boolean;
  readonly discardCount: number;
  readonly seq: number;
  readonly result: HandResult | null;
  /** every hand face up once the hand has finished */
  readonly revealed: Readonly<Partial<Record<Seat, readonly TileKind[]>>>;
}

/** The public view plus exactly one seat's private information. */
export interface PrivatePlayerView extends PublicGameView {
  readonly me: Seat;
  readonly concealed: readonly TileKind[];
  readonly drawn: TileKind | null;
  readonly legal: LegalActions;
}

export function publicView(state: HandState): PublicGameView {
  const players = state.players.map(
    (p): PublicPlayerView => ({
      seat: p.seat,
      seatWind: p.seatWind,
      concealedCount: p.concealed.length,
      melds: p.melds,
      bonus: p.bonus,
      discards: p.discards,
      exchanged: state.exchanges[p.seat] !== undefined,
      responded: state.claims[p.seat] !== undefined,
    }),
  ) as unknown as PublicGameView['players'];
  const revealed: Partial<Record<Seat, readonly TileKind[]>> = {};
  if (state.phase === 'finished') for (const s of SEATS) revealed[s] = state.players[s].concealed;
  return {
    rulesetId: state.rulesetId,
    progress: state.progress,
    dealer: state.dealer,
    dealerStreak: state.dealerStreak,
    handKind: state.handKind,
    phase: state.phase,
    preplayStep: state.preplayStep,
    wallRemaining: state.wall.live.length,
    deadRemaining: state.wall.dead.length,
    players,
    turn: state.turn,
    lastDiscard: state.lastDiscard,
    afterKong: state.afterKong,
    discardCount: state.discardCount,
    seq: state.seq,
    result: state.result,
    revealed,
  };
}

/** The view for one seat: public state plus that seat's tiles and legal actions. */
export function viewFor(state: HandState, ruleset: Ruleset, seat: Seat): PrivatePlayerView {
  const p = state.players[seat];
  return {
    ...publicView(state),
    me: seat,
    concealed: p.concealed,
    drawn: state.turn === seat ? state.drawn : null,
    legal: legalActions(state, ruleset, seat),
  };
}
