import {
  SEATS,
  analysisBot,
  karachi,
  legalActions,
  reduce,
  startHand,
  viewFor,
  type Action,
  type GameProgress,
  type HandState,
  type PrivatePlayerView,
  type Seat,
} from '@society/engine';
import { analyseFor, coachFor, type CoachStage, type CoachState } from '../lib/coach';
import type { GameSnapshot } from '../lib/live/snapshot';
import type { Deadlines } from '../lib/live/types';
import { GAME_ID, USER_NAME } from './fixtures';

/**
 * The live tables the tutor's browser tests serve, made with the engine alone:
 * the server's step() is being rewritten in another lane, and these scenes
 * mustn't move with it. So the bots are played here by a copy of the server's
 * rules for what happens between human decisions (`settleOnce` in
 * lib/live/table.ts, rule for rule), and the deadlines follow `deadlinesFor`'s
 * rules there, with the fixtures' own lengths. A fixture never stops in a
 * state the server wouldn't send. If the server's rules change, these follow.
 * Every scene is seed-searched, so an engine change that moves the deal finds
 * another seed instead of quietly becoming a different scene.
 */

const ROOM_ID = '0b1c2d3e-4f50-4617-8829-3a4b5c6d7e8f';
const ROOM_CODE = 'KHI-4287Q';
/** The server's clock when the snapshots were made. `serve` moves every snapshot to the moment it's sent. */
const MADE_AT = 1_000_000;
/** An hour on every clock unless a scene needs a short one, so no test runs into a deadline by accident. */
const HOUR = 3_600_000;

/** Amna and Bilal are people; the other two seats are bots. */
const SEATING = [
  { kind: 'human', name: USER_NAME },
  { kind: 'human', name: 'Bilal' },
  { kind: 'bot', name: 'Bot' },
  { kind: 'bot', name: 'Bot' },
] as const;
const ME: Seat = 0;
const isBot = (seat: Seat) => SEATING[seat].kind === 'bot';

/** The names the live page gives the seats: 'You' for Amna, as live-table.tsx does. */
const LIVE_NAMES: Readonly<Record<Seat, string>> = { 0: 'You', 1: SEATING[1].name, 2: SEATING[2].name, 3: SEATING[3].name };

const EAST_HONOUR: GameProgress = { roundWind: 'E', roundIndex: 0, handInRound: 1, handIndex: 1 };

/** One forced or bot move, or null when a person has a real decision. A copy of `settleOnce` (lib/live/table.ts), with the server's default sharp bots. */
function settleOnce(s: HandState): HandState | null {
  if (s.phase === 'finished') return null;

  if (s.phase === 'preplay') {
    for (const seat of SEATS) {
      if (!isBot(seat)) continue;
      const a = analysisBot(viewFor(s, karachi, seat), karachi);
      if (a && a.type === 'exchange') return reduce(s, a, karachi);
    }
    return null;
  }

  if (s.phase === 'claim') {
    for (const seat of SEATS) {
      const legal = legalActions(s, karachi, seat);
      if (!legal.claims) continue; // the discarder, or already answered
      if (isBot(seat)) return reduce(s, analysisBot(viewFor(s, karachi, seat), karachi) ?? { type: 'pass', seat }, karachi);
      // A person with nothing to claim isn't asked; the engine still wants the pass.
      if (legal.claims.length === 0) return reduce(s, { type: 'pass', seat }, karachi);
    }
    return null;
  }

  if (isBot(s.turn)) {
    const a = analysisBot(viewFor(s, karachi, s.turn), karachi);
    if (!a) throw new Error(`bot at seat ${s.turn} has no move`);
    return reduce(s, a, karachi);
  }
  return null;
}

/** Every bot move and forced pass, up to the next decision a person has to make. */
function settle(state: HandState): HandState {
  let s = state;
  for (let i = 0; i < 600; i++) {
    const next = settleOnce(s);
    if (next === null) return s;
    s = next;
  }
  throw new Error('settle: the bots never reached a person');
}

