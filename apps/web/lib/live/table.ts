import { IllegalAction, SEATS, analysisBot, legalActions, nextHand, reduce, startHand, viewFor, type Action, type HandState, type Ruleset, type Seat } from '@society/engine';
import { isBot, isHuman, type ClientAction, type Deadlines, type LiveGame, type Seats, type TimerPolicy } from './types';

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

/**
 * Play every bot decision and every forced human response until a human has a
 * real decision to make or the hand is over.
 */
export function settle(state: HandState, ruleset: Ruleset, seats: Seats): HandState {
  let s = state;
  for (let i = 0; i < MAX_BOT_STEPS; i++) {
    const next = settleOnce(s, ruleset, seats);
    if (next === null) return s;
    s = next;
  }
  throw new Error('settle: bots did not reach a human decision');
}

/** One forced or bot move, or null when the table is waiting on a human. */
function settleOnce(s: HandState, ruleset: Ruleset, seats: Seats): HandState | null {
  if (s.phase === 'finished') return null;

  if (s.phase === 'preplay') {
    for (const seat of SEATS) {
      if (!isBot(seats, seat)) continue;
      const a = analysisBot(viewFor(s, ruleset, seat), ruleset);
      if (a && a.type === 'exchange') return reduce(s, a, ruleset);
    }
    return null;
  }

  if (s.phase === 'claim') {
    for (const seat of SEATS) {
      const legal = legalActions(s, ruleset, seat);
      if (!legal.claims) continue; // discarder, or already responded
      if (isBot(seats, seat)) {
        const a = analysisBot(viewFor(s, ruleset, seat), ruleset) ?? { type: 'pass', seat };
        return reduce(s, a, ruleset);
      }
      // A human with nothing to claim is not asked; the engine still wants the pass.
      if (legal.claims.length === 0) return reduce(s, { type: 'pass', seat }, ruleset);
    }
    return null;
  }

  // turn
  if (isBot(seats, s.turn)) {
    const a = analysisBot(viewFor(s, ruleset, s.turn), ruleset);
    if (!a) throw new Error(`bot at seat ${s.turn} has no move`);
    return reduce(s, a, ruleset);
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

export function deadlinesFor(state: HandState, ruleset: Ruleset, seats: Seats, policy: TimerPolicy, now: number): Deadlines {
  const pending = humansPending(state, ruleset, seats);
  if (pending.length === 0) return { claim: null, turn: null };
  if (state.phase === 'claim') return { claim: now + policy.claimSeconds * 1000, turn: null };
  return { claim: null, turn: now + policy.turnSeconds * 1000 };
}

/**
 * Resolve deadlines that have passed. An expired claim window is a pass for
 * everyone who did not answer; an expired turn (or exchange) is played by a
 * bot standing in for the absent human, so the table moves on.
 */
export function resolveExpired(game: LiveGame, ruleset: Ruleset, seats: Seats, now: number): HandState | null {
  const { state, deadlines } = game;
  if (deadlines.claim !== null && now >= deadlines.claim && state.phase === 'claim') {
    let s = state;
    for (const seat of humansPending(s, ruleset, seats)) {
      if (s.phase !== 'claim') break;
      s = reduce(s, { type: 'pass', seat }, ruleset);
    }
    return s;
  }
  if (deadlines.turn !== null && now >= deadlines.turn && (state.phase === 'turn' || state.phase === 'preplay')) {
    let s = state;
    for (const seat of humansPending(s, ruleset, seats)) {
      const a = analysisBot(viewFor(s, ruleset, seat), ruleset);
      if (a) s = reduce(s, a, ruleset);
    }
    return s;
  }
  return null;
}

export interface StepInput {
  readonly game: LiveGame;
  readonly ruleset: Ruleset;
  readonly seats: Seats;
  readonly policy: TimerPolicy;
  readonly now: number;
  /** the caller's action, already checked to be for their own seat; omit for a sweep */
  readonly action?: ClientAction;
  readonly actor?: Seat;
  /** the game's seed, needed only to deal the next hand */
  readonly seed?: string;
}

export interface StepResult extends LiveGame {
  /** true when the state changed at all, so a sweep with nothing to do writes nothing */
  readonly changed: boolean;
  /** the hand ended and no next hand exists: the game is over */
  readonly gameOver: boolean;
}

/**
 * One request against the table. Order matters: expired deadlines resolve
 * first, so an action sent after a window closed is judged against the table
 * as it now stands (and may be rejected as not the caller's move).
 */
export function step(input: StepInput): StepResult {
  const { ruleset, seats, policy, now } = input;
  let s = input.game.state;
  let changed = false;

  const expired = resolveExpired(input.game, ruleset, seats, now);
  if (expired) {
    s = settle(expired, ruleset, seats);
    changed = true;
  }

  let gameOver = false;
  if (input.action) {
    if (input.action.type === 'nextHand') {
      if (s.phase !== 'finished') throw new IllegalAction('hand not finished');
      if (input.seed === undefined) throw new Error('nextHand needs the seed');
      const n = nextHand(s, ruleset);
      if (n === null) gameOver = true;
      else s = settle(startHand(ruleset, { seed: input.seed, ...n }), ruleset, seats);
    } else {
      if (input.actor === undefined || input.action.seat !== input.actor) throw new NotYourMove('action is not for your seat');
      if (!isHuman(seats, input.actor)) throw new NotYourMove('that seat is a bot');
      s = settle(reduce(s, input.action, ruleset), ruleset, seats);
    }
    changed = true;
  } else if (!expired) {
    // A sweep or a first load: still make sure nothing is waiting on a bot.
    const settled = settle(s, ruleset, seats);
    if (settled !== s) {
      s = settled;
      changed = true;
    }
  }

  const deadlines = changed || gameOver ? deadlinesFor(s, ruleset, seats, policy, now) : input.game.deadlines;
  return { state: s, deadlines, changed, gameOver };
}

/** A fresh hand for a game, with bots already played up to the first human decision. */
export function dealFirstHand(ruleset: Ruleset, seats: Seats, seed: string, policy: TimerPolicy, now: number): LiveGame {
  const state = settle(startHand(ruleset, { seed, progress: { roundWind: 'E', roundIndex: 0, handInRound: 0, handIndex: 0 }, dealer: 0 }), ruleset, seats);
  return { state, deadlines: deadlinesFor(state, ruleset, seats, policy, now) };
}

/** Whether `action` is one this seat may send at all (shape check; the engine judges legality). */
export function actionIsForSeat(action: ClientAction, seat: Seat): boolean {
  return action.type === 'nextHand' || action.seat === seat;
}

/** Reasons a table rejects a request, mapped to HTTP status by the route. */
export function rejectionStatus(err: unknown): number | null {
  if (err instanceof NotYourMove) return 403;
  if (err instanceof IllegalAction) return 400;
  return null;
}

export type { Action };
