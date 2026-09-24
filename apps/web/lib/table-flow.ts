import { reduce, type Action, type HandState, type LegalActions, type PrivatePlayerView, type Ruleset, type Seat, type TileKind } from '@society/engine';

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

/**
 * The engine's reducer with its refusals turned into `null`. The engine throws
 * on a move it will not take (a tile that is not in the hand, a turn that has
 * moved on), and a throw inside a React state update takes the whole page
 * down; the table would rather ignore the tap and keep the hand as it was.
 */
export function tryReduce(state: HandState, action: Action, ruleset: Ruleset): HandState | null {
  try {
    return reduce(state, action, ruleset);
  } catch {
    return null;
  }
}

/** The parts of one seat's view that a lifted tile depends on. */
export type SelectionView = Pick<PrivatePlayerView, 'me' | 'phase' | 'turn' | 'progress' | 'events' | 'concealed' | 'legal'>;

/**
 * A tile the player has lifted from their hand, and the stretch of play it was
 * lifted in. A tile can be lifted while the bots are still moving, well before
 * the player's turn, so the pick has to remember when it was made for the table
 * to know when it has gone stale.
 */
export interface Selection {
  readonly kind: TileKind;
  readonly epoch: string;
}

/**
 * The stretch of play a pick belongs to. It moves on when the hand changes,
 * when the player's discard turn ends (their own discard, or a bot standing in
 * for them) and when the hand finishes, and at no other time, so a tile lifted
 * during the bots' moves is still lifted when the player's turn arrives.
 * Discards are counted from the event log rather than the river because a
 * claimed discard leaves the river.
 */
export function selectionEpoch(view: SelectionView): string {
  const mine = view.events.filter((e) => e.type === 'discarded' && e.seat === view.me).length;
  return `${view.progress.handIndex}:${mine}:${view.phase === 'finished' ? 'over' : 'on'}`;
}

/** Lift `kind` in this view. */
export function selectTile(kind: TileKind, view: SelectionView): Selection {
  return { kind, epoch: selectionEpoch(view) };
}

/**
 * The tile a pick still names in this view, or null once it has outlived it:
 * the hand has changed, the player's discard turn has come and gone, or the
 * tile is no longer in the hand. The table reads the selection only through
 * this, so a pick can never outlive the tile it names.
 */
export function heldSelection(selection: Selection | null, view: SelectionView): TileKind | null {
  if (!selection || selection.epoch !== selectionEpoch(view)) return null;
  return view.concealed.includes(selection.kind) ? selection.kind : null;
}

/** Whether this seat can discard `tile` right now: it is their turn to discard and the tile is in their hand. */
export function canDiscard(view: SelectionView, tile: TileKind): boolean {
  return view.phase === 'turn' && view.turn === view.me && !!view.legal.discard?.includes(tile) && view.concealed.includes(tile);
}

/**
 * The tile the Discard button offers: the player's own pick when it can go,
 * otherwise the tutor's suggestion when that can, otherwise nothing. It never
 * names a tile the player does not hold.
 */
export function discardOffer(view: SelectionView, selected: TileKind | null, suggested: TileKind | null): TileKind | null {
  if (selected !== null && canDiscard(view, selected)) return selected;
  if (suggested !== null && canDiscard(view, suggested)) return suggested;
  return null;
}
