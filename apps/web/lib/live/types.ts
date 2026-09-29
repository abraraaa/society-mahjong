import type { Action, HandState, Seat } from '@society/engine';
// Type-only, and table-state.ts imports Seats back the same way: a cycle TypeScript erases.
import type { TableState } from './table-state';

/** Where a room is in its life: waiting for people, at the table, or between games. */
export type RoomStatus = 'lobby' | 'playing' | 'finished';

/**
 * Who is in a seat. Bots are seats too, so the engine never has to know the
 * difference. A person's `since` is when they sat down (ISO), which says who
 * has sat longest when the host's powers pass on (seating.ts hostOf); a seat
 * without one counts as the longest held.
 *
 * A bot may be keeping the seat for someone (`heldFor`, their id, and
 * `keptName`, their name, since they aren't seated anywhere it could be read
 * from): someone who left the table mid-game (`kept: 'left'`), or who wasn't
 * here when the game was dealt (`kept: 'late'`). They're offered it first
 * when they come back (seating.ts seatOffer, seatJoiner).
 *
 * A person given the seat of someone who wasn't here, between games (R18's
 * last step), carries that person's id (`displaced`) until they're seated
 * again, leave, or the game is dealt: how the lobby tells someone whose seat
 * was taken from someone who got up (rooms.ts joinRoom's rejoin). It never
 * leaves the server.
 */
export type SeatEntry =
  | { readonly kind: 'human'; readonly userId: string; readonly name: string; readonly since?: string; readonly displaced?: string }
  | { readonly kind: 'bot'; readonly name: string; readonly heldFor?: string; readonly keptName?: string; readonly kept?: 'left' | 'late' }
  | null;
export type Seats = readonly [SeatEntry, SeatEntry, SeatEntry, SeatEntry];

/** How long humans get. Bots act inline and never wait. */
export interface TimerPolicy {
  readonly claimSeconds: number;
  readonly turnSeconds: number;
}

/** Epoch milliseconds, or null when nothing is waiting on a human. */
export interface Deadlines {
  readonly claim: number | null;
  readonly turn: number | null;
}

export interface LiveGame {
  readonly state: HandState;
  readonly deadlines: Deadlines;
  /** the table's own bookkeeping (live_state.table_state); a fresh table when omitted, as for a game just dealt */
  readonly tableState?: TableState;
}

/**
 * The engine actions a player may send for their own seat. This is an
 * allowlist on purpose: `resolveClaims` is the server's own move and never a
 * client's, and any action the engine grows later stays server-only until
 * it is added here.
 */
export const PLAYER_ACTION_TYPES = ['exchange', 'discard', 'declareKong', 'declareWin', 'claim', 'pass'] as const satisfies readonly Action['type'][];

/**
 * What a client may send: an engine action for its own seat, or a tap of Next hand on a finished hand. The tap names the
 * hand it was made on (`hand`, its index), so the table can count it as a vote whatever else has saved since; a page
 * loaded before votes existed sends none, and its tap is judged against the version it saw, as any move is.
 */
export type ClientAction = Extract<Action, { type: (typeof PLAYER_ACTION_TYPES)[number] }> | { readonly type: 'nextHand'; readonly hand?: number };

export const CLIENT_ACTION_TYPES: readonly ClientAction['type'][] = [...PLAYER_ACTION_TYPES, 'nextHand'];

/** Why a bot is playing a seat whose person is still seated: two clocks ran out, the host handed it over, or they're taking a break. */
export type AwayReason = 'clock' | 'host' | 'self';

/** How a game ended: its last hand was scored, the host ended it, nobody played it for hours, or everyone left. */
export type GameEndHow = 'complete' | 'host' | 'idle' | 'abandoned';

/**
 * A request to end the game before its last hand is scored, built by the
 * server only and never parsed from a body: the host ending it (`host`, by
 * them), nobody having played it for hours (`idle`, by nobody), or the last
 * person leaving (`abandoned`, by nobody). A game whose last hand is scored
 * ends by itself, in the step that scores it, and an end that reaches a
 * finished last hand records it as `complete` all the same.
 */
