import {
  IllegalAction,
  SEATS,
  analysisBot,
  createRng,
  legalActions,
  nextHand,
  reduce,
  startHand,
  viewFor,
  type Action,
  type BotOptions,
  type HandState,
  type Ruleset,
  type Seat,
} from '@society/engine';
import { addHandScores, endOfGame, isLastHand } from './lifecycle';
import { NEW_TABLE, sameTableState, type TableState } from './table-state';
import {
  isBot,
  isClientActionType,
  isHuman,
  type ClientAction,
  type Deadlines,
  type GameEnd,
  type LiveGame,
  type Move,
  type PlayerMove,
  type Seats,
  type TimerPolicy,
} from './types';

/**
 * The authoritative table, as pure functions over the engine's HandState.
 *
 * A route handler loads the live state, calls `step` with the caller's action
 * (or none, for a deadline sweep), and stores what comes back. Everything
 * that is not a human decision happens inside `step`: bots take their turns,
 * claim windows nobody can use close at once, and expired deadlines resolve
 * before the new action is applied, so a stale table never wedges a game.
 */

/** Bot turns per step before we assume the engine is looping. A hand is well under this. */
const MAX_BOT_STEPS = 600;

export class NotYourMove extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotYourMove';
  }
}

/** The game has ended (table_state.over is set): the table takes no more moves and no second end. */
export class GameIsOver extends Error {
  constructor() {
    super('game is over');
    this.name = 'GameIsOver';
  }
}

/** How the table plays the seats nobody sits in. */
export interface TableSetup {
  /** the bots in empty seats: `gentle` while anyone at the table is still new (policy.ts emptySeatBots); sharp when omitted */
  readonly bots?: 'sharp' | 'gentle';
}

/**
 * The randomness a gentle bot's fumbles come from, for one seat's decision.
 * Seeded from the game's seed and where the hand stands, so the same request
 * always plays out the same way: `step` stays a pure function, a retried save
 * replays identically, and the seed itself never leaves the server.
 */
export function decisionRandom(state: HandState, seat: Seat): () => number {
  return createRng(`${state.seed}:bot:${state.progress.handIndex}:${state.seq}:${state.preplayStep}:${seat}`).next;
}

/** A bot in an empty seat: the analysis straight, or gently on this decision's own seeded randomness. */
function botOptions(s: HandState, seat: Seat, setup: TableSetup | undefined): BotOptions {
  return setup?.bots === 'gentle' ? { strength: 'gentle', random: decisionRandom(s, seat) } : {};
}

/** A move the table makes on the engine: always an engine move, never a table note. */
type EngineMove = Move & { readonly a: PlayerMove };

/** An engine move the table is about to make. The table never closes a claim window by hand: it closes itself once everyone has answered. */
function engineMove(a: Action): PlayerMove {
  if (a.type === 'resolveClaims') throw new Error('the table never sends resolveClaims');
  return a;
}

/**
 * Play every bot decision and every forced human response until a human has a
 * real decision to make or the hand is over.
 */
export function settle(state: HandState, ruleset: Ruleset, seats: Seats, setup?: TableSetup): HandState {
  return settleLogged(state, ruleset, seats, setup).state;
}

/** `settle`, with the moves it made in the order it made them. Nothing to play gives back `state` itself and no moves. */
function settleLogged(state: HandState, ruleset: Ruleset, seats: Seats, setup: TableSetup | undefined): { readonly state: HandState; readonly moves: readonly EngineMove[] } {
  let s = state;
  const moves: EngineMove[] = [];
  for (let i = 0; i < MAX_BOT_STEPS; i++) {
    const m = forcedMove(s, ruleset, seats, setup);
    if (m === null) return { state: s, moves };
    s = reduce(s, m.a, ruleset);
    moves.push(m);
  }
  throw new Error('settle: bots did not reach a human decision');
}

