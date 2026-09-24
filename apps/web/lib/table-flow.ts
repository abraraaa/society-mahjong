import { reduce, viewFor, type Action, type HandState, type LegalActions, type PrivatePlayerView, type Ruleset, type Seat, type TileKind } from '@society/engine';

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

/**
 * How long the table ignores taps after a hand starts or ends. A double tap on
 * Next hand closes the result sheet with its first tap, and the second then
 * lands on whatever the new hand has put in the same spot: a tile, or the
 * Discard button with the tutor's pick on it. The second tap of a double tap
 * comes well inside this; nobody reads a new hand and taps it faster.
 */
export const SETTLE_MS = 400;

/** What changes at a hand boundary: a new hand dealt, or this one finishing. The table's grace period starts again whenever it does. */
export function handBoundary(view: Pick<PrivatePlayerView, 'progress' | 'phase'>): string {
  return `${view.progress.handIndex}:${view.phase === 'finished' ? 'over' : 'on'}`;
}

/** Whether a tap at `now` comes too soon after the hand boundary at `since` to be meant for what's on the table now. */
export function settling(since: number, now: number, grace = SETTLE_MS): boolean {
  return now - since < grace;
}

/**
 * A move that's always open to the seat whose view this is, whatever its
 * tiles: the first tiles in hand for an exchange, a pass in a claim window,
 * the first tile it may discard on its turn. Null when the table isn't waiting
 * on this seat.
 */
export function alwaysLegalMove(view: Pick<PrivatePlayerView, 'me' | 'legal' | 'concealed'>): Action | null {
  const { legal, me: seat } = view;
  if (legal.exchange) return { type: 'exchange', seat, tiles: view.concealed.slice(0, legal.exchange.count) };
  if (legal.pass) return { type: 'pass', seat };
  const tile = legal.discard?.[0];
  return tile === undefined ? null : { type: 'discard', seat, tile };
}

/** A move the engine turned down at the solo table, and what was played instead. */
export interface Refusal {
  readonly seat: Seat;
  /** what was chosen for the seat, or null when nothing was, though the table was waiting on it */
  readonly tried: Action | null;
  readonly instead: Action;
  /** the engine's reason */
  readonly why: string;
}

/**
 * One move for each of `seats` that the table is waiting on, at the solo
 * table: the move `choose` picks from that seat's view, or, when the engine
 * turns it down (a bot bug, say), the always-legal move instead, with the
 * refusal handed to `refused` so someone hears about it. A bug in a bot slows
 * the table down but never freezes it. Throws if a seat was due to move and
 * even so nothing moved, since the table would otherwise sit there for good
 * without a word; the error page says so and sends word.
 */
export function playFor(
  state: HandState,
  seats: readonly Seat[],
  ruleset: Ruleset,
  choose: (view: PrivatePlayerView) => Action | null,
  refused: (refusal: Refusal) => void,
): HandState {
  let s = state;
  let due = false;
  for (const seat of seats) {
    if (s.phase === 'finished') break;
    const view = viewFor(s, ruleset, seat);
    const instead = alwaysLegalMove(view);
    if (!instead) continue; // nothing for this seat to do
    due = true;
    const tried = choose(view);
    let why = 'nothing was chosen';
    if (tried) {
      try {
        s = reduce(s, tried, ruleset);
        continue;
      } catch (err) {
        why = err instanceof Error ? err.message : String(err);
      }
    }
    refused({ seat, tried, instead, why });
    s = tryReduce(s, instead, ruleset) ?? s;
  }
  if (due && s === state) throw new Error(`the solo table stalled: no move for seats ${seats.join(', ')} was taken`);
  return s;
}

/** A refusal as one line for the crash log. Tiles and seats only: a solo table has nothing private in it. */
export function refusalMessage(r: Refusal): string {
  const move = (a: Action) => (a.type === 'discard' ? `discard ${a.tile}` : a.type);
  const what = r.tried === null ? `seat ${r.seat} chose no move though one was due` : `seat ${r.seat}'s ${move(r.tried)} was refused (${r.why})`;
  return `solo table: ${what}, so it played ${move(r.instead)} instead`;
}
