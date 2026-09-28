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
import { firstLookFor, joinedAtOf, type JoinedAt } from '../lib/coach/first-look';
import { lessonFor } from '../lib/coach/teach';
import { flowerSinceMyLastMove, myDiscardCount, textOf } from '../lib/coach/words';
import { liveStage } from '../lib/live/level';
import type { GameSnapshot } from '../lib/live/snapshot';
import type { StandIn } from '../lib/live/table';
import type { Deadlines } from '../lib/live/types';
import { riverOrder } from '../lib/river';
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
const SOUTH: GameProgress = { roundWind: 'S', roundIndex: 1, handInRound: 0, handIndex: 4 };

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

/**
 * A claim window's clock running out, by `resolveExpired`'s rules (lib/live/table.ts): each person still to answer is
 * answered by the server's sharp bot standing in for them (it takes a win it's offered), then the bots play on.
 */
function runOut(s: HandState): { readonly state: HandState; readonly standIns: readonly StandIn[] } {
  let out = s;
  const standIns: StandIn[] = [];
  for (const seat of pending(s)) {
    if (out.phase !== 'claim') break;
    const action = analysisBot(viewFor(out, karachi, seat), karachi) ?? { type: 'pass' as const, seat };
    out = reduce(out, action, karachi);
    standIns.push({ seat, action });
  }
  return { state: settle(out), standIns };
}

/**
 * The first claim window of a hand dealt from `seed` for which `take` returns something, given the decision a person
 * had before it, when that decision was someone else's: so on that table Amna has no clock running.
 */