/** The next forced or bot move, or null when the table is waiting on a human. */
function forcedMove(s: HandState, ruleset: Ruleset, seats: Seats, setup: TableSetup | undefined): EngineMove | null {
  if (s.phase === 'finished') return null;

  if (s.phase === 'preplay') {
    for (const seat of SEATS) {
      if (!isBot(seats, seat)) continue;
      const a = analysisBot(viewFor(s, ruleset, seat), ruleset, botOptions(s, seat, setup));
      if (a && a.type === 'exchange') return { by: 'bot', seat, a };
    }
    return null;
  }

  if (s.phase === 'claim') {
    for (const seat of SEATS) {
      const legal = legalActions(s, ruleset, seat);
      if (!legal.claims) continue; // discarder, or already responded
      if (isBot(seats, seat)) return { by: 'bot', seat, a: engineMove(analysisBot(viewFor(s, ruleset, seat), ruleset, botOptions(s, seat, setup)) ?? { type: 'pass', seat }) };
      // A human with nothing to claim is not asked; the engine still wants the pass.
      if (legal.claims.length === 0) return { by: 'table', seat, a: { type: 'pass', seat } };
    }
    return null;
  }

  // turn
  if (isBot(seats, s.turn)) {
    const a = analysisBot(viewFor(s, ruleset, s.turn), ruleset, botOptions(s, s.turn, setup));
    if (!a) throw new Error(`bot at seat ${s.turn} has no move`);
    return { by: 'bot', seat: s.turn, a: engineMove(a) };
  }
  return null;
}

/** Seats with a human who still owes the table a response in this phase. */
function humansPending(s: HandState, ruleset: Ruleset, seats: Seats): Seat[] {
  if (s.phase === 'claim') return SEATS.filter((seat) => isHuman(seats, seat) && legalActions(s, ruleset, seat).claims !== undefined);
  if (s.phase === 'preplay') return SEATS.filter((seat) => isHuman(seats, seat) && legalActions(s, ruleset, seat).exchange !== undefined);
  if (s.phase === 'turn') return isHuman(seats, s.turn) ? [s.turn] : [];
  return [];
}

/** Whether any human still to answer this window was offered the win. */
function winOffered(state: HandState, ruleset: Ruleset, pending: readonly Seat[]): boolean {
  return pending.some((seat) => legalActions(state, ruleset, seat).claims?.some((c) => c.type === 'win') ?? false);
}

export function deadlinesFor(state: HandState, ruleset: Ruleset, seats: Seats, policy: TimerPolicy, now: number): Deadlines {
  const pending = humansPending(state, ruleset, seats);
  if (pending.length === 0) return { claim: null, turn: null };
  if (state.phase === 'claim') {
    // A winning tile runs on the turn clock, not the claim clock. Twenty
    // seconds is enough to take a pung; it is not enough for a first-timer
    // to read "Mahjong!" and believe it, and a win lost to the clock is the
    // one thing a table must never do to someone.
    const seconds = winOffered(state, ruleset, pending) ? policy.turnSeconds : policy.claimSeconds;
    return { claim: now + seconds * 1000, turn: null };
  }
  return { claim: null, turn: now + policy.turnSeconds * 1000 };
}

/**
 * Resolve deadlines that have passed. Whatever a human did not answer in time
 * is decided by a bot standing in for them, in a claim window as in a turn:
 * it takes a win they were offered, claims a set only when that brings their
 * hand closer, and passes on the rest, so the table moves on and an absent
 * player's Mahjong is not thrown away. It is their hand and their points, so
 * the stand-in always plays sharp, however gently the empty seats' bots do.
 */
export function resolveExpired(game: LiveGame, ruleset: Ruleset, seats: Seats, now: number): HandState | null {
  return resolveExpiredWith(game, ruleset, seats, now)?.state ?? null;
}

/** A move a bot made on an absent human's behalf, so the table can tell them. */
export interface StandIn {
  readonly seat: Seat;
  readonly action: Action;
}

function resolveExpiredWith(game: LiveGame, ruleset: Ruleset, seats: Seats, now: number): { state: HandState; standIns: StandIn[]; moves: EngineMove[] } | null {
  const { state, deadlines } = game;
  const standIns: StandIn[] = [];
  const moves: EngineMove[] = [];
  if (deadlines.claim !== null && now >= deadlines.claim && state.phase === 'claim') {
    let s = state;
    for (const seat of humansPending(s, ruleset, seats)) {
      if (s.phase !== 'claim') break;
      const a = engineMove(analysisBot(viewFor(s, ruleset, seat), ruleset) ?? { type: 'pass' as const, seat });
      s = reduce(s, a, ruleset);
      standIns.push({ seat, action: a });
      moves.push({ by: 'clock', seat, a });
    }
    return { state: s, standIns, moves };
  }
  if (deadlines.turn !== null && now >= deadlines.turn && (state.phase === 'turn' || state.phase === 'preplay')) {
    let s = state;
    for (const seat of humansPending(s, ruleset, seats)) {
      const found = analysisBot(viewFor(s, ruleset, seat), ruleset);
      if (!found) continue;
      const a = engineMove(found);
      s = reduce(s, a, ruleset);
      standIns.push({ seat, action: a });
      moves.push({ by: 'clock', seat, a });
    }
    return { state: s, standIns, moves };
  }
  return null;
}