export interface GameEnd {
  readonly how: 'host' | 'idle' | 'abandoned';
  readonly by: { readonly userId: string; readonly name: string } | null;
}

/**
 * A change to who plays a seat, built by the server only and never parsed
 * from a body (service.ts changeSeat, noteTakeOver): the seat's own person is
 * back (`back`); whoever has the host's powers (`bySeat`) hands another
 * person's seat to a bot (`letBotPlay`), as long as that person hasn't tapped
 * since the host's table was sent: judged by the version of the table the
 * host was looking at (`sawVersion`) against the one that saved the tap, and
 * only for a tap saved without one, or a page that sends none, by the
 * server's clock on the host's table (`sawAt`); the seat's person has just
 * taken it over from a bot mid-game (`took`), which the table notes with the
 * hand and the moment they took it (table-state.ts TakeOver); or the seat's
 * own person is taking a break (`break`), and a bot plays their tiles until
 * they're back.
 */
export type SeatChange =
  | { readonly type: 'back'; readonly seat: Seat }
  | { readonly type: 'letBotPlay'; readonly seat: Seat; readonly bySeat: Seat; readonly sawAt: number | null; readonly sawVersion?: number | null }
  | { readonly type: 'took'; readonly seat: Seat }
  | { readonly type: 'break'; readonly seat: Seat };

/**
 * Who made a move, as the hand log records it: the seat's own person, by
 * request (`player`); a bot in its seat (`bot`); a stand-in when that
 * person's clock ran out (`clock`); the bot playing an away seat (`away`);
 * the table itself, such as the pass for someone with nothing to claim
 * (`table`); or the host (`host`).
 */
export type MoveMaker = 'player' | 'bot' | 'clock' | 'away' | 'table' | 'host';

/** Every engine move a seat can make. `resolveClaims` is the engine's own and never logged: a claim window closes itself once everyone has answered. */
export type PlayerMove = Exclude<Action, { type: 'resolveClaims' }>;

/** A line in the hand log that isn't an engine move, so a hand's log explains every bot move in it. Replay skips these. */
export type TableNote = { readonly type: 'away'; readonly reason: AwayReason } | { readonly type: 'back' } | { readonly type: 'endGame'; readonly how: GameEndHow };

/** The `type` of every table note. Everything else in a log entry's `a` is an engine move. */
const TABLE_NOTE_TYPES = ['away', 'back', 'endGame'] as const satisfies readonly TableNote['type'][];

/** A move as step() makes it. `seat` is absent only on a game's end; `userId` is only on 'player' and 'host' moves. */
export interface Move {
  readonly by: MoveMaker;
  readonly seat?: Seat;
  readonly userId?: string;
  readonly a: PlayerMove | TableNote;
}

/** One entry in hands.actions: the move, stamped with the live_state version its request produced. */
export interface LoggedMove extends Move {
  readonly v: number;
}

/** Whether a log entry's `a` is an engine move (replay plays it) rather than a table note (replay skips it). */
export function isPlayerMove(a: PlayerMove | TableNote): a is PlayerMove {
  return !(TABLE_NOTE_TYPES as readonly string[]).includes(a.type);
}

/** Whether `type` names a move a client may make at all (the shape is checked in validate.ts, legality by the engine). */
export function isClientActionType(type: unknown): type is ClientAction['type'] {
  return (CLIENT_ACTION_TYPES as readonly unknown[]).includes(type);
}

/** Seat index of a user, or null when they are not seated. */
export function seatOf(seats: Seats, userId: string): Seat | null {
  const i = seats.findIndex((s) => s?.kind === 'human' && s.userId === userId);
  return i < 0 ? null : (i as Seat);
}

export function isBot(seats: Seats, seat: Seat): boolean {
  return seats[seat]?.kind === 'bot';
}

export function isHuman(seats: Seats, seat: Seat): boolean {
  return seats[seat]?.kind === 'human';
}