function claimAfterOthers<T>(seed: string, take: (window: HandState, before: HandState) => T | null): T | null {
  let s = settle(startHand(karachi, { seed, progress: EAST_HONOUR, dealer: 0 }));
  let before: HandState | null = null;
  for (let i = 0; i < 400 && s.phase !== 'finished'; i++) {
    if (s.phase === 'claim' && before && !pending(before).includes(ME)) {
      const found = take(s, before);
      if (found) return found;
    }
    const seat = pending(s)[0];
    if (seat === undefined) return null;
    before = s;
    s = settle(reduce(s, personMove(s, seat), karachi));
  }
  return null;
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

/**
 * A snapshot for someone who took Amna's seat over from a bot at `took`, as the server stamps it: the hand, and the
 * moment, of the take-over. Its own copy of the field, as the server lane adds it to the snapshot (tutor v2 H2).
 */
function takenOver(state: HandState, version: number, took: JoinedAt): GameSnapshot {
  return { ...snapshot(state, version, 'learning'), joinedAt: took } as GameSnapshot;
}

/** What the live page's tutor says on this snapshot, for comparing through the helpers rather than retyping copy. */
export function liveCoach(s: GameSnapshot): CoachState {
  const view = s.view as PrivatePlayerView;
  const firstLook = firstLookFor(view, joinedAtOf(s));
  return coachFor({ view, ruleset: karachi, analysis: analyseFor(view, karachi), stage: liveStage(s.stage, view), names: LIVE_NAMES, firstLook });
}

/** The first seed of `tutor-{from}`, `tutor-{from + 1}`, ... for which `make` returns something. */
function search<T>(what: string, make: (seed: string) => T | null, from = 0): T {
  for (let i = from; i < from + 200; i++) {
    const found = make(`tutor-${i}`);
    if (found) return found;
  }
  throw new Error(`no seed gives ${what}`);
}

/** Amna is asked about a discard she could take, and it isn't a win. */
function offered(s: HandState): boolean {
  const claims = s.phase === 'claim' ? legalActions(s, karachi, ME).claims : undefined;
  return !!claims && claims.length > 0 && !claims.some((c) => c.type === 'win');
}

/** The tutor's line at a claim names a hand, so there's a card to open from it. */
const namesAHand = (snap: GameSnapshot) => liveCoach(snap).say.some((x) => x.hand);

/** A claim window's clock short enough that a test sees it run out before the page's 12 s poll: 8.5 s before the sheet passes for Amna. */
const SHORT_CLAIM = { claimMs: 10_000, turnMs: HOUR } as const;
/** The same for a window that offers Amna a win, which runs on the turn clock. */
const SHORT_WIN = { claimMs: HOUR, turnMs: 10_000 } as const;

export interface TutorFixtures {
  /** A finished East hand won by one of the bots, for a first-timer: the result line names the winner's hand. */
  readonly otherWin: GameSnapshot;
  /**
   * Someone else's move, and then the claim window that follows it, where Amna could pung a discard, not win on it,
   * on a short clock (`SHORT_CLAIM`). The tutor's line names a hand. No clock of Amna's runs before the window.
   */
  readonly claim: { readonly before: GameSnapshot; readonly window: GameSnapshot };
  /**
   * The same, where the discard is Amna's winning tile, on a short clock (`SHORT_WIN`), and then the table once that
   * clock has run out: the server's stand-in has called Mahjong for her, and the snapshot says so.
   */
  readonly winClaim: { readonly before: GameSnapshot; readonly window: GameSnapshot; readonly won: GameSnapshot };
  /**
   * Two claim windows for Amna, the second the table's answer once she's passed on the first (from her other phone,
   * say): the claim sheet stays up between them. Both clocks are an hour, so nothing runs out under an open card.
   */
  readonly claimAgain: { readonly first: GameSnapshot; readonly next: GameSnapshot };
  /**
   * Amna's turn, with a flower drawn since her last move, for a first-timer. After her first discard of the hand:
   * on her first turn the round's footnote comes first, and there's no room beside it for the flowers'.
   */
  readonly flowerTurn: GameSnapshot;
  /**
   * Amna's turn in an East honour hand or South, after a tile she'd have wanted for a run went past, for a first-timer:
   * the tutor explains why she couldn't take it. After her first discard of the hand, for the same reason as `flowerTurn`.
   */
  readonly missedRun: GameSnapshot;
  /**
   * Two looks at the same hand-start bubble for a learner: Bilal deals, and Amna drew a flower in the deal. The next
   * look is the table once Bilal has thrown and the bots have moved on, with Bilal to answer again before Amna's first
   * turn and something in the river. The tutor's words are the same on both, and the flower is still news.
   */
  readonly handStartTwice: { readonly first: GameSnapshot; readonly next: GameSnapshot };
  /**
   * Amna takes seat 0 over from the bot keeping it, part-way through an East honour hand, for a learner. `theirs` is
   * the table then, on Bilal's turn, after the bot's first discard for the seat. `mine` is her turn once Bilal has
   * thrown, still before a move of her own. `after` is the table's answer to her discarding the tutor's tile, and
   * `later` her next turn. Every one carries the take-over's `joinedAt`.
   */
  readonly takeOver: { readonly theirs: GameSnapshot; readonly mine: GameSnapshot; readonly after: GameSnapshot; readonly later: GameSnapshot };
  /** The same, taken over on Amna's own turn, after the bot's first discard for the seat. */
  readonly takeOverOnTurn: GameSnapshot;
}

/** Plays the people's moves, as the server's bot would make them, until Amna has a decision to make: null if the hand ends first. */
function untilAmna(state: HandState): HandState | null {
  let s = state;
  for (let i = 0; i < 400 && s.phase !== 'finished'; i++) {
    const seat = pending(s)[0];
    if (seat === undefined) return null;
    if (seat === ME) return s;
    s = settle(reduce(s, personMove(s, seat), karachi));
  }
  return null;
}

/** The moment of a take-over at this table: its hand, and its last move. */
const tookAt = (s: HandState): JoinedAt => ({ hand: s.progress.handIndex, seq: s.seq });

/** Whether the tutor gives a take-over its first look here: the aim, with the take-over's footnote first under it for a first visit. */
function firstLookHere(snap: GameSnapshot): boolean {
  const coach = liveCoach(snap);
  return coach.moment === 'handStart' && textOf(coach.say).startsWith(coach.goal.aim) && lessonFor(coach, new Set()).notes[0]?.key === 'firstLook';
}

function build(): TutorFixtures {
  const otherWin = search('a hand a bot wins, whose winning hand the card can lay out', (seed) => {
    const end = playOut(startHand(karachi, { seed, progress: EAST_HONOUR, dealer: 0 }));
    if (end.result?.type !== 'win' || !isBot(end.result.winner)) return null;
    const snap = snapshot(end, 9, 'new');
    return liveCoach(snap).outcome?.hand?.ref.whose === 'winner' ? snap : null;
  });
  const claim = search("a claim window after someone else's move, where Amna could pung, whose line names a hand", (seed) =>
    claimAfterOthers(seed, (s, before) => {
      if (!offered(s) || !legalActions(s, karachi, ME).claims?.some((c) => c.type === 'pung')) return null;
      const window = snapshot(s, 9, 'new', 'active', deadlines(s, SHORT_CLAIM));
      return namesAHand(window) ? { before: snapshot(before, 8, 'new'), window } : null;
    }),
  );
  // A win on a discard comes late in a hand: tutor-4 is the first seed that gives one today, so the search starts there
  // rather than playing out four hands first. An engine change that moves the deal still searches on from it.
  const winClaim = search(
    "a claim window after someone else's move that offers Amna a win, whose line names a hand, and the stand-in's win",
    (seed) =>
      claimAfterOthers(seed, (s, before) => {
        if (!legalActions(s, karachi, ME).claims?.some((c) => c.type === 'win')) return null;
        const window = snapshot(s, 9, 'new', 'active', deadlines(s, SHORT_WIN));
        if (!namesAHand(window)) return null;
        const out = runOut(s);
        // The server tells each person only the moves made for them.
        const mine = out.standIns.filter((x) => x.seat === ME);
        if (out.state.result?.type !== 'win' || out.state.result.winner !== ME || mine[0]?.action.type !== 'claim') return null;
        return { before: snapshot(before, 8, 'new'), window, won: { ...snapshot(out.state, 10, 'new'), standIns: mine } };
      }),
    4,
  );
  // Back-to-back windows are rare: tutor-51 is the first seed that gives them today, so the search starts there
  // rather than playing out fifty hands first. An engine change that moves the deal still searches on from it.
  const claimAgain = search(
    'a claim window whose pass brings Amna the next one straight away',
    (seed) => {
      let s = settle(startHand(karachi, { seed, progress: EAST_HONOUR, dealer: 0 }));
      for (let i = 0; i < 400 && s.phase !== 'finished'; i++) {
        if (offered(s)) {
          const after = settle(reduce(s, { type: 'pass', seat: ME }, karachi));
          if (offered(after) && after.discardCount !== s.discardCount) {
            const first = snapshot(s, 9, 'new');
            const next = snapshot(after, 10, 'new');
            if (namesAHand(first) && namesAHand(next)) return { first, next };
          }
        }
        const seat = pending(s)[0];
        if (seat === undefined) return null;
        s = settle(reduce(s, personMove(s, seat), karachi));
      }
      return null;
    },
    51,
  );
  const flowerTurn = search("Amna's turn after a flower, once she's discarded, where the tutor explains it", (seed) => {
    let s = settle(startHand(karachi, { seed, progress: EAST_HONOUR, dealer: 0 }));
    for (let i = 0; i < 400 && s.phase !== 'finished'; i++) {
      const view = viewFor(s, karachi, ME);
      if (s.phase === 'turn' && s.turn === ME && myDiscardCount(view) > 0 && flowerSinceMyLastMove(view)) {
        const snap = snapshot(s, 9, 'new');
        const coach = liveCoach(snap);
        if (coach.say.length > 0 && coach.teach.some((t) => t.key === 'rule:flowers')) return snap;
      }
      const seat = pending(s)[0];
      if (seat === undefined) return null;
      s = settle(reduce(s, personMove(s, seat), karachi));
    }
    return null;
  });
  const missedRun = search("Amna's turn after a run tile went past, once she's discarded, where the tutor explains it", (seed) => {
    for (const progress of [EAST_HONOUR, SOUTH]) {
      let s = settle(startHand(karachi, { seed, progress, dealer: 0 }));
      for (let i = 0; i < 400 && s.phase !== 'finished'; i++) {
        if (s.phase === 'turn' && s.turn === ME && myDiscardCount(viewFor(s, karachi, ME)) > 0) {
          const snap = snapshot(s, 9, 'new');
          const coach = liveCoach(snap);
          // A first visit's footnotes under the bubble: the run tile's comes first.
          if (coach.say.length > 0 && lessonFor(coach, new Set()).notes[0]?.key === 'rule:runs') return snap;
        }
        const seat = pending(s)[0];
        if (seat === undefined) break;
        s = settle(reduce(s, personMove(s, seat), karachi));
      }
    }
    return null;
  });
  const handStartTwice = search('two looks at the same hand-start bubble for Amna, with a flower from the deal to explain', (seed) => {
    const s = settle(startHand(karachi, { seed, progress: EAST_HONOUR, dealer: 1 }));
    if (s.players[ME].bonus.length === 0 || pending(s).join() !== '1') return null;
    const after = settle(reduce(s, personMove(s, 1), karachi));
    if (pending(after).join() !== '1') return null;
    const first = snapshot(s, 9, 'learning');
    const next = snapshot(after, 10, 'learning');
    const [a, b] = [liveCoach(first), liveCoach(next)];
    const same = a.moment === 'handStart' && b.moment === a.moment && b.action.kind === a.action.kind && textOf(b.say) === textOf(a.say);
    const news = [a, b].every((c) => c.teach.some((t) => t.key === 'rule:flowers'));
    return same && news && riverOrder(next.view).length > 0 ? { first, next } : null;
  });
  const takeOver = search("a take-over on Bilal's turn, then Amna's turn, her discard and her next turn", (seed) => {
    let s = settle(startHand(karachi, { seed, progress: EAST_HONOUR, dealer: 0 }));
    for (let i = 0; i < 400 && s.phase !== 'finished'; i++) {
      if (s.phase === 'turn' && pending(s).join() === '1' && myDiscardCount(viewFor(s, karachi, ME)) > 0) {
        const took = tookAt(s);
        const theirs = takenOver(s, 9, took);
        // Bilal throws, and nothing asks Amna to decide before her turn.
        const turn = settle(reduce(s, personMove(s, 1), karachi));
        const mine = takenOver(turn, 10, took);
        const tip = liveCoach(mine).action;
        if (firstLookHere(theirs) && turn.phase === 'turn' && pending(turn).join() === '0' && tip.kind === 'discard') {
          const answered = settle(reduce(turn, { type: 'discard', seat: ME, tile: tip.tile }, karachi));
          const next = untilAmna(answered);
          if (!pending(answered).includes(ME) && next?.phase === 'turn') {
            const later = takenOver(next, 12, took);
            if (liveCoach(later).action.kind === 'discard') return { theirs, mine, after: takenOver(answered, 11, took), later };
          }
        }
      }
      const seat = pending(s)[0];
      if (seat === undefined) return null;
      s = settle(reduce(s, personMove(s, seat), karachi));
    }
    return null;
  });
  const takeOverOnTurn = search("a take-over on Amna's own turn, after the bot's first discard for the seat", (seed) => {
    let s = settle(startHand(karachi, { seed, progress: EAST_HONOUR, dealer: 0 }));
    for (let i = 0; i < 400 && s.phase !== 'finished'; i++) {
      if (s.phase === 'turn' && s.turn === ME && myDiscardCount(viewFor(s, karachi, ME)) > 0) {
        const snap = takenOver(s, 9, tookAt(s));
        return firstLookHere(snap) && liveCoach(snap).action.kind === 'discard' ? snap : null;
      }
      const seat = pending(s)[0];
      if (seat === undefined) return null;
      s = settle(reduce(s, personMove(s, seat), karachi));
    }
    return null;
  });
  return { otherWin, claim, winClaim, claimAgain, flowerTurn, missedRun, handStartTwice, takeOver, takeOverOnTurn };
}

let built: TutorFixtures | null = null;

/** The fixtures, built once per worker. */
export function tutorFixtures(): TutorFixtures {
  built ??= build();
  return built;
}