export interface StepInput {
  readonly game: LiveGame;
  readonly ruleset: Ruleset;
  readonly seats: Seats;
  readonly policy: TimerPolicy;
  readonly now: number;
  /** the caller's action, already validated by parseClientAction; omit for a sweep */
  readonly action?: ClientAction;
  readonly actor?: Seat;
  /** the game's seed, needed only to deal the next hand */
  readonly seed?: string;
  /** how the bots in empty seats play (policy.ts emptySeatBots); sharp when omitted */
  readonly bots?: 'sharp' | 'gentle';
  /** end the game here, before its last hand is scored (the last person leaving); never with an action */
  readonly end?: GameEnd;
}

export interface StepResult extends LiveGame {
  /** the table's bookkeeping after this step: the input's, or a fresh table's, with a hand won in this step added to the running scores, and how the game ended once it has */
  readonly tableState: TableState;
  /** true when the state or the table's bookkeeping changed at all, so a sweep with nothing to do writes nothing */
  readonly changed: boolean;
  /** the game ended in this step: `tableState.over` is newly set */
  readonly gameOver: boolean;
  /** every move this step made, in the order it made them, for the hand log (hand-log.ts stamps them). Every one belongs to `state`'s hand. */
  readonly moves: readonly Move[];
  /** this step dealt a new hand: the hand index went up */
  readonly dealt: boolean;
  /** a hand went from live to finished in this step, so its result is new */
  readonly finishedHand: boolean;
  /** moves made for absent humans by expired clocks in this step */
  readonly standIns: readonly StandIn[];
}

/**
 * One request against the table. Order matters: expired deadlines resolve
 * first, so an action sent after a window closed is judged against the table
 * as it now stands (and may be rejected as not the caller's move). The one
 * exception is "next hand", which needs the hand the sender saw to be over.
 *
 * Every move the step makes is logged in `moves`, by whoever made it, so the
 * hand's seed and its log replay to the same table (hand-log.ts replayHand).
 * A deal happens before any move in its step, and a finished hand has no
 * clock, so all of one step's moves belong to the hand it returns.
 *
 * The table's bookkeeping (`game.tableState`) comes back as `tableState`:
 * the same document, unless a hand finished here, when a win's points are
 * added to its running scores, or the game ended here. A step finishes at
 * most one hand, the one it returns: a deal needs the hand before it over,
 * and it plays on from there.
 *
 * The game ends in the step that ends it (R12), with `tableState.over` set:
 * when its last hand is scored, however that happened (a move, a clock, the
 * bots), with no tap needed; or on `end`. From then on every action and end
 * is refused with GameIsOver, a step with neither changes nothing, and no
 * clock runs.
 */
