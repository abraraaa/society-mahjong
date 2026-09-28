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
import type { CoachStage } from '../coach/types';
import { EVERYONE_HERE, awaySeats, isAway, markAway, markPresent, noteClockMove, noteHandEnd, notePlayed, presentUserIds, reconcileAbsence } from './absence';
import { addHandScores, endOfGame, everyoneReady, isLastHand, voteNextHand } from './lifecycle';
import { policyFor, presentLevels } from './policy';
import { NEW_TABLE, reconcileTook, sameTableState, withTakeOver, type Absence, type TableState } from './table-state';
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
  type SeatChange,
  type Seats,
  type TimerPolicy,
} from './types';

/**
 * The authoritative table, as pure functions over the engine's HandState.
 *
 * A route handler loads the live state, calls `step` with the caller's action
 * (or none, for a deadline sweep), and stores what comes back. Everything
 * that is not a person's decision happens inside `step`: bots take their
 * turns, a bot plays the tiles of anyone who's away, claim windows nobody can
 * use close at once, and expired deadlines resolve before the new action is
 * applied, so a stale table never wedges a game.
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

/** The host asked a bot to play a seat whose person has tapped since the host's table was sent: they're still at the table (R8). */
export class JustPlayed extends Error {
  constructor() {
    super('that player has just played');
    this.name = 'JustPlayed';
  }
}

