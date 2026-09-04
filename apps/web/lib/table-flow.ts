import type { HandState, LegalActions, Seat } from '@society/engine';

/**
 * Whose move the solo table is waiting on, from the local seat's legal actions.
 *
 * - `mine`      — the player has a real decision (discard, claim, exchange, win)
 * - `auto-pass` — a claim window is open but the player holds nothing claimable;
 *                 the engine still needs their pass, so the table gives it
 * - `bots`      — nothing for the player to do; let the bots act
 * - `over`      — the hand is finished
 *
 * `auto-pass` is what stops a bot's discard from freezing the table when
 * another bot can claim it and the player cannot: `legalActions` reports
 * `claims: []` then, which is not a decision but is also not nothing.
 */
export type TableFlow = 'mine' | 'auto-pass' | 'bots' | 'over';

export function tableFlow(state: HandState, legal: LegalActions, seat: Seat): TableFlow {
  if (state.phase === 'finished') return 'over';
  if (state.phase === 'claim' && legal.claims !== undefined && legal.claims.length === 0 && state.claims[seat] === undefined) {
    return 'auto-pass';
  }
  if (legal.discard || legal.claims || legal.exchange || legal.win) return 'mine';
  return 'bots';
}
