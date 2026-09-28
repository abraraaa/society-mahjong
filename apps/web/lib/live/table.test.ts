import { afterEach, describe, expect, it, vi } from 'vitest';
import { EVERYONE_HERE, isAway, markAway, markPresent, noteClockMove } from './absence';
import { IllegalAction, analysisBot, karachi, legalActions, reduce, startHand, viewFor, type GameProgress, type HandState, type Seat } from '@society/engine';
import type { ClientAction, LiveGame, Move } from './types';
import {
  GameIsOver,
  JustPlayed,
  NotYourMove,
  actionIsForSeat,
  dealFirstHand,
  deadlinesFor,
  decisionRandom,
  rejectionStatus,
  resolveExpired,
  settle,
  step,
  type StepInput,
  type StepResult,
} from './table';
import { isHuman, isPlayerMove, seatOf, type Seats } from './types';
import { replayHand, stamp } from './hand-log';
import { policyFor } from './policy';
import { NEW_TABLE, sameTableState, type TableState } from './table-state';

const ME: Seat = 0;
const seats: Seats = [
  { kind: 'human', userId: 'u-me', name: 'Me' },
  { kind: 'bot', name: 'Bilal' },
  { kind: 'bot', name: 'Sana' },
  { kind: 'bot', name: 'Ayesha' },
];
const policy = policyFor(['new']);
const T0 = 1_700_000_000_000;

describe('seats', () => {
  it('finds a user’s seat and tells bots from humans', () => {
    expect(seatOf(seats, 'u-me')).toBe(0);
    expect(seatOf(seats, 'nobody')).toBeNull();
    expect(isHuman(seats, 0)).toBe(true);
    expect(isHuman(seats, 1)).toBe(false);
  });
});

describe('a table with one human and three bots', () => {
  it('deals and plays the bots up to the human’s first decision', () => {
    const game = dealFirstHand(karachi, seats, 'live-1', policy, T0);
    const s = game.state;
    expect(s.phase).not.toBe('finished');
    // Whatever phase it is in, it is waiting on the human, and the deadline says so.
    const legal = viewFor(s, karachi, ME).legal;
    const waitingOnMe = !!legal.discard || !!legal.exchange || (legal.claims !== undefined && legal.claims.length > 0);
    expect(waitingOnMe).toBe(true);
    expect(game.deadlines.turn !== null || game.deadlines.claim !== null).toBe(true);
  });

  it('plays a whole hand through step(), with deadlines only ever on the human', () => {
    let game = dealFirstHand(karachi, seats, 'live-2', policy, T0);
    let now = T0;
    for (let i = 0; i < 400 && game.state.phase !== 'finished'; i++) {
      now += 1000;
      const view = viewFor(game.state, karachi, ME);
      const a = analysisBot(view, karachi);
      expect(a, 'table waiting on the human without a legal move').not.toBeNull();
      const r = step({ game, ruleset: karachi, seats, policy, now, action: a! as never, actor: ME });
      expect(r.changed).toBe(true);
      game = r;
      if (game.state.phase !== 'finished') {
        expect(game.deadlines.claim !== null || game.deadlines.turn !== null, 'a live hand must be waiting on the human').toBe(true);
      }
    }
    expect(game.state.phase).toBe('finished');
    // Deadlines clear once nobody is waited on.
    expect(game.deadlines).toEqual({ claim: null, turn: null });
  });

  it('rejects an action for someone else’s seat, and an illegal one for your own', () => {
    const game = dealFirstHand(karachi, seats, 'live-3', policy, T0);
    expect(() => step({ game, ruleset: karachi, seats, policy, now: T0, action: { type: 'discard', seat: 1, tile: 'm1' }, actor: ME })).toThrow(NotYourMove);
    expect(() => step({ game, ruleset: karachi, seats, policy, now: T0, action: { type: 'declareWin', seat: ME }, actor: ME })).toThrow(IllegalAction);
  });

  it('treats resolveClaims as nobody’s move, whatever seat it names', () => {
    const forged = { type: 'resolveClaims', seat: ME } as unknown as ClientAction;
    expect(actionIsForSeat(forged, ME)).toBe(false);
    expect(actionIsForSeat({ type: 'pass', seat: ME }, ME)).toBe(true);
    expect(actionIsForSeat({ type: 'nextHand' }, ME)).toBe(true);
    const game = dealFirstHand(karachi, seats, 'live-3', policy, T0);
    expect(() => step({ game, ruleset: karachi, seats, policy, now: T0, action: forged, actor: ME })).toThrow(NotYourMove);
    expect(() => step({ game, ruleset: karachi, seats, policy, now: T0, action: { type: 'dealMeIn', seat: ME } as unknown as ClientAction, actor: ME })).toThrow(NotYourMove);
  });

  it('a sweep with nothing expired changes nothing', () => {
    const game = dealFirstHand(karachi, seats, 'live-4', policy, T0);
    const r = step({ game, ruleset: karachi, seats, policy, now: T0 + 1000 });
    expect(r.changed).toBe(false);
    expect(r.state).toBe(game.state);
  });

  it('an expired turn is played by a stand-in bot', () => {
    const game = dealFirstHand(karachi, seats, 'live-5', policy, T0);
    const late = (game.deadlines.turn ?? game.deadlines.claim)! + 1;
    const r = step({ game, ruleset: karachi, seats, policy, now: late });
    expect(r.changed).toBe(true);
    expect(r.state.seq).toBeGreaterThan(game.state.seq);
  });

  it('an expired claim window passes for the absent human', () => {
    // Drive until the human is asked to claim something.
    let game = dealFirstHand(karachi, seats, 'live-6', policy, T0);
    let now = T0;
    let asked = false;
    for (let i = 0; i < 400 && game.state.phase !== 'finished'; i++) {
      now += 1000;
      const view = viewFor(game.state, karachi, ME);
      if (view.legal.claims && view.legal.claims.length > 0) {
        asked = true;
        break;
      }
      const a = analysisBot(view, karachi)!;
      game = step({ game, ruleset: karachi, seats, policy, now, action: a as never, actor: ME });
    }
    if (!asked) return; // this seed never offered a claim; the other seeds cover it
    expect(game.deadlines.claim).not.toBeNull();
    const s = resolveExpired(game, karachi, seats, game.deadlines.claim! + 1);
    expect(s).not.toBeNull();
    expect(s!.phase === 'turn' || s!.phase === 'finished').toBe(true);
  });

  it('deals the next hand on request and knows when the game is over', () => {
    let game = dealFirstHand(karachi, seats, 'live-7', policy, T0);
    let now = T0;
    for (let i = 0; i < 400 && game.state.phase !== 'finished'; i++) {
      now += 1000;
      const a = analysisBot(viewFor(game.state, karachi, ME), karachi)!;
      game = step({ game, ruleset: karachi, seats, policy, now, action: a as never, actor: ME });
    }
    const r = step({ game, ruleset: karachi, seats, policy, now, action: { type: 'nextHand' }, actor: ME, seed: 'live-7' });
    expect(r.gameOver).toBe(false);
    expect(r.state.progress.handIndex).toBe(1);
    expect(r.state.phase).not.toBe('finished');
  });

  it('starts the next hand at once on the only person’s tap, naming its hand, with the new hand’s bot moves and nobody left waiting', () => {
    let game = dealFirstHand(karachi, seats, 'live-7', policy, T0);
    let now = T0;
    for (let i = 0; i < 400 && game.state.phase !== 'finished'; i++) {
      now += 1000;
      const a = analysisBot(viewFor(game.state, karachi, ME), karachi)!;
      game = step({ game, ruleset: karachi, seats, policy, now, action: a as never, actor: ME });
    }
    const r = step({ game, ruleset: karachi, seats, policy, now, action: { type: 'nextHand', hand: 0 }, actor: ME, seed: 'live-7' });
    expect(r).toMatchObject({ changed: true, dealt: true, gameOver: false });
    expect(r.state.progress.handIndex).toBe(1);
    expect(r.tableState.ready).toBeNull();
    expect(r.moves.every((m) => m.by === 'bot' || m.by === 'table')).toBe(true);
    expect(r.deadlines.turn !== null || r.deadlines.claim !== null).toBe(true);
    // Without the seed the table can't deal, whoever asks.
    expect(() => step({ game, ruleset: karachi, seats, policy, now, action: { type: 'nextHand', hand: 0 }, actor: ME })).toThrow('starting a hand needs the seed');
  });

  it('refuses "next hand" on a hand that was still live, even when its clock ending would finish it', () => {
    // Play the hand out, keeping the table as it stood before the human's last decision.
    let game = dealFirstHand(karachi, seats, 'live-7', policy, T0);
    let last = game;
    let now = T0;
    for (let i = 0; i < 400 && game.state.phase !== 'finished'; i++) {
      now += 1000;
      last = game;
      const a = analysisBot(viewFor(game.state, karachi, ME), karachi)!;
      game = step({ game, ruleset: karachi, seats, policy, now, action: a as never, actor: ME });
    }
    expect(game.state.phase).toBe('finished');
    const late = (last.deadlines.turn ?? last.deadlines.claim)! + 1;
    // Left to the clock, the stand-in makes that last decision and the hand ends.
    expect(step({ game: last, ruleset: karachi, seats, policy, now: late }).state.phase).toBe('finished');
    // A "next hand" sent then is judged against the table the sender saw, which was not finished.
    expect(() => step({ game: last, ruleset: karachi, seats, policy, now: late, action: { type: 'nextHand' }, actor: ME, seed: 'live-7' })).toThrow(IllegalAction);
  });
});