/** How the table plays the seats nobody decides for. */
export interface TableSetup {
  /** the bots in empty seats: `gentle` while anyone at the table is still new (policy.ts emptySeatBots); sharp when omitted */
  readonly bots?: 'sharp' | 'gentle';
  /** who's away: a bot plays their seats too, sharply, since it's their hand and their points; everyone's here when omitted */
  readonly absence?: Absence;
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
 * Play every bot decision, every away seat's and every forced human response
 * until a person has a real decision to make or the hand is over.
 */
export function settle(state: HandState, ruleset: Ruleset, seats: Seats, setup?: TableSetup): HandState {
  return settleLogged(state, ruleset, seats, setup).state;
}

/**
 * `settle`, with the moves it made in the order it made them, and the
 * absence with what the bot has played for each away seat added. Nothing to
 * play gives back `state` itself and no moves.
 */
function settleLogged(
  state: HandState,
  ruleset: Ruleset,
  seats: Seats,
  setup: TableSetup | undefined,
): { readonly state: HandState; readonly moves: readonly EngineMove[]; readonly absence: Absence } {
  let s = state;
  let absence = setup?.absence ?? EVERYONE_HERE;
  const moves: EngineMove[] = [];
  for (let i = 0; i < MAX_BOT_STEPS; i++) {
    const m = forcedMove(s, ruleset, seats, setup);
    if (m === null) return { state: s, moves, absence };
    s = reduce(s, m.a, ruleset);
    moves.push(m);
    if (m.by === 'away') absence = notePlayed(absence, m);
  }
  throw new Error('settle: bots did not reach a human decision');
}

/** Who plays a seat without asking anyone: a bot in it, or the bot playing for its away person. Null for a person, who decides. */
function playedBy(s: HandState, seats: Seats, seat: Seat, setup: TableSetup | undefined): { readonly by: 'bot' | 'away'; readonly options: BotOptions } | null {
  if (isBot(seats, seat)) return { by: 'bot', options: botOptions(s, seat, setup) };
  // It's the away person's hand and points, so their bot plays sharply, however gently the empty seats' bots do.
  return isAway(setup?.absence, seats, seat) ? { by: 'away', options: {} } : null;
}

/** The next forced or bot move, or null when the table is waiting on a person. */
function forcedMove(s: HandState, ruleset: Ruleset, seats: Seats, setup: TableSetup | undefined): EngineMove | null {
  if (s.phase === 'finished') return null;

  if (s.phase === 'preplay') {
    for (const seat of SEATS) {
      const player = playedBy(s, seats, seat, setup);
      if (!player) continue;
      const a = analysisBot(viewFor(s, ruleset, seat), ruleset, player.options);
      if (a && a.type === 'exchange') return { by: player.by, seat, a };
    }
    return null;
  }

  if (s.phase === 'claim') {
    for (const seat of SEATS) {
      const legal = legalActions(s, ruleset, seat);
      if (!legal.claims) continue; // discarder, or already responded
      const player = playedBy(s, seats, seat, setup);
      if (player) return { by: player.by, seat, a: engineMove(analysisBot(viewFor(s, ruleset, seat), ruleset, player.options) ?? { type: 'pass', seat }) };
      // A person with nothing to claim is not asked; the engine still wants the pass.
      if (legal.claims.length === 0) return { by: 'table', seat, a: { type: 'pass', seat } };
    }
    return null;
  }

  // turn
  const player = playedBy(s, seats, s.turn, setup);
  if (player) {
    const a = analysisBot(viewFor(s, ruleset, s.turn), ruleset, player.options);
    if (!a) throw new Error(`bot at seat ${s.turn} has no move`);
    return { by: player.by, seat: s.turn, a: engineMove(a) };
  }
  return null;
}

/** Seats with a person (here, not away) who still owes the table a response in this phase. */
function personsPending(s: HandState, ruleset: Ruleset, seats: Seats, absence: Absence | undefined): Seat[] {
  const person = (seat: Seat) => isHuman(seats, seat) && !isAway(absence, seats, seat);
  if (s.phase === 'claim') return SEATS.filter((seat) => person(seat) && legalActions(s, ruleset, seat).claims !== undefined);
  if (s.phase === 'preplay') return SEATS.filter((seat) => person(seat) && legalActions(s, ruleset, seat).exchange !== undefined);
  if (s.phase === 'turn') return person(s.turn) ? [s.turn] : [];
  return [];
}

/** Whether any person still to answer this window was offered the win. */
function winOffered(state: HandState, ruleset: Ruleset, pending: readonly Seat[]): boolean {
  return pending.some((seat) => legalActions(state, ruleset, seat).claims?.some((c) => c.type === 'win') ?? false);
}

/** The clocks for the decision the table is waiting on: persons only, since a bot plays the away seats at once and needs no clock. */
export function deadlinesFor(state: HandState, ruleset: Ruleset, seats: Seats, policy: TimerPolicy, now: number, absence?: Absence): Deadlines {
  const pending = personsPending(state, ruleset, seats, absence);
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
 * Whether two tables wait on the same decision (R7): the same hand, phase,
 * event, pass of tiles and turn. One person's answer in a claim window or a
 * pass of tiles leaves the others' decision where it was.
 */
export function sameDecision(a: HandState, b: HandState): boolean {
  return a.progress.handIndex === b.progress.handIndex && a.phase === b.phase && a.seq === b.seq && a.preplayStep === b.preplayStep && a.turn === b.turn;
}

/**
 * Resolve deadlines that have passed. Whatever a person did not answer in
 * time is decided by a bot standing in for them, in a claim window as in a
 * turn: it takes a win they were offered, claims a set only when that brings
 * their hand closer, and passes on the rest, so the table moves on and an
 * absent player's Mahjong is not thrown away. It is their hand and their
 * points, so the stand-in always plays sharp, however gently the empty seats'
 * bots do.
 */
export function resolveExpired(game: LiveGame, ruleset: Ruleset, seats: Seats, now: number): HandState | null {
  return resolveExpiredWith(game, ruleset, seats, now, game.tableState?.absence)?.state ?? null;
}

/** The expired clocks' moves, each made for a person whose clock ran out, and the phase each decision was in (a turn and a pass of tiles count as misses; a claim window never does, R2). */
function resolveExpiredWith(
  game: LiveGame,
  ruleset: Ruleset,
  seats: Seats,
  now: number,
  absence: Absence | undefined,
): { state: HandState; moves: EngineMove[]; misses: boolean } | null {
  const { state, deadlines } = game;
  const moves: EngineMove[] = [];
  if (deadlines.claim !== null && now >= deadlines.claim && state.phase === 'claim') {
    let s = state;
    for (const seat of personsPending(s, ruleset, seats, absence)) {
      if (s.phase !== 'claim') break;
      const a = engineMove(analysisBot(viewFor(s, ruleset, seat), ruleset) ?? { type: 'pass' as const, seat });
      s = reduce(s, a, ruleset);
      moves.push({ by: 'clock', seat, a });
    }
    return { state: s, moves, misses: false };
  }
  if (deadlines.turn !== null && now >= deadlines.turn && (state.phase === 'turn' || state.phase === 'preplay')) {
    let s = state;
    for (const seat of personsPending(s, ruleset, seats, absence)) {
      const found = analysisBot(viewFor(s, ruleset, seat), ruleset);
      if (!found) continue;
      const a = engineMove(found);
      s = reduce(s, a, ruleset);
      moves.push({ by: 'clock', seat, a });
    }
    return { state: s, moves, misses: true };
  }
  return null;
}

export interface StepInput {
  readonly game: LiveGame;
  readonly ruleset: Ruleset;
  readonly seats: Seats;
  /** the clocks, when `levels` isn't given */
  readonly policy: TimerPolicy;
  readonly now: number;
  /** the caller's action, already validated by parseClientAction; omit for a sweep */
  readonly action?: ClientAction;
  readonly actor?: Seat;
  /** the game's seed, needed only to start the next hand */
  readonly seed?: string;
  /** how the bots in empty seats play (policy.ts emptySeatBots); sharp when omitted */
  readonly bots?: 'sharp' | 'gentle';
  /** each seat's level: with these, the clocks are sized by the people who are here once this step is done (R10), and `policy` isn't used */
  readonly levels?: readonly (CoachStage | null)[];
  /** a strict room's clocks, with `levels` */
  readonly strict?: boolean;
  /** a change to who plays a seat (someone back, the host handing a seat to a bot, someone who has just taken a bot's seat over, or someone taking a break); never with an action or an end */
  readonly change?: SeatChange;
  /** end the game here, before its last hand is scored: the host ending it, nobody playing it for hours, or the last person leaving; never with an action */
  readonly end?: GameEnd;
  /** the version this step saves the table as, once committed (the one read, plus one): noted with each tap it counts, so the host's hand-over can tell a tap the host saw from one they didn't (R8) */
  readonly version?: number;
}

export interface StepResult extends LiveGame {
  /** the table's bookkeeping after this step: the input's, or a fresh table's, with a hand won in this step added to the running scores, who's away now, and how the game ended once it has */
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
  /** which seats were away at the moment that hand finished, so a bot's win never counts on its person's profile; null when no hand finished */
  readonly awayAtEnd: readonly boolean[] | null;
  /** the caller's move came in after their own clock had run out and a bot had already moved for them in this step: it wasn't played (R5) */
  readonly dropped: boolean;
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
 * added to its running scores, or someone's absence changed, or the game
 * ended here. A step finishes at most one hand, the one it returns: a deal
 * needs the hand before it over, and it plays on from there.
 *
 * Absence (R1-R8, absence.ts). A bot plays an away person's tiles at once,
 * sharply, and the clocks wait on the people who are here. A turn or a pass
 * of tiles whose clock runs out on someone is a miss, and the second in a row
 * makes them away, played for in the same step; a claim window that runs out
 * never counts. Any action of a person's own but a pass brings them back
 * (R4), and so does "I'm back" (`change: back`). A move that arrives after
 * its own clock ran out in this same step isn't played, nor counted as a miss
 * (`dropped`, R5). The host's `change: letBotPlay` hands another person's
 * seat to a bot, unless they've tapped since the host's table was sent
 * (judged by `version`, when given, against the host's `sawVersion`), and
 * `change: break` hands someone's own seat to a bot while they take a break.
 * When the table still waits on the same decision, for no new person, its
 * clock keeps running (R7).
 *
 * Take-overs (R21). `change: took` is someone who has just taken a bot's seat
 * over mid-game, the seats already saying so: they're here from that moment,
 * and the table notes the hand and the state's seq as this step leaves them
 * (`tableState.took`), for the tutor's first look. A note whose seat isn't
 * that person's any more, or whose hand has been played, is dropped.
 *
 * Next hand (R15, R16). On a finished hand that isn't the last, a tap is a
 * vote (`tableState.ready`), and the next hand starts in the step that finds
 * everyone here has voted, or the first step at or after NEXT_HAND_WAIT_MS
 * from the first vote: a vote, a tick, a change, anything, so someone leaving
 * or going away during the wait never holds it up. That start time is the
 * finished hand's turn clock, so the page's tick and the sweep come for it.
 * A tap names the hand it was made on; one for a hand that has already
 * started does nothing but bring its person back (R4). Every tap is saved,
 * even one that adds no vote, for its moment (R8).
 *
 * The game ends in the step that ends it (R12), with `tableState.over` set:
 * when its last hand is scored, however that happened (a move, a clock, the
 * bots), with no tap needed; or on `end` (the host, six idle hours, or the
 * last person leaving). An end mid-hand leaves that hand unfinished: it
 * doesn't count, no points move, and its log gets one note saying who ended
 * it. From then on every action, change and end is refused with GameIsOver,
 * a step with none of them changes nothing, and no clock runs.
 */
export function step(input: StepInput): StepResult {
  const { ruleset, seats, now } = input;
  const tableBefore = input.game.tableState ?? NEW_TABLE;
  const before = input.game.state;
  if ([input.action, input.end, input.change].filter((x) => x !== undefined).length > 1) throw new Error('a step takes one of an action, a change or an end');
  if (tableBefore.over) {
    if (input.action || input.end || input.change) throw new GameIsOver();
    return { ...input.game, tableState: tableBefore, changed: false, gameOver: false, moves: [], dealt: false, finishedHand: false, awayAtEnd: null, dropped: false };
  }
  // Next hand is a person's own tap, on the hand it names (a page loaded before taps named one means the hand it's on). A hand
  // that ends inside this step, its clock run out, must be recorded as it closes, never voted past; a finished hand has no clock
  // to resolve, so this refuses nothing the client offers. A tap on a hand that has already started is too late to matter.
  const h0 = before.progress.handIndex;
  let lateVote = false;
  if (input.action?.type === 'nextHand') {
    if (input.actor === undefined) throw new NotYourMove('action is not for your seat');
    if (seats[input.actor]?.kind !== 'human') throw new NotYourMove('that seat is a bot');
    const hand = input.action.hand ?? h0;
    if (hand > h0 || (hand === h0 && before.phase !== 'finished')) throw new IllegalAction('hand not finished');
    lateVote = hand < h0;
  }
  let s = before;
  let table = tableBefore;
  let changed = false;
  let finishedHand = false;
  let awayAtEnd: readonly boolean[] | null = null;
  let dropped = false;
  const moves: Move[] = [];
  const live = () => s.phase !== 'finished';

  // Who's away, matched to the seats as they are now: a seat someone has left, or sat down in afresh, starts from nothing.
  let absence = reconcileAbsence(tableBefore.absence, seats);
  // Who the table was waiting on before this step, for R7.
  const pendingBefore = personsPending(before, ruleset, seats, absence);
  const { action, actor } = input;
  const isMove = !!action && action.type !== 'nextHand';
  // A tap is presence (R4): any action of a person's own, but letting a tile go, which is what their clock would have done.
  const saving = input.version ?? null;
  if (action && action.type !== 'pass' && actor !== undefined) absence = markPresent(absence, seats, actor, now, saving);

  const settleNow = (from: HandState) => {
    const settled = settleLogged(from, ruleset, seats, { ...(input.bots ? { bots: input.bots } : {}), absence });
    s = settled.state;
    absence = settled.absence;
    moves.push(...settled.moves);
    noteFinish();
  };

  // After every settle: a hand that has just finished puts a win's points on the running scores, notes a hand (and a win)
  // for each away seat, and when it was the game's last, the game is over (the natural end), in the same step, before
  // anything else in it can happen.
  function noteFinish(): void {
    if (finishedHand || s.phase !== 'finished') return;
    // A dealt hand starts live, so a hand finished in the step that dealt it is newly finished too.
    if (s.progress.handIndex === before.progress.handIndex && before.phase === 'finished') return;
    finishedHand = true;
    awayAtEnd = awaySeats(seats, absence);
    absence = noteHandEnd(absence, seats, s);
    const scores = addHandScores(table.scores ?? [0, 0, 0, 0], s);
    if (scores !== table.scores) table = { ...table, scores };
    if (!table.over && isLastHand(s, ruleset)) table = { ...table, over: endOfGame('complete', s, table, seats, null, now) };
  }

  // A tap on a hand that has already started changes nothing but its person's presence, above (R16): no clock, no start.
  const expired = lateVote ? null : resolveExpiredWith(input.game, ruleset, seats, now, absence);
  if (expired) {
    s = expired.state;
    for (const m of expired.moves) {
      // A move of the caller's own that this clock has just answered for them: not a miss, and not played (R5).
      const late = isMove && m.seat === actor;
      if (late) dropped = true;
      const wasAway = isAway(absence, seats, m.seat!);
      absence = noteClockMove(absence, seats, m, expired.misses && !late);
      moves.push(m);
      if (!wasAway && isAway(absence, seats, m.seat!) && live()) moves.push({ by: 'table', seat: m.seat!, a: { type: 'away', reason: 'clock' } });
    }
    changed = true;
    settleNow(s);
  }

  const change = input.change;
  if (change) {
    const target = seats[change.seat];
    if (change.type === 'back') {
      const wasAway = isAway(absence, seats, change.seat);
      absence = markPresent(absence, seats, change.seat, now, saving);
      if (wasAway && live() && target?.kind === 'human') moves.push({ by: 'player', seat: change.seat, userId: target.userId, a: { type: 'back' } });
    } else if (change.type === 'letBotPlay') {
      if (target?.kind !== 'human') throw new NotYourMove('a bot already plays that seat');
      // A pass never stamps a tap (R4), so a page left open answering claim windows by itself never refuses this. A tap the host
      // never saw is one saved after the table they were looking at: by version, since a tap's time is when its request began, and
      // one that began before the host's table was read can land after it. By the clock only when either side has no version (a
      // tap saved, or a page loaded, before versions were kept).
      const e = absence[change.seat];
      const sawVersion = change.sawVersion ?? null;
      const unseen = sawVersion !== null && e.tapVersion !== null ? e.tapVersion > sawVersion : change.sawAt !== null && e.lastTap !== null && e.lastTap > change.sawAt;
      if (unseen) throw new JustPlayed();
      const host = seats[change.bySeat];
      const wasAway = isAway(absence, seats, change.seat);
      absence = markPresent(markAway(absence, seats, change.seat, 'host'), seats, change.bySeat, now, saving);
      if (!wasAway && live()) moves.push({ by: 'host', seat: change.seat, ...(host?.kind === 'human' ? { userId: host.userId } : {}), a: { type: 'away', reason: 'host' } });
    } else if (change.type === 'break') {
      // Taking a break: a bot plays their tiles from now until they're back, as for any away seat. It isn't a tap (R4), so it
      // notes none. A seat already away stays as it is, with the reason it went away for.
      if (target?.kind !== 'human') throw new NotYourMove('a bot already plays that seat');
      const wasAway = isAway(absence, seats, change.seat);
      absence = markAway(absence, seats, change.seat, 'self');
      if (!wasAway && live()) moves.push({ by: 'player', seat: change.seat, userId: target.userId, a: { type: 'away', reason: 'self' } });
    } else {
      // Taken over from a bot: the seats say who has it now, and they're at the table from this moment.
      if (target?.kind !== 'human') throw new NotYourMove('a bot already plays that seat');
      absence = markPresent(absence, seats, change.seat, now, saving);
    }
    settleNow(s);
  }

  if (input.end) {
    // A clock that ran out above may have scored the last hand already, and a game ends only once.
    if (!table.over) {
      const { by } = input.end;
      // An end that finds the last hand scored (one saved before the natural end existed) records the game as played out;
      // everyone leaving is still an abandon, with no final table.
      const how = input.end.how === 'abandoned' ? 'abandoned' : isLastHand(s, ruleset) ? 'complete' : input.end.how;
      table = { ...table, over: endOfGame(how, s, table, seats, by, now) };
      // Logged only on a live hand, so its log says why nobody moved after this; a finished hand's log is complete.
      if (live()) moves.push({ by: by ? 'host' : 'table', ...(by ? { userId: by.userId } : {}), a: { type: 'endGame', how } });
    }
  } else if (action) {
    // The route validates what a client sends, but the table does not rely on
    // it: a server-only move (resolveClaims closes everyone's claim window at
    // once) is never a player's to make, whichever seat it names.
    if (!isClientActionType((action as { readonly type: unknown }).type)) throw new NotYourMove('only the table makes that move');
    if (action.type === 'nextHand') {
      // Nothing to do for a tap on a hand already started (lateVote); otherwise the tap is a vote, and the start comes below.
      if (!lateVote) {
        if (s.phase !== 'finished') throw new IllegalAction('hand not finished');
        const entry = seats[actor!];
        if (nextHand(s, ruleset) === null) {
          // A finished last hand the natural end never saw (saved before it existed): the tap ends the game.
          table = { ...table, over: endOfGame('complete', s, table, seats, null, now) };
        } else if (entry?.kind === 'human') {
          // Counted once per person, however many phones or taps; a second one adds no vote, and saves only its moment (below).
          table = voteNextHand(table, h0, entry.userId, now);
        }
      }
    } else {
      if (actor === undefined || action.seat !== actor) throw new NotYourMove('action is not for your seat');
      const entry = seats[actor];
      if (entry?.kind !== 'human') throw new NotYourMove('that seat is a bot');
      // Dropped: the clock has already answered this decision for them, and the table has moved on from it.
      if (!dropped) {
        moves.push({ by: 'player', seat: actor, userId: entry.userId, a: action });
        settleNow(reduce(s, action, ruleset));
      }
      changed = true;
    }
  } else if (!expired && !change) {
    // A sweep or a first load: still make sure nothing is waiting on a bot.
    settleNow(s);
  }

  // Start the next hand (R15) once everyone here has tapped Next hand on this one, or its wait has run out, whatever brought
  // this step: a vote, a tick, someone back or handed to a bot. The people here are counted as they are now, so someone who
  // left or went away during the wait isn't waited on. Never in a step that ends the game.
  const votes = table.ready;
  if (
    !lateVote &&
    !table.over &&
    !input.end &&
    s.phase === 'finished' &&
    votes?.hand === s.progress.handIndex &&
    (now >= votes.dealAt || everyoneReady(votes, votes.hand, presentUserIds(seats, absence)))
  ) {
    const n = nextHand(s, ruleset);
    if (n !== null) {
      if (input.seed === undefined) throw new Error('starting a hand needs the seed');
      table = { ...table, ready: null };
      settleNow(startHand(ruleset, { seed: input.seed, ...n }));
    }
  }

  if (absence !== table.absence) table = { ...table, absence };
  // Who took a seat over, and when: as this step leaves the hand, so no bot moves for that seat after it. Kept only while it
  // can matter, for that person in that seat during that hand.
  const took = reconcileTook(table.took, seats, s.progress.handIndex);
  const taker = change?.type === 'took' ? seats[change.seat] : null;
  const tookNow = change && taker?.kind === 'human' ? withTakeOver(took, change.seat, { userId: taker.userId, hand: s.progress.handIndex, seq: s.seq }) : took;
  if (tookNow !== table.took) {
    const { took: _dropped, ...rest } = table;
    table = tookNow ? { ...rest, took: tookNow } : rest;
  }
  const dealt = s.progress.handIndex > before.progress.handIndex;
  // Anything new in the table itself or its bookkeeping is a change too: a move, the running scores, someone's absence
  // (a reset of a seat's old entry included), a vote for the next hand, or the game's end.
  if (s !== before || !sameTableState(table, tableBefore)) changed = true;
  // A Next hand tap is presence (R4) even when it changes nothing else, a second vote or one on a hand that has already started
  // (R16): its moment is saved all the same, so the host's hand-over can't overrule a tap it never saw (R8).
  if (action?.type === 'nextHand') changed = true;
  const policy = input.levels ? policyFor(presentLevels(input.levels, seats, absence), input.strict ?? false) : input.policy;
  // The same decision as before, waiting on nobody new (one person answered and another still owes theirs, someone came
  // back, a seat nobody was waiting on went to a bot): its clock keeps running (R7). Never a clock that has just run out:
  // whatever it didn't settle gets a fresh one, as before.
  const pendingNow = personsPending(s, ruleset, seats, absence);
  const clockRunning = input.game.deadlines.claim !== null || input.game.deadlines.turn !== null;
  const sameWait = !expired && clockRunning && sameDecision(before, s) && pendingNow.every((seat) => pendingBefore.includes(seat));
  // A finished hand runs no clock of its own; once someone has tapped Next hand, its turn clock is when the next one starts
  // regardless, so whichever phone is open ticks then, and wake_at sends the sweep if none is.
  const deadlines = table.over
    ? { claim: null, turn: null }
    : s.phase === 'finished'
      ? { claim: null, turn: table.ready?.hand === s.progress.handIndex ? table.ready.dealAt : null }
      : !changed || sameWait
        ? input.game.deadlines
        : deadlinesFor(s, ruleset, seats, policy, now, absence);
  const gameOver = table.over !== null;
  return { state: s, deadlines, tableState: table, changed, gameOver, moves, dealt, finishedHand, awayAtEnd, dropped };
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
  if (err instanceof JustPlayed) return 409;
  return null;
}

export type { Action };