export function step(input: StepInput): StepResult {
  const { ruleset, seats, policy, now } = input;
  const setup: TableSetup = input.bots ? { bots: input.bots } : {};
  const tableBefore = input.game.tableState ?? NEW_TABLE;
  const before = input.game.state;
  if (input.action && input.end) throw new Error('a step takes an action or an end, not both');
  if (tableBefore.over) {
    if (input.action || input.end) throw new GameIsOver();
    return { ...input.game, tableState: tableBefore, changed: false, gameOver: false, moves: [], dealt: false, finishedHand: false, standIns: [] };
  }
  // A hand that ends inside this step, its clock run out, must be recorded as it closes, never dealt over. A finished
  // hand has no clock to resolve, so this refuses nothing the client offers.
  if (input.action?.type === 'nextHand' && before.phase !== 'finished') throw new IllegalAction('hand not finished');
  let s = before;
  let table = tableBefore;
  let changed = false;
  let finishedHand = false;
  const moves: Move[] = [];

  // After every settle: a hand that has just finished puts a win's points on the running scores, and when it was the
  // game's last, the game is over (the natural end), in the same step, before anything else in it can happen.
  const noteFinish = () => {
    if (finishedHand || s.phase !== 'finished') return;
    // A dealt hand starts live, so a hand finished in the step that dealt it is newly finished too.
    if (s.progress.handIndex === before.progress.handIndex && before.phase === 'finished') return;
    finishedHand = true;
    const scores = addHandScores(table.scores ?? [0, 0, 0, 0], s);
    if (scores !== table.scores) table = { ...table, scores };
    if (!table.over && isLastHand(s, ruleset)) table = { ...table, over: endOfGame('complete', s, table, seats, null, now) };
  };

  const expired = resolveExpiredWith(input.game, ruleset, seats, now);
  if (expired) {
    const settled = settleLogged(expired.state, ruleset, seats, setup);
    s = settled.state;
    moves.push(...expired.moves, ...settled.moves);
    changed = true;
    noteFinish();
  }

  if (input.end) {
    // A clock that ran out above may have scored the last hand already, and a game ends only once.
    if (!table.over) {
      const { how, by } = input.end;
      table = { ...table, over: endOfGame(how, s, table, seats, by, now) };
      // Logged only on a live hand, so its log says why nobody moved after this; a finished hand's log is complete.
      if (s.phase !== 'finished') moves.push({ by: by ? 'host' : 'table', ...(by ? { userId: by.userId } : {}), a: { type: 'endGame', how } });
    }
  } else if (input.action) {
    // The route validates what a client sends, but the table does not rely on
    // it: a server-only move (resolveClaims closes everyone's claim window at
    // once) is never a player's to make, whichever seat it names.
    if (!isClientActionType((input.action as { readonly type: unknown }).type)) throw new NotYourMove('only the table makes that move');
    if (input.action.type === 'nextHand') {
      if (s.phase !== 'finished') throw new IllegalAction('hand not finished');
      const n = nextHand(s, ruleset);
      if (n === null) {
        // A finished last hand the natural end never saw (saved before it existed): the tap ends the game.
        table = { ...table, over: endOfGame('complete', s, table, seats, null, now) };
      } else {
        if (input.seed === undefined) throw new Error('nextHand needs the seed');
        const dealt = settleLogged(startHand(ruleset, { seed: input.seed, ...n }), ruleset, seats, setup);
        s = dealt.state;
        moves.push(...dealt.moves);
        noteFinish();
      }
    } else {
      if (input.actor === undefined || input.action.seat !== input.actor) throw new NotYourMove('action is not for your seat');
      const entry = seats[input.actor];
      if (entry?.kind !== 'human') throw new NotYourMove('that seat is a bot');
      const settled = settleLogged(reduce(s, input.action, ruleset), ruleset, seats, setup);
      s = settled.state;
      moves.push({ by: 'player', seat: input.actor, userId: entry.userId, a: input.action }, ...settled.moves);
      noteFinish();
    }
    changed = true;
  } else if (!expired) {
    // A sweep or a first load: still make sure nothing is waiting on a bot.
    const settled = settleLogged(s, ruleset, seats, setup);
    if (settled.state !== s) {
      s = settled.state;
      moves.push(...settled.moves);
      changed = true;
      noteFinish();
    }
  }

  const dealt = s.progress.handIndex > before.progress.handIndex;
  // Anything new in the table's bookkeeping is a change too: the running scores, or the game's end.
  if (!sameTableState(table, tableBefore)) changed = true;
  // A game that's over waits on nobody.
  const deadlines = table.over ? { claim: null, turn: null } : changed ? deadlinesFor(s, ruleset, seats, policy, now) : input.game.deadlines;
  const gameOver = table.over !== null;
  return { state: s, deadlines, tableState: table, changed, gameOver, moves, dealt, finishedHand, standIns: expired?.standIns ?? [] };
}

/** A fresh hand for a game, with bots already played up to the first human decision, and the moves they made. */
export function dealFirstHand(ruleset: Ruleset, seats: Seats, seed: string, policy: TimerPolicy, now: number, setup?: TableSetup): LiveGame & { readonly moves: readonly Move[] } {
  const { state, moves } = settleLogged(startHand(ruleset, { seed, progress: { roundWind: 'E', roundIndex: 0, handInRound: 0, handIndex: 0 }, dealer: 0 }), ruleset, seats, setup);
  return { state, deadlines: deadlinesFor(state, ruleset, seats, policy, now), moves };
}

/** Whether `action` is one this seat may send at all (shape check; the engine judges legality). */
export function actionIsForSeat(action: ClientAction, seat: Seat): boolean {
  if (!isClientActionType((action as { readonly type: unknown }).type)) return false;
  return action.type === 'nextHand' || action.seat === seat;
}

/** Reasons a table rejects a request, mapped to HTTP status by the route. */
export function rejectionStatus(err: unknown): number | null {
  if (err instanceof NotYourMove) return 403;
  if (err instanceof IllegalAction) return 400;
  if (err instanceof GameIsOver) return 409;
  return null;
}

export type { Action };