describe('four bots', () => {
  it('settle plays the hand to the end when no human is seated', () => {
    const bots: Seats = [
      { kind: 'bot', name: 'A' },
      { kind: 'bot', name: 'B' },
      { kind: 'bot', name: 'C' },
      { kind: 'bot', name: 'D' },
    ];
    const game = dealFirstHand(karachi, bots, 'live-8', policy, T0);
    expect(settle(game.state, karachi, bots).phase).toBe('finished');
  });
});

/**
 * Play the human with the sharp bot's brain until a discard they could win on
 * comes past. Common enough that a few seeds always produce one.
 */
function untilWinOffered(): LiveGame {
  for (let i = 0; i < 60; i++) {
    let game: LiveGame = dealFirstHand(karachi, seats, `win-${i}`, policy, T0);
    for (let k = 0; k < 400 && game.state.phase !== 'finished'; k++) {
      const legal = legalActions(game.state, karachi, ME);
      if (legal.claims?.some((c) => c.type === 'win')) return game;
      const a = analysisBot(viewFor(game.state, karachi, ME), karachi) ?? (legal.claims ? { type: 'pass' as const, seat: ME } : null);
      if (!a) throw new Error(`no move for the human in phase ${game.state.phase}`);
      const r = step({
        game,
        ruleset: karachi,
        seats,
        policy,
        now: T0,
        action: a as never,
        actor: ME,
      });
      game = { state: r.state, deadlines: r.deadlines };
    }
  }
  throw new Error('no seed offered the human a win from a discard');
}

describe('a winning tile on the clock', () => {
  it('gives a window with Mahjong on offer the turn clock, not the claim clock', { timeout: 60_000 }, () => {
    const game = untilWinOffered();
    expect(game.state.phase).toBe('claim');
    // Not 20 s: reading "Mahjong!" for the first time takes longer than taking a pung.
    expect(game.deadlines.claim).toBe(T0 + policy.turnSeconds * 1000);
    expect(game.deadlines.turn).toBeNull();
    // Taking it finishes the hand in the human's favour.
    const win = legalActions(game.state, karachi, ME).claims!.find((c) => c.type === 'win')!;
    const r = step({
      game,
      ruleset: karachi,
      seats,
      policy,
      now: T0 + 30_000,
      action: { type: 'claim', seat: ME, claim: win },
      actor: ME,
    });
    expect(r.state.phase).toBe('finished');
    expect(r.state.result).toMatchObject({ type: 'win', winner: ME });
  });

  it('has a bot take the win for a human who let the window expire', { timeout: 60_000 }, () => {
    const game = untilWinOffered();
    const s = resolveExpired(game, karachi, seats, game.deadlines.claim!);
    expect(s).not.toBeNull();
    expect(s!.phase).toBe('finished');
    expect(s!.result).toMatchObject({ type: 'win', winner: ME });
  });
});

describe('coming back after being away', () => {
  it('reports what the stand-in did, so the table can tell the player', { timeout: 60_000 }, () => {
    let game: LiveGame = dealFirstHand(karachi, seats, 'away-1', policy, T0);
    // Play until it is my turn to discard, then vanish for an hour.
    for (let i = 0; i < 100 && !(game.state.phase === 'turn' && game.state.turn === ME); i++) {
      const a = analysisBot(viewFor(game.state, karachi, ME), karachi) ?? { type: 'pass' as const, seat: ME };
      const r = step({ game, ruleset: karachi, seats, policy, now: T0, action: a as never, actor: ME });
      game = { state: r.state, deadlines: r.deadlines };
    }
    expect(game.state.turn).toBe(ME);
    const later = T0 + 3600_000;
    const r = step({ game, ruleset: karachi, seats, policy, now: later });
    expect(r.changed).toBe(true);
    const made = r.moves.filter((m) => m.by === 'clock');
    expect(made.length).toBeGreaterThan(0);
    expect(made[0]!.seat).toBe(ME);
    expect(['discard', 'declareWin', 'declareKong']).toContain(made[0]!.a.type);
    // It's kept for my own table to tell me, whichever phone's request found it: once, and that move.
    const mine = r.tableState.absence[ME];
    expect(mine).toMatchObject({ userId: 'u-me', clockMoves: 1, lastClockMove: made[0], misses: 1, away: null });
    // and the table is back at my next decision with a full clock
    expect((r.deadlines.turn ?? r.deadlines.claim)!).toBeGreaterThan(later);
    // a step with nothing expired reports nothing
    const quiet = step({ game: r, ruleset: karachi, seats, policy, now: later + 1000 });
    expect(quiet.moves.filter((m) => m.by === 'clock')).toEqual([]);
    expect(quiet.changed).toBe(false);
  });
});

/**
 * The bots in empty seats play gently while anyone at the table is new
 * (policy.ts emptySeatBots decides; the table only plays as it is told).
 * Gentle is random, but seeded from the game, so a request always plays out
 * the same way; and a bot standing in for a person whose clock ran out
 * always plays sharp, because it is that person's hand.
 */