/** The people who still owe the table an answer in this phase. */
function pending(s: HandState): Seat[] {
  if (s.phase === 'claim') return SEATS.filter((seat) => !isBot(seat) && legalActions(s, karachi, seat).claims !== undefined);
  if (s.phase === 'preplay') return SEATS.filter((seat) => !isBot(seat) && legalActions(s, karachi, seat).exchange !== undefined);
  if (s.phase === 'turn') return isBot(s.turn) ? [] : [s.turn];
  return [];
}

/**
 * The deadlines the server would set, by `deadlinesFor`'s rules (lib/live/table.ts): none when no person is
 * pending; in a claim window the claim deadline, at the turn clock's length when a pending person is offered the win;
 * otherwise the turn deadline.
 */
function deadlines(s: HandState, lengths: { readonly claimMs: number; readonly turnMs: number } = { claimMs: HOUR, turnMs: HOUR }): Deadlines {
  const who = pending(s);
  if (who.length === 0) return { claim: null, turn: null };
  if (s.phase === 'claim') {
    const win = who.some((seat) => legalActions(s, karachi, seat).claims?.some((c) => c.type === 'win') ?? false);
    return { claim: MADE_AT + (win ? lengths.turnMs : lengths.claimMs), turn: null };
  }
  return { claim: null, turn: MADE_AT + lengths.turnMs };
}

/** The move a person makes when the scene doesn't care which: the server's own bot's choice for them. */
function personMove(s: HandState, seat: Seat): Action {
  const move = analysisBot(viewFor(s, karachi, seat), karachi);
  if (move && move.type !== 'resolveClaims') return move;
  return { type: 'pass', seat };
}

/** Plays a hand to its end, the people moving as the server's bot would for them. */
function playOut(state: HandState): HandState {
  let s = settle(state);
  for (let i = 0; i < 400 && s.phase !== 'finished'; i++) {
    const seat = pending(s)[0];
    if (seat === undefined) break;
    s = settle(reduce(s, personMove(s, seat), karachi));
  }
  return s;
}

/** A snapshot of `state` as Amna's seat would get it. Its own copy of the shape `fixtures.ts` builds. */
function snapshot(state: HandState, version: number, stage: CoachStage, status: GameSnapshot['status'] = 'active', d: Deadlines = deadlines(state)): GameSnapshot {
  return {
    gameId: GAME_ID,
    roomId: ROOM_ID,
    roomCode: ROOM_CODE,
    isHost: true,
    rulesetId: karachi.id,
    version,
    deadlines: d,
    seats: SEATING.map((s) => ({ kind: s.kind, name: s.name })),
    scores: [0, 0, 0, 0],
    me: ME,
    view: viewFor(state, karachi, ME),
    status,
    now: MADE_AT,
    stage,
  };
}

/** What the live page's tutor says on this snapshot, for comparing through the helpers rather than retyping copy. */
export function liveCoach(s: GameSnapshot): CoachState {
  const view = s.view as PrivatePlayerView;
  return coachFor({ view, ruleset: karachi, analysis: analyseFor(view, karachi), stage: s.stage ?? 'new', names: LIVE_NAMES });
}

/** The first seed of `tutor-0`, `tutor-1`, ... for which `make` returns something. */
function search<T>(what: string, make: (seed: string) => T | null): T {
  for (let i = 0; i < 200; i++) {
    const found = make(`tutor-${i}`);
    if (found) return found;
  }
  throw new Error(`no seed gives ${what}`);
}

export interface TutorFixtures {
  /** A finished East hand won by one of the bots, for a first-timer: the result line names the winner's hand. */
  readonly otherWin: GameSnapshot;
}

function build(): TutorFixtures {
  const otherWin = search('a hand a bot wins, whose winning hand the card can lay out', (seed) => {
    const end = playOut(startHand(karachi, { seed, progress: EAST_HONOUR, dealer: 0 }));
    if (end.result?.type !== 'win' || !isBot(end.result.winner)) return null;
    const snap = snapshot(end, 9, 'new');
    return liveCoach(snap).outcome?.hand?.ref.whose === 'winner' ? snap : null;
  });
  return { otherWin };
}

let built: TutorFixtures | null = null;

/** The fixtures, built once per worker. */
export function tutorFixtures(): TutorFixtures {
  built ??= build();
  return built;
}