describe('the bots in empty seats', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Is the table the same, tile for tile? */
  const same = (a: LiveGame, b: LiveGame) => JSON.stringify(a.state) === JSON.stringify(b.state);

  it('play the same way twice from the same request, with no randomness of their own', { timeout: 60_000 }, () => {
    const random = vi.spyOn(Math, 'random');
    const deal = () => dealFirstHand(karachi, seats, 'gentle-1', policy, T0, { bots: 'gentle' });
    expect(deal()).toEqual(deal());
    let game: LiveGame = deal();
    for (let i = 0; i < 400 && game.state.phase !== 'finished'; i++) {
      const a = analysisBot(viewFor(game.state, karachi, ME), karachi)!;
      const input: StepInput = { game, ruleset: karachi, seats, policy, now: T0 + i * 1000, action: a as ClientAction, actor: ME, bots: 'gentle' };
      const r = step(input);
      expect(step(input)).toEqual(r);
      game = r;
    }
    expect(game.state.phase).toBe('finished');
    const next: StepInput = { game, ruleset: karachi, seats, policy, now: T0, action: { type: 'nextHand' }, actor: ME, seed: 'gentle-1', bots: 'gentle' };
    expect(step(next)).toEqual(step(next));
    expect(random).not.toHaveBeenCalled();
  });

  it('take their randomness from the game and the decision in front of them', () => {
    const s = dealFirstHand(karachi, seats, 'rng-1', policy, T0).state;
    const first = (r: () => number) => [r(), r(), r()];
    expect(first(decisionRandom(s, 1))).toEqual(first(decisionRandom(s, 1)));
    expect(first(decisionRandom(s, 1))).not.toEqual(first(decisionRandom(s, 2)));
    expect(first(decisionRandom(s, 1))).not.toEqual(first(decisionRandom({ ...s, seq: s.seq + 1 }, 1)));
    expect(first(decisionRandom(s, 1))).not.toEqual(first(decisionRandom({ ...s, preplayStep: s.preplayStep + 1 }, 1)));
    expect(first(decisionRandom(s, 1))).not.toEqual(first(decisionRandom({ ...s, progress: { ...s.progress, handIndex: s.progress.handIndex + 1 } }, 1)));
    expect(first(decisionRandom(s, 1))).not.toEqual(first(decisionRandom({ ...s, seed: 'rng-2' }, 1)));
  });

  it('play sharp when nobody says otherwise, as they always have', { timeout: 60_000 }, () => {
    let plain: LiveGame = dealFirstHand(karachi, seats, 'plain-1', policy, T0);
    let sharp: LiveGame = dealFirstHand(karachi, seats, 'plain-1', policy, T0, { bots: 'sharp' });
    expect(sharp).toEqual(plain);
    for (let i = 0; i < 400 && plain.state.phase !== 'finished'; i++) {
      const a = analysisBot(viewFor(plain.state, karachi, ME), karachi)! as ClientAction;
      plain = step({ game: plain, ruleset: karachi, seats, policy, now: T0 + i * 1000, action: a, actor: ME });
      sharp = step({ game: sharp, ruleset: karachi, seats, policy, now: T0 + i * 1000, action: a, actor: ME, bots: 'sharp' });
      expect(same(plain, sharp)).toBe(true);
    }
    expect(plain.state.phase).toBe('finished');
  });

  it('play differently when gentle: the same human moves meet different bot moves on some seed', { timeout: 60_000 }, () => {
    /** The human plays the same sharp moves at both tables until the bots' play makes the tables differ. */
    function differs(seed: string): boolean {
      let sharp: LiveGame = dealFirstHand(karachi, seats, seed, policy, T0, { bots: 'sharp' });
      let gentle: LiveGame = dealFirstHand(karachi, seats, seed, policy, T0, { bots: 'gentle' });
      for (let i = 0; i < 400; i++) {
        if (!same(sharp, gentle)) return true;
        if (sharp.state.phase === 'finished') return false;
        const a = analysisBot(viewFor(sharp.state, karachi, ME), karachi)! as ClientAction;
        sharp = step({ game: sharp, ruleset: karachi, seats, policy, now: T0 + i * 1000, action: a, actor: ME, bots: 'sharp' });
        gentle = step({ game: gentle, ruleset: karachi, seats, policy, now: T0 + i * 1000, action: a, actor: ME, bots: 'gentle' });
      }
      return false;
    }
    const seed = ['gentle-a', 'gentle-b', 'gentle-c', 'gentle-d', 'gentle-e', 'gentle-f'].find(differs);
    expect(seed, 'no seed let a gentle bot play differently from a sharp one').toBeDefined();
  });

  it('never soften a clock’s stand-in: every move made for an absent human is the sharp analysis', { timeout: 60_000 }, () => {
    for (const seed of ['clock-1', 'clock-2']) {
      let game: LiveGame = dealFirstHand(karachi, seats, seed, policy, T0, { bots: 'gentle' });
      let moves = 0;
      for (let i = 0; i < 400 && game.state.phase !== 'finished'; i++) {
        const late = (game.deadlines.turn ?? game.deadlines.claim)! + 1;
        const sharp = analysisBot(viewFor(game.state, karachi, ME), karachi) ?? { type: 'pass' as const, seat: ME };
        const r = step({ game, ruleset: karachi, seats, policy, now: late, bots: 'gentle' });
        expect(r.moves.filter((m) => m.by === 'clock')).toEqual([{ by: 'clock', seat: ME, a: sharp }]);
        moves++;
        // Back at the table each time (the absence left behind), so every one of these is the clock's, never an away seat's.
        game = { state: r.state, deadlines: r.deadlines };
      }
      expect(game.state.phase).toBe('finished');
      expect(moves).toBeGreaterThan(3);
    }
  });
});

/**
 * The hand log: every move a step makes comes back in `moves`, tagged with
 * who made it, so the seed and the log replay to the same table (hand-log.ts).
 */
describe('the moves a step makes', () => {
  const BOTS: readonly Seat[] = [1, 2, 3];

  /** A move the table made on its own: a bot's in a bot seat, or the pass for a person with nothing to claim. */
  function isTableMadeMove(m: Move): boolean {
    if (m.by === 'bot') return m.seat !== undefined && BOTS.includes(m.seat) && m.userId === undefined && isPlayerMove(m.a) && m.a.seat === m.seat;
    if (m.by === 'table') return m.seat === ME && m.userId === undefined && m.a.type === 'pass' && isPlayerMove(m.a) && m.a.seat === ME;
    return false;
  }

  it('tags the player’s own move with their id, and every move the table makes after it', { timeout: 60_000 }, () => {
    let game: LiveGame = dealFirstHand(karachi, seats, 'tags-1', policy, T0);
    const all: Move[] = [];
    for (let i = 0; i < 400 && game.state.phase !== 'finished'; i++) {
      const a = (analysisBot(viewFor(game.state, karachi, ME), karachi) ?? { type: 'pass', seat: ME }) as ClientAction;
      const r = step({ game, ruleset: karachi, seats, policy, now: T0 + i * 1000, action: a, actor: ME });
      expect(r.moves[0]).toEqual({ by: 'player', seat: ME, userId: 'u-me', a });
      expect(r.moves.slice(1).every(isTableMadeMove), JSON.stringify(r.moves)).toBe(true);
      expect(r.dealt).toBe(false);
      expect(r.finishedHand).toBe(r.state.phase === 'finished');
      all.push(...r.moves);
      game = r;
    }
    expect(game.state.phase).toBe('finished');
    expect(all.some((m) => m.by === 'bot')).toBe(true);
    // The log never holds the engine's own move: a claim window closes itself once everyone has answered.
    expect(all.map((m) => m.a.type)).not.toContain('resolveClaims');
  });

  it('tags the pass for a person with nothing to claim as the table’s', { timeout: 60_000 }, () => {
    // A bot's discard that another bot could claim asks everyone else to answer, and the person here has nothing to take.
    const passes = ['tags-2', 'tags-3', 'tags-4', 'tags-5'].flatMap((seed) => {
      let game: LiveGame = dealFirstHand(karachi, seats, seed, policy, T0);
      const found: Move[] = [];
      for (let i = 0; i < 400 && game.state.phase !== 'finished'; i++) {
        const a = (analysisBot(viewFor(game.state, karachi, ME), karachi) ?? { type: 'pass', seat: ME }) as ClientAction;
        const r = step({ game, ruleset: karachi, seats, policy, now: T0 + i * 1000, action: a, actor: ME });
        found.push(...r.moves.filter((m) => m.by === 'table'));
        game = r;
      }
      return found;
    });
    expect(passes.length).toBeGreaterThan(0);
    expect(passes.every((m) => m.seat === ME && m.userId === undefined && m.a.type === 'pass')).toBe(true);
  });

  it('tags a move a clock made as the clock’s, and says when that finished the hand', { timeout: 60_000 }, () => {
    let game: LiveGame = dealFirstHand(karachi, seats, 'tags-6', policy, T0);
    for (let i = 0; i < 400 && game.state.phase !== 'finished'; i++) {
      const late = (game.deadlines.turn ?? game.deadlines.claim)! + 1;
      const r = step({ game, ruleset: karachi, seats, policy, now: late });
      expect(r.moves[0]).toMatchObject({ by: 'clock', seat: ME });
      expect(r.moves.filter((m) => m.by === 'clock')).toHaveLength(1);
      expect(r.moves.slice(1).every((m) => m.by === 'clock' || isTableMadeMove(m))).toBe(true);
      expect(r.finishedHand).toBe(r.state.phase === 'finished');
      // Back at the table each time, so the clock keeps making these moves rather than a bot playing the seat for someone away.
      game = { state: r.state, deadlines: r.deadlines };
    }
    expect(game.state.phase).toBe('finished');
  });

  it('logs nothing for a step that changes nothing, or a "next hand" when the game is over', () => {
    const game = dealFirstHand(karachi, seats, 'tags-7', policy, T0);
    const quiet = step({ game, ruleset: karachi, seats, policy, now: T0 + 1000 });
    expect(quiet).toMatchObject({ changed: false, moves: [], dealt: false, finishedHand: false });
    // A finished last hand: nothing to deal, nothing played.
    const done = settle(game.state, karachi, [seats[1], seats[2], seats[3], { kind: 'bot', name: 'Me' }] as unknown as Seats);
    expect(done.phase).toBe('finished');
    const lastHand = { ...done, progress: { roundWind: 'N' as const, roundIndex: 3, handInRound: 3, handIndex: 15 } };
    const over = step({
      game: { state: lastHand, deadlines: { claim: null, turn: null } },
      ruleset: karachi,
      seats,
      policy,
      now: T0,
      action: { type: 'nextHand' },
      actor: ME,
      seed: 'tags-7',
    });
    expect(over).toMatchObject({ gameOver: true, moves: [], dealt: false, finishedHand: false });
  });

  it('deals the next hand with only that hand’s moves in the step, and a hand finished by a bare step is finished there', { timeout: 60_000 }, () => {
    let game: LiveGame = dealFirstHand(karachi, seats, 'tags-8', policy, T0);
    for (let i = 0; i < 400 && game.state.phase !== 'finished'; i++) {
      const a = (analysisBot(viewFor(game.state, karachi, ME), karachi) ?? { type: 'pass', seat: ME }) as ClientAction;
      game = step({ game, ruleset: karachi, seats, policy, now: T0 + i * 1000, action: a, actor: ME });
    }
    const r = step({ game, ruleset: karachi, seats, policy, now: T0, action: { type: 'nextHand' }, actor: ME, seed: 'tags-8' });
    expect(r.dealt).toBe(true);
    expect(r.finishedHand).toBe(false);
    expect(r.state.dealer).toBe(1);
    // Hand 1's dealer is a bot, so bots move before the person's first decision; every one of those moves is the new hand's.
    expect(r.moves.length).toBeGreaterThan(0);
    expect(r.moves.every(isTableMadeMove)).toBe(true);
    expect(replayHand(karachi, 'tags-8', { progress: r.state.progress, dealer: r.state.dealer }, stamp(r.moves, 2))).toEqual(r.state);

    // A seat that stands up mid-hand: the next bare step plays the rest of the hand for the bots, and says it finished there.
    const allBots = [{ kind: 'bot', name: 'Me' }, seats[1], seats[2], seats[3]] as unknown as Seats;
    const played = step({ game: r, ruleset: karachi, seats: allBots, policy, now: T0 });
    expect(played).toMatchObject({ changed: true, dealt: false, finishedHand: true });
    expect(played.state.phase).toBe('finished');
    expect(played.moves.every((m) => m.by === 'bot' || m.by === 'table')).toBe(true);
    expect(replayHand(karachi, 'tags-8', { progress: r.state.progress, dealer: r.state.dealer }, [...stamp(r.moves, 2), ...stamp(played.moves, 3)])).toEqual(played.state);
  });

  it('gives the deal’s bot moves with the first hand', () => {
    const late: Seats = [seats[1], seats[2], seats[0], seats[3]] as unknown as Seats;
    const first = dealFirstHand(karachi, late, 'tags-9', policy, T0);
    // Seat 0 deals, and it's a bot: the bots have moved before the person in seat 2 decides anything.
    expect(first.moves.length).toBeGreaterThan(0);
    expect(first.moves.every((m) => (m.by === 'bot' && m.seat !== 2) || (m.by === 'table' && m.seat === 2 && m.a.type === 'pass'))).toBe(true);
    expect(replayHand(karachi, 'tags-9', { progress: first.state.progress, dealer: first.state.dealer }, stamp(first.moves, 1))).toEqual(first.state);
    // When the person deals, nothing has happened yet.
    expect(dealFirstHand(karachi, seats, 'tags-9', policy, T0).moves).toEqual([]);
  });
});

/**
 * The table's running scores (table_state.scores) move inside step, in the
 * same step as the hand that wins them, so they're saved with it.
 */
describe('the running scores', () => {
  /** Where the game stood before this hand, with a key from a newer deploy that must come through untouched. */
  const table: TableState = { v: 1, scores: [100, -100, 0, 0], over: null, absence: EVERYONE_HERE, ready: null, extra: { later: { kept: true } } };

  /** The totals with a won hand's transfers added, worked out here rather than by the code under test. */
  function plus(scores: readonly number[], s: HandState): number[] {
    const next = [...scores];
    if (s.result?.type === 'win') for (const t of s.result.settlement.transfers) ((next[t.from]! -= t.amount), (next[t.to]! += t.amount));
    return next;
  }

  /** The human plays the hand out; every step but the last must hand the table back as it was given (bar when they last tapped). */
  function playOut(seed: string): { last: ReturnType<typeof step>; before: LiveGame } {
    let game: LiveGame = { ...dealFirstHand(karachi, seats, seed, policy, T0), tableState: table };
    for (let i = 0; i < 400; i++) {
      const a = (analysisBot(viewFor(game.state, karachi, ME), karachi) ?? { type: 'pass', seat: ME }) as ClientAction;
      const r = step({ game, ruleset: karachi, seats, policy, now: T0 + i * 1000, action: a, actor: ME });
      if (r.state.phase === 'finished') return { last: r, before: game };
      expect(sameTableState(r.tableState, table)).toBe(true);
      expect(r.tableState).toMatchObject({ scores: table.scores, over: null, extra: table.extra });
      game = r;
    }
    throw new Error('the hand never finished');
  }

  it('adds a hand won in a step to the table’s running scores, keeping the rest of the table as it was', { timeout: 60_000 }, () => {
    const { last } = playOut('writes-2');
    expect(last.state.result?.type).toBe('win');
    expect(last.finishedHand).toBe(true);
    expect(last.changed).toBe(true);
    expect(last.tableState.scores).toEqual(plus(table.scores!, last.state));
    expect(last.tableState.scores).not.toEqual(table.scores);
    expect(last.tableState).toMatchObject({ v: 1, extra: { later: { kept: true } } });
    // The table it was given is left as it was.
    expect(table.scores).toEqual([100, -100, 0, 0]);
  });

  it('adds nothing for a washout', { timeout: 60_000 }, () => {
    const { last } = playOut('writes-1');
    expect(last.state.result?.type).toBe('draw');
    expect(last.finishedHand).toBe(true);
    expect(last.tableState.scores).toBe(table.scores);
    expect(sameTableState(last.tableState, table)).toBe(true);
  });

  it('passes the table through untouched when nothing happens, and calls that no change', () => {
    const game: LiveGame = { ...dealFirstHand(karachi, seats, 'scores-1', policy, T0), tableState: table };
    const quiet = step({ game, ruleset: karachi, seats, policy, now: T0 + 1000 });
    expect(quiet.changed).toBe(false);
    expect(quiet.tableState).toBe(table);
    expect(quiet.state).toBe(game.state);
    // A table with no bookkeeping yet starts from a fresh one.
    const fresh = step({ game: { state: game.state, deadlines: game.deadlines }, ruleset: karachi, seats, policy, now: T0 + 1000 });
    expect(fresh).toMatchObject({ changed: false, tableState: NEW_TABLE });
  });

  it('adds the points of a hand dealt and finished in the same step', { timeout: 60_000 }, () => {
    // Four bots: the deal of the next hand plays it to its end in the step that deals it. Nobody's there to tap Next hand, so
    // it's the wait running out that starts it, on the step that finds it has.
    const bots = [
      { kind: 'bot', name: 'A' },
      { kind: 'bot', name: 'B' },
      { kind: 'bot', name: 'C' },
      { kind: 'bot', name: 'D' },
    ] as unknown as Seats;
    let won: ReturnType<typeof step> | undefined;
    for (const seed of ['dealt-1', 'dealt-2', 'dealt-3', 'dealt-4', 'dealt-5', 'dealt-6']) {
      const first = dealFirstHand(karachi, bots, seed, policy, T0);
      expect(first.state.phase).toBe('finished');
      const waited: TableState = { ...table, ready: { hand: 0, userIds: [], dealAt: T0 } };
      const r = step({ game: { ...first, deadlines: { claim: null, turn: T0 }, tableState: waited }, ruleset: karachi, seats: bots, policy, now: T0, seed });
      if (r.state.result?.type === 'win') {
        won = r;
        break;
      }
    }
    expect(won, 'no seed gave a won hand at a table of bots').toBeDefined();
    expect(won).toMatchObject({ dealt: true, finishedHand: true, changed: true });
    expect(won!.state.progress.handIndex).toBe(1);
    expect(won!.tableState.scores).toEqual(plus(table.scores!, won!.state));
  });
});

/**
 * The game ends in the step that ends it (R12): its last hand scored, however
 * that happened, needs no tap, and the end is saved in table_state.over with
 * the step's own totals. After that the table takes nothing more.
 */
describe('the end of the game', () => {
  const NORTH_3: GameProgress = { roundWind: 'N', roundIndex: 3, handInRound: 3, handIndex: 15 };
  const before: TableState = { v: 1, scores: [100, -100, 0, 0], over: null, absence: EVERYONE_HERE, ready: null, extra: { later: { kept: true } } };

  /** The totals with a won hand's transfers added, worked out here rather than by the code under test. */
  function plus(scores: readonly number[], s: HandState): number[] {
    const next = [...scores];
    if (s.result?.type === 'win') for (const t of s.result.settlement.transfers) ((next[t.from]! -= t.amount), (next[t.to]! += t.amount));
    return next;
  }

  /** The game's sixteenth hand, dealt and played by the bots up to the person's first decision. */
  function lastHand(seed: string): LiveGame {
    const state = settle(startHand(karachi, { seed, progress: NORTH_3, dealer: 3 }), karachi, seats);
    return { state, deadlines: { claim: null, turn: T0 + 60_000 }, tableState: before };
  }

  /** The person plays the last hand out: the step that finishes it, and the table before that step. */
  function playLast(seed: string): { last: ReturnType<typeof step>; prev: LiveGame } {
    let game = lastHand(seed);
    for (let i = 0; i < 400; i++) {
      const a = (analysisBot(viewFor(game.state, karachi, ME), karachi) ?? { type: 'pass', seat: ME }) as ClientAction;
      const r = step({ game, ruleset: karachi, seats, policy, now: T0 + i * 1000, action: a, actor: ME });
      if (r.state.phase === 'finished') return { last: r, prev: game };
      expect(r.gameOver).toBe(false);
      expect(r.tableState.over).toBeNull();
      game = r;
    }
    throw new Error('the hand never finished');
  }

  /** The first seed whose last hand the person's own move ends with a win (searched once). */
  let won: { last: ReturnType<typeof step>; prev: LiveGame; seed: string } | null = null;
  function wonLast(): { last: ReturnType<typeof step>; prev: LiveGame; seed: string } {
    for (const seed of ['end-1', 'end-2', 'end-3', 'end-4', 'end-5', 'end-6', 'end-7', 'end-8']) {
      if (won) break;
      const played = playLast(seed);
      if (played.last.state.result?.type === 'win') won = { ...played, seed };
    }
    if (!won) throw new Error('no seed gave a won last hand');
    return won;
  }

  it('ends the game with the move that scores its last hand, with no tap, no clock and the hand’s points in', { timeout: 60_000 }, () => {
    const { last } = wonLast();
    expect(last).toMatchObject({ changed: true, gameOver: true, finishedHand: true, dealt: false, deadlines: { claim: null, turn: null } });
    expect(last.tableState.scores).toEqual(plus(before.scores!, last.state));
    expect(last.tableState.over).toEqual({ how: 'complete', by: null, at: expect.any(Number), hands: 16, scores: last.tableState.scores, seats });
    // The rest of the table's bookkeeping comes through untouched.
    expect(last.tableState.extra).toEqual({ later: { kept: true } });
    // No note: the log's last move is the one that won.
    expect(last.moves.every((m) => m.a.type !== 'endGame')).toBe(true);
  });

  it('ends it the same when the last hand ends on a clock, through a tick', { timeout: 60_000 }, () => {
    const { prev } = wonLast();
    const late = (prev.deadlines.turn ?? prev.deadlines.claim)! + 1;
    const r = step({ game: prev, ruleset: karachi, seats, policy, now: late });
    expect(r.state.phase).toBe('finished');
    expect(r.moves[0]).toMatchObject({ by: 'clock', seat: ME });
    expect(r).toMatchObject({ changed: true, gameOver: true, finishedHand: true, deadlines: { claim: null, turn: null } });
    expect(r.tableState.over).toMatchObject({ how: 'complete', at: late, hands: 16, scores: plus(before.scores!, r.state) });
  });

  it('ends a finished last hand the natural end never saw, saved before it existed, on a "next hand" tap', () => {
    const done = settle(dealFirstHand(karachi, seats, 'end-legacy', policy, T0).state, karachi, [seats[1], seats[2], seats[3], { kind: 'bot', name: 'Me' }] as unknown as Seats);
    const parked = { ...done, progress: NORTH_3 };
    const r = step({
      game: { state: parked, deadlines: { claim: null, turn: null }, tableState: before },
      ruleset: karachi,
      seats,
      policy,
      now: T0,
      action: { type: 'nextHand' },
      actor: ME,
    });
    expect(r).toMatchObject({ changed: true, gameOver: true, finishedHand: false, dealt: false, moves: [], deadlines: { claim: null, turn: null } });
    expect(r.state).toBe(parked);
    // The hand's points were already in the totals: the end takes them as they stand. The tap was the player's (R4).
    expect(r.tableState).toEqual({ ...before, absence: r.tableState.absence, over: { how: 'complete', by: null, at: T0, hands: 16, scores: before.scores, seats } });
    expect(r.tableState.absence[ME]).toMatchObject({ userId: 'u-me', lastTap: T0, misses: 0, away: null });
  });

  it('takes nothing more once the game is over: every move and end is refused, and a bare step changes nothing', { timeout: 60_000 }, () => {
    const { last, seed } = wonLast();
    const ended: LiveGame = last;
    const tries: Partial<StepInput>[] = [
      { action: { type: 'nextHand' }, actor: ME, seed },
      { action: { type: 'pass', seat: ME }, actor: ME },
      { action: { type: 'discard', seat: ME, tile: 'm1' }, actor: ME },
      { end: { how: 'abandoned', by: null } },
      { change: { type: 'back', seat: ME } },
      { change: { type: 'letBotPlay', seat: 1, bySeat: ME, sawAt: null } },
    ];
    for (const t of tries) {
      const err = (() => {
        try {
          step({ game: ended, ruleset: karachi, seats, policy, now: T0 + 999_000, ...t });
        } catch (e) {
          return e;
        }
        return null;
      })();
      expect(err, JSON.stringify(t)).toBeInstanceOf(GameIsOver);
      expect((err as Error).message).toBe('game is over');
      expect(rejectionStatus(err)).toBe(409);
    }
    // A tick or a sweep long after: nothing to do, nothing to write, and the table comes back as it was.
    const quiet = step({ game: ended, ruleset: karachi, seats, policy, now: T0 + 999_000 });
    expect(quiet).toMatchObject({ changed: false, gameOver: false, moves: [], dealt: false, finishedHand: false, awayAtEnd: null, dropped: false });
    expect(quiet.state).toBe(ended.state);
    expect(quiet.tableState).toBe(ended.tableState);
    expect(quiet.deadlines).toBe(ended.deadlines);
  });

  it('abandons a hand in play with one note, saying nobody ended it, and counts only the hands that finished', () => {
    const first = dealFirstHand(karachi, seats, 'end-abandon', policy, T0);
    const game: LiveGame = { ...first, tableState: before };
    expect(game.state.phase).not.toBe('finished');
    const r = step({ game, ruleset: karachi, seats, policy, now: T0 + 1000, end: { how: 'abandoned', by: null } });
    expect(r).toMatchObject({ changed: true, gameOver: true, finishedHand: false, dealt: false, deadlines: { claim: null, turn: null } });
    expect(r.state).toBe(game.state);
    expect(r.moves).toEqual([{ by: 'table', a: { type: 'endGame', how: 'abandoned' } }]);
    expect(r.moves[0]).not.toHaveProperty('seat');
    expect(r.tableState.over).toEqual({ how: 'abandoned', by: null, at: T0 + 1000, hands: 0, scores: before.scores, seats });
    // The note replays as nothing: the hand's log still gives the hand.
    expect(replayHand(karachi, 'end-abandon', { progress: game.state.progress, dealer: game.state.dealer }, [...stamp(first.moves, 1), ...stamp(r.moves, 2)])).toEqual(game.state);
  });

  it('logs no note for an end between hands, whose log is already complete', () => {
    const done = settle(dealFirstHand(karachi, seats, 'end-between', policy, T0).state, karachi, [seats[1], seats[2], seats[3], { kind: 'bot', name: 'Me' }] as unknown as Seats);
    const r = step({
      game: { state: done, deadlines: { claim: null, turn: null }, tableState: before },
      ruleset: karachi,
      seats,
      policy,
      now: T0,
      end: { how: 'abandoned', by: null },
    });
    expect(r).toMatchObject({ gameOver: true, moves: [] });
    expect(r.tableState.over).toMatchObject({ how: 'abandoned', hands: 1 });
  });

  /** A hand of the second round (its sixth), dealt, or played to the end by bots in every seat. */
  const SOUTH_2: GameProgress = { roundWind: 'S', roundIndex: 1, handInRound: 1, handIndex: 5 };
  const allBots = [seats[1], seats[2], seats[3], { kind: 'bot', name: 'Me' }] as unknown as Seats;
  const HOST = { userId: 'u-me', name: 'Me' };

  it('lets the host end the game mid-hand: that hand doesn’t count, no points move, and its log says the host ended it', { timeout: 60_000 }, () => {
    const state = settle(startHand(karachi, { seed: 'end-host', progress: SOUTH_2, dealer: 1 }), karachi, seats);
    expect(state.phase).not.toBe('finished');
    const game: LiveGame = { state, deadlines: { claim: null, turn: T0 + 60_000 }, tableState: before };
    const r = step({ game, ruleset: karachi, seats, policy, now: T0 + 1000, end: { how: 'host', by: HOST } });
    expect(r).toMatchObject({ changed: true, gameOver: true, finishedHand: false, dealt: false, deadlines: { claim: null, turn: null } });
    expect(r.state).toBe(state);
    // Five hands finished before this one; this one is cut short.
    expect(r.tableState.over).toEqual({ how: 'host', by: HOST, at: T0 + 1000, hands: 5, scores: before.scores, seats });
    expect(r.moves).toEqual([{ by: 'host', userId: 'u-me', a: { type: 'endGame', how: 'host' } }]);
    expect(r.moves[0]).not.toHaveProperty('seat');
  });

  it('starts no hand in a step that ends the game, however long the wait for it has run', { timeout: 60_000 }, () => {
    const done = settle(startHand(karachi, { seed: 'end-host-between', progress: SOUTH_2, dealer: 1 }), karachi, allBots);
    const waited: TableState = { ...before, ready: { hand: 5, userIds: ['u-me'], dealAt: T0 } };
    const game: LiveGame = { state: done, deadlines: { claim: null, turn: T0 }, tableState: waited };
    for (const end of [
      { how: 'host', by: HOST },
      { how: 'idle', by: null },
    ] as const) {
      const r = step({ game, ruleset: karachi, seats, policy, now: T0 + 60_000, seed: 'end-host-between', end });
      expect(r, end.how).toMatchObject({ changed: true, gameOver: true, dealt: false, moves: [], deadlines: { claim: null, turn: null } });
      expect(r.state).toBe(done);
      expect(r.tableState.over).toMatchObject({ how: end.how, hands: 6 });
    }
  });

  it('lets the host end the game between hands, counting the hand just finished, with nothing more in its log', { timeout: 60_000 }, () => {
    const done = settle(startHand(karachi, { seed: 'end-host-between', progress: SOUTH_2, dealer: 1 }), karachi, allBots);
    expect(done.phase).toBe('finished');
    const r = step({ game: { state: done, deadlines: { claim: null, turn: null }, tableState: before }, ruleset: karachi, seats, policy, now: T0, end: { how: 'host', by: HOST } });
    expect(r).toMatchObject({ changed: true, gameOver: true, moves: [], deadlines: { claim: null, turn: null } });
    expect(r.tableState.over).toEqual({ how: 'host', by: HOST, at: T0, hands: 6, scores: before.scores, seats });
  });

  it('records an end that finds the last hand scored as the game played out, whoever ends it', { timeout: 60_000 }, () => {
    const done = settle(dealFirstHand(karachi, seats, 'end-last', policy, T0).state, karachi, allBots);
    const parked = { ...done, progress: NORTH_3 };
    const game: LiveGame = { state: parked, deadlines: { claim: null, turn: null }, tableState: before };
    const byHost = step({ game, ruleset: karachi, seats, policy, now: T0, end: { how: 'host', by: HOST } });
    expect(byHost.tableState.over).toEqual({ how: 'complete', by: HOST, at: T0, hands: 16, scores: before.scores, seats });
    expect(byHost.moves).toEqual([]);
    const idle = step({ game, ruleset: karachi, seats, policy, now: T0, end: { how: 'idle', by: null } });
    expect(idle.tableState.over).toMatchObject({ how: 'complete', by: null, hands: 16 });
    // Everyone leaving is still an abandon: there's nobody to show a final table to.
    const left = step({ game, ruleset: karachi, seats, policy, now: T0, end: { how: 'abandoned', by: null } });
    expect(left.tableState.over).toMatchObject({ how: 'abandoned', hands: 16 });
  });

  it('ends a game nobody is playing as idle, by nobody: the table’s own note, with no one’s id', () => {
    const first = dealFirstHand(karachi, seats, 'end-idle', policy, T0);
    const r = step({ game: { ...first, tableState: before }, ruleset: karachi, seats, policy, now: T0 + 1000, end: { how: 'idle', by: null } });
    expect(r).toMatchObject({ changed: true, gameOver: true, deadlines: { claim: null, turn: null } });
    expect(r.moves).toEqual([{ by: 'table', a: { type: 'endGame', how: 'idle' } }]);
    expect(r.tableState.over).toEqual({ how: 'idle', by: null, at: T0 + 1000, hands: 0, scores: before.scores, seats });
  });

  it('never takes an action and an end in one step', () => {
    const game = dealFirstHand(karachi, seats, 'end-both', policy, T0);
    expect(() => step({ game, ruleset: karachi, seats, policy, now: T0, action: { type: 'pass', seat: ME }, actor: ME, end: { how: 'abandoned', by: null } })).toThrow(
      /one of an action, a change or an end/,
    );
  });
});

/**
 * Absence (R1-R8): two missed turns make a seat away, and a bot plays it at
 * once, sharply, with no clock; any tap of the person's own but a pass brings
 * them back; the host can hand another person's seat to a bot unless they've
 * just tapped; and a clock keeps running while the table waits on the same
 * decision.
 */
describe('away seats', () => {
  const BILAL = { kind: 'human', userId: 'u-bilal', name: 'Bilal' } as const;
  /** Me and Bilal, with two bots. */
  const two: Seats = [seats[0], BILAL, seats[2], seats[3]];
  const WEST: GameProgress = { roundWind: 'W', roundIndex: 2, handInRound: 0, handIndex: 8 };

  /** The person the table is waiting on first, or null. */
  function waitingOn(g: LiveGame, s: Seats): Seat | null {
    const st = g.state;
    const person = (seat: Seat) => isHuman(s, seat) && !isAway(g.tableState?.absence, s, seat);
    if (st.phase === 'turn') return person(st.turn) ? st.turn : null;
    if (st.phase === 'claim') return ([0, 1, 2, 3] as Seat[]).find((seat) => person(seat) && legalActions(st, karachi, seat).claims !== undefined) ?? null;
    if (st.phase === 'preplay') return ([0, 1, 2, 3] as Seat[]).find((seat) => person(seat) && legalActions(st, karachi, seat).exchange !== undefined) ?? null;
    return null;
  }

  /** What the person at `seat` plays: the analysis, or a pass. */
  function choice(g: LiveGame, seat: Seat): ClientAction {
    return (analysisBot(viewFor(g.state, karachi, seat), karachi) ?? { type: 'pass', seat }) as ClientAction;
  }

  /** From the deal, the people playing their own moves until `stop` says so. */
  function driveTo(seed: string, s: Seats, stop: (g: LiveGame) => boolean, start?: LiveGame): LiveGame | null {
    let g: LiveGame = start ?? { ...dealFirstHand(karachi, s, seed, policy, T0), tableState: NEW_TABLE };
    for (let i = 0; i < 400; i++) {
      if (stop(g)) return g;
      const seat = waitingOn(g, s);
      if (seat === null) return null;
      g = step({ game: g, ruleset: karachi, seats: s, policy, now: T0 + i, action: choice(g, seat), actor: seat, seed });
    }
    return null;
  }

  /** The first of `seeds` for which `make` finds something. */
  function first<T>(seeds: readonly string[], make: (seed: string) => T | null): T {
    for (const seed of seeds) {
      const found = make(seed);
      if (found) return found;
    }
    throw new Error('no seed found one');
  }
  const SEEDS = Array.from({ length: 30 }, (_, i) => `away-${i}`);

  const myTurn = (g: LiveGame) => g.state.phase === 'turn' && g.state.turn === ME;
  const bilalsTurn = (g: LiveGame) => g.state.phase === 'turn' && g.state.turn === 1;
  const myClaim = (g: LiveGame) => g.state.phase === 'claim' && (legalActions(g.state, karachi, ME).claims?.length ?? 0) > 0;
  /** A moment after the running clock ran out. */
  const late = (g: LiveGame) => (g.deadlines.turn ?? g.deadlines.claim)! + 1;
  /** One miss on my seat already. */
  const oneMiss = (g: LiveGame): LiveGame => ({
    ...g,
    tableState: { ...(g.tableState ?? NEW_TABLE), absence: noteClockMove(EVERYONE_HERE, seats, { by: 'clock', seat: ME, a: { type: 'pass', seat: ME } }, true) },
  });

  it('makes a seat away on its second missed turn, notes it, and plays the seat in the same step with no clock', { timeout: 60_000 }, () => {
    let g: LiveGame = driveTo('away-miss', seats, myTurn)!;
    let turnsMissed = 0;
    let went: StepResult | null = null;
    for (let i = 0; i < 40 && !went; i++) {
      const wasTurn = g.state.phase === 'turn' || g.state.phase === 'preplay';
      const missesBefore = g.tableState!.absence[ME].misses;
      const r = step({ game: g, ruleset: karachi, seats, policy, now: late(g), bots: 'gentle' });
      if (wasTurn) turnsMissed++;
      // A claim window that runs out never counts, either way.
      else expect(r.tableState.absence[ME].misses).toBe(missesBefore);
      if (isAway(r.tableState.absence, seats, ME)) went = r;
      else g = r;
    }
    expect(went, 'my seat never went away').not.toBeNull();
    expect(turnsMissed).toBe(2);
    const r = went!;
    const clock = r.moves.findIndex((m) => m.by === 'clock');
    expect(r.moves[clock + 1]).toEqual({ by: 'table', seat: ME, a: { type: 'away', reason: 'clock' } });
    // Its next decision is played in the same step, by its bot, and nobody's clock runs: there's no one here.
    expect(
      r.moves
        .slice(clock + 2)
        .filter((m) => m.seat === ME)
        .every((m) => m.by === 'away' || (m.by === 'table' && m.a.type === 'pass')),
    ).toBe(true);
    expect(r.deadlines).toEqual({ claim: null, turn: null });
    expect(r.tableState.absence[ME]).toMatchObject({ misses: 2, away: 'clock', clockMoves: 2 });
  });

  it('counts a pass of tiles whose clock ran out as a miss', () => {
    const g = first(SEEDS, (seed) => {
      const state = settle(startHand(karachi, { seed, progress: WEST, dealer: 0 }), karachi, seats);
      if (state.phase !== 'preplay' || !legalActions(state, karachi, ME).exchange) return null;
      return { state, deadlines: deadlinesFor(state, karachi, seats, policy, T0), tableState: NEW_TABLE } as LiveGame;
    });
    const r = step({ game: g, ruleset: karachi, seats, policy, now: g.deadlines.turn! + 1 });
    expect(r.moves[0]).toMatchObject({ by: 'clock', seat: ME, a: { type: 'exchange' } });
    expect(r.tableState.absence[ME]).toMatchObject({ misses: 1, clockMoves: 1 });
  });

  it('brings someone back with any move of their own but a pass; a tick or a look doesn’t', () => {
    const g = oneMiss(driveTo('away-tap', seats, myTurn)!);
    const tick = step({ game: g, ruleset: karachi, seats, policy, now: T0 + 1 });
    expect(tick.changed).toBe(false);
    expect(tick.tableState.absence[ME].misses).toBe(1);
    const r = step({ game: g, ruleset: karachi, seats, policy, now: T0 + 5, action: choice(g, ME), actor: ME, version: 12 });
    // Noted with the version this step saves the table as, for the host's hand-over (R8).
    expect(r.tableState.absence[ME]).toMatchObject({ misses: 0, away: null, lastTap: T0 + 5, tapVersion: 12 });
  });

  it('changes nothing in the passer’s own entry for a pass: no miss cleared, not brought back, no tap noted', { timeout: 60_000 }, () => {
    const g = first(SEEDS, (seed) => driveTo(seed, two, myClaim));
    const pass: ClientAction = { type: 'pass', seat: ME };
    const missed = oneMiss(g);
    const r = step({ game: missed, ruleset: karachi, seats: two, policy, now: T0 + 9, action: pass, actor: ME });
    expect(r.moves[0]).toEqual({ by: 'player', seat: ME, userId: 'u-me', a: pass });
    expect(r.tableState.absence[ME]).toEqual(missed.tableState!.absence[ME]);
    // The page of someone a bot is playing for, left open, passing by itself: they stay away.
    const away: LiveGame = { ...g, tableState: { ...NEW_TABLE, absence: markAway(EVERYONE_HERE, two, ME, 'host') } };
    const still = step({ game: away, ruleset: karachi, seats: two, policy, now: T0 + 9, action: pass, actor: ME });
    expect(isAway(still.tableState.absence, two, ME)).toBe(true);
    // And the pass stamped no tap, so the host's hand-over from a table sent before it still goes ahead (R8).
    expect(r.tableState.absence[ME].lastTap).toBeNull();
    const handed = step({ game: r, ruleset: karachi, seats: two, policy, now: T0 + 20, change: { type: 'letBotPlay', seat: ME, bySeat: 1, sawAt: T0 + 1 } });
    expect(isAway(handed.tableState.absence, two, ME)).toBe(true);
  });

  it('brings a seat back on "back", with a note, and keeps every running clock; a second "back" is no change', { timeout: 60_000 }, () => {
    const g = first(SEEDS, (seed) => driveTo(seed, two, bilalsTurn));
    const away: LiveGame = { ...g, tableState: { ...NEW_TABLE, absence: markAway(EVERYONE_HERE, two, ME, 'host') } };
    const r = step({ game: away, ruleset: karachi, seats: two, policy, now: T0 + 50, change: { type: 'back', seat: ME } });
    expect(r).toMatchObject({ changed: true, dealt: false, finishedHand: false });
    expect(r.moves).toEqual([{ by: 'player', seat: ME, userId: 'u-me', a: { type: 'back' } }]);
    expect(r.state).toBe(g.state);
    expect(r.deadlines).toBe(g.deadlines);
    expect(isAway(r.tableState.absence, two, ME)).toBe(false);
    const again = step({ game: r, ruleset: karachi, seats: two, policy, now: T0 + 60, change: { type: 'back', seat: ME } });
    expect(again).toMatchObject({ changed: false, moves: [] });
  });

  it('hands another person’s seat to a bot for the host, unless it’s a bot’s already or they’ve tapped since the host looked', { timeout: 60_000 }, () => {
    const g = first(SEEDS, (seed) => driveTo(seed, two, bilalsTurn));
    // Bilal (the host here, and the one being waited on) hands my seat, which nobody is waiting on, to a bot.
    const r = step({ game: g, ruleset: karachi, seats: two, policy, now: T0 + 50, change: { type: 'letBotPlay', seat: ME, bySeat: 1, sawAt: null } });
    expect(r.moves).toEqual([{ by: 'host', seat: ME, userId: 'u-bilal', a: { type: 'away', reason: 'host' } }]);
    expect(r.tableState.absence[ME]).toMatchObject({ away: 'host' });
    expect(r.tableState.absence[1]).toMatchObject({ userId: 'u-bilal', lastTap: T0 + 50 });
    expect(r.deadlines).toBe(g.deadlines);
    // A seat already away: nothing new.
    expect(step({ game: r, ruleset: karachi, seats: two, policy, now: T0 + 50, change: { type: 'letBotPlay', seat: ME, bySeat: 1, sawAt: null } }).changed).toBe(false);
    expect(() => step({ game: g, ruleset: karachi, seats: two, policy, now: T0, change: { type: 'letBotPlay', seat: 2, bySeat: 1, sawAt: null } })).toThrow(NotYourMove);
    const tapped: LiveGame = { ...g, tableState: { ...NEW_TABLE, absence: markPresent(EVERYONE_HERE, two, ME, T0 + 10) } };
    const err = (() => {
      try {
        step({ game: tapped, ruleset: karachi, seats: two, policy, now: T0 + 50, change: { type: 'letBotPlay', seat: ME, bySeat: 1, sawAt: T0 + 5 } });
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(err).toBeInstanceOf(JustPlayed);
    expect((err as Error).message).toBe('that player has just played');
    expect(rejectionStatus(err)).toBe(409);
    // Seen by the host after the tap, it goes ahead.
    expect(
      isAway(
        step({ game: tapped, ruleset: karachi, seats: two, policy, now: T0 + 50, change: { type: 'letBotPlay', seat: ME, bySeat: 1, sawAt: T0 + 10 } }).tableState.absence,
        two,
        ME,
      ),
    ).toBe(true);
  });

  it('judges the host’s hand-over by versions when both sides have one, and by the clock only when either hasn’t', { timeout: 60_000 }, () => {
    const g = first(SEEDS, (seed) => driveTo(seed, two, bilalsTurn));
    const handOver = (game: LiveGame, sawAt: number | null, sawVersion?: number | null) => () =>
      step({
        game,
        ruleset: karachi,
        seats: two,
        policy,
        now: T0 + 50,
        version: 9,
        change: { type: 'letBotPlay', seat: ME, bySeat: 1, sawAt, ...(sawVersion !== undefined ? { sawVersion } : {}) },
      });
    // My tap's request began at T0 + 5, before the host's table was read at T0 + 10, but it landed after that read, as version 8.
    const tapped: LiveGame = { ...g, tableState: { ...NEW_TABLE, absence: markPresent(EVERYONE_HERE, two, ME, T0 + 5, 8) } };
    expect(handOver(tapped, T0 + 10, 7)).toThrow(JustPlayed);
    // A host's table of version 8 or later had the tap in it, whatever its clock said.
    expect(isAway(handOver(tapped, T0 + 1, 8)().tableState.absence, two, ME)).toBe(true);
    // A page that sends no version is judged by the clock, as before.
    expect(isAway(handOver(tapped, T0 + 10)().tableState.absence, two, ME)).toBe(true);
    expect(handOver(tapped, T0 + 1, null)).toThrow(JustPlayed);
    // So is a tap saved before versions were kept.
    const before: LiveGame = { ...g, tableState: { ...NEW_TABLE, absence: markPresent(EVERYONE_HERE, two, ME, T0 + 5) } };
    expect(handOver(before, T0 + 1, 20)).toThrow(JustPlayed);
    expect(isAway(handOver(before, T0 + 10, 3)().tableState.absence, two, ME)).toBe(true);
    // The host's own tap is noted with the version this step saves as.
    expect(handOver(tapped, T0 + 1, 8)().tableState.absence[1]).toMatchObject({ lastTap: T0 + 50, tapVersion: 9 });
  });

  it('plays a seat handed over on its own turn at once, and starts a clock for whoever is next', { timeout: 60_000 }, () => {
    const g = first(SEEDS, (seed) => driveTo(seed, two, myTurn));
    const r = step({ game: g, ruleset: karachi, seats: two, policy, now: T0 + 50, change: { type: 'letBotPlay', seat: ME, bySeat: 1, sawAt: null } });
    expect(r.moves[0]).toEqual({ by: 'host', seat: ME, userId: 'u-bilal', a: { type: 'away', reason: 'host' } });
    expect(r.moves[1]).toMatchObject({ by: 'away', seat: ME });
    if (r.state.phase !== 'finished') expect(r.deadlines).toEqual(deadlinesFor(r.state, karachi, two, policy, T0 + 50, r.tableState.absence));
  });

  it('drops a move that comes in after its own clock ran out, counts no miss for it, and logs what the clock did', () => {
    const g = driveTo('away-late', seats, myTurn)!;
    const move = choice(g, ME);
    const r = step({ game: g, ruleset: karachi, seats, policy, now: late(g), action: move, actor: ME });
    expect(r).toMatchObject({ dropped: true, changed: true });
    expect(r.moves[0]).toMatchObject({ by: 'clock', seat: ME });
    expect(r.moves.some((m) => m.by === 'player')).toBe(false);
    // Here, since it was a tap, and told what the clock did, but no miss.
    expect(r.tableState.absence[ME]).toMatchObject({ misses: 0, away: null, lastTap: late(g), clockMoves: 1 });
  });

  it('drops a pass that comes in after its claim window closed, and leaves the passer as they were', { timeout: 60_000 }, () => {
    const g = oneMiss(first(SEEDS, (seed) => driveTo(seed, two, myClaim)));
    const r = step({ game: g, ruleset: karachi, seats: two, policy, now: late(g), action: { type: 'pass', seat: ME }, actor: ME });
    expect(r).toMatchObject({ dropped: true, changed: true });
    expect(r.moves[0]).toMatchObject({ by: 'clock', seat: ME });
    // Neither a miss nor a tap: only told what the clock did for them.
    const before = g.tableState!.absence[ME];
    expect(r.tableState.absence[ME]).toEqual({ ...before, clockMoves: before.clockMoves + 1, lastClockMove: r.moves[0] });
  });

  it('starts afresh a seat whose entry is someone else’s now, and saves that', () => {
    const g = driveTo('away-reset', seats, myTurn)!;
    const stale: LiveGame = {
      ...g,
      tableState: {
        ...NEW_TABLE,
        absence: noteClockMove(
          EVERYONE_HERE,
          [{ kind: 'human', userId: 'u-old', name: 'Old' }, ...seats.slice(1)] as unknown as Seats,
          { by: 'clock', seat: ME, a: { type: 'pass', seat: ME } },
          true,
        ),
      },
    };
    const r = step({ game: stale, ruleset: karachi, seats, policy, now: T0 + 1 });
    expect(r.changed).toBe(true);
    expect(r.tableState.absence[ME]).toEqual(EVERYONE_HERE[ME]);
    expect(r.deadlines).toBe(g.deadlines);
    // The same person sat down afresh (a new `since`) starts afresh too.
    const resat = [{ ...seats[0], since: '2026-09-28T20:00:00.000Z' }, ...seats.slice(1)] as unknown as Seats;
    const missed = oneMiss(g);
    expect(step({ game: missed, ruleset: karachi, seats: resat, policy, now: T0 + 1 }).tableState.absence[ME].misses).toBe(0);
  });

  it('says who was away when the hand finished, even when someone comes back in the same step', { timeout: 60_000 }, () => {
    const g = first(SEEDS, (seed) => driveTo(seed, two, bilalsTurn));
    // I'm away, and Bilal's second miss comes due: nobody's left to wait on, and the bots play the hand out.
    const absence = noteClockMove(markAway(EVERYONE_HERE, two, ME, 'host'), two, { by: 'clock', seat: 1, a: { type: 'pass', seat: 1 } }, true);
    const r = step({ game: { ...g, tableState: { ...NEW_TABLE, absence } }, ruleset: karachi, seats: two, policy, now: late(g), change: { type: 'back', seat: ME } });
    expect(r.finishedHand).toBe(true);
    expect(r.awayAtEnd).toEqual([true, true, false, false]);
    expect(isAway(r.tableState.absence, two, ME)).toBe(false);
    // Bilal is still away, with that hand to hear about when he's back.
    expect(r.tableState.absence[1].played.hands).toBe(1);
    // A hand that's over has no back note: its log is complete.
    expect(r.moves.some((m) => m.a.type === 'back')).toBe(false);
  });

  it('plays an away seat sharply, however gently the empty seats’ bots play', { timeout: 60_000 }, () => {
    for (const seed of ['sharp-1', 'sharp-2']) {
      const dealt = dealFirstHand(karachi, seats, seed, policy, T0, { bots: 'gentle' });
      const away: LiveGame = { ...dealt, tableState: { ...NEW_TABLE, absence: markAway(EVERYONE_HERE, seats, ME, 'host') } };
      const r = step({ game: away, ruleset: karachi, seats, policy, now: T0 + 1, bots: 'gentle' });
      expect(r.state.phase).toBe('finished');
      let s = dealt.state;
      let mine = 0;
      for (const m of r.moves) {
        if (m.by === 'away') {
          mine++;
          expect(m.a, seed).toEqual(analysisBot(viewFor(s, karachi, ME), karachi) ?? { type: 'pass', seat: ME });
        }
        if (isPlayerMove(m.a)) s = reduce(s, m.a, karachi);
      }
      expect(mine).toBeGreaterThan(0);
      expect(r.tableState.absence[ME].played.turns).toBe(r.moves.filter((m) => m.by === 'away' && m.a.type === 'discard').length);
    }
  });

  it('sizes the clocks by the people who are here, given their levels: an away first-timer doesn’t slow the others', { timeout: 60_000 }, () => {
    const levels = ['new', 'solid', null, null] as const;
    const found = first(SEEDS, (seed) => {
      const g = driveTo(seed, two, bilalsTurn);
      if (!g) return null;
      const away: LiveGame = { ...g, tableState: { ...NEW_TABLE, absence: markAway(EVERYONE_HERE, two, ME, 'host') } };
      const r = step({ game: away, ruleset: karachi, seats: two, policy, now: T0 + 70, action: choice(g, 1), actor: 1, levels, seed });
      return r.deadlines.turn !== null || r.deadlines.claim !== null ? r : null;
    });
    expect(found.deadlines).toEqual(deadlinesFor(found.state, karachi, two, policyFor(['solid']), T0 + 70, found.tableState.absence));
    expect(found.deadlines).not.toEqual(deadlinesFor(found.state, karachi, two, policyFor(['new', 'solid']), T0 + 70, found.tableState.absence));
  });

  it('still replays from the seed with a seat going away, its bot’s moves and the notes in the log', { timeout: 60_000 }, () => {
    const first0 = dealFirstHand(karachi, seats, 'away-replay', policy, T0);
    let g: LiveGame = { ...first0, tableState: NEW_TABLE };
    const log = stamp(first0.moves, 1);
    for (let v = 2; v < 60 && g.state.phase !== 'finished'; v++) {
      const r = step({ game: g, ruleset: karachi, seats, policy, now: late(g) });
      log.push(...stamp(r.moves, v));
      g = r;
    }
    expect(g.state.phase).toBe('finished');
    expect(log.some((m) => m.by === 'away')).toBe(true);
    expect(log.some((m) => m.a.type === 'away')).toBe(true);
    expect(replayHand(karachi, 'away-replay', { progress: first0.state.progress, dealer: first0.state.dealer }, log)).toEqual(g.state);
  });
});
