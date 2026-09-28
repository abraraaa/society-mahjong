import { afterEach, describe, expect, it, vi } from 'vitest';
import { IllegalAction, analysisBot, karachi, legalActions, startHand, viewFor, type GameProgress, type HandState, type Seat } from '@society/engine';
import type { ClientAction, LiveGame, Move } from './types';
import { GameIsOver, NotYourMove, actionIsForSeat, dealFirstHand, decisionRandom, rejectionStatus, resolveExpired, settle, step, type StepInput } from './table';
import { isHuman, isPlayerMove, seatOf, type Seats } from './types';
import { replayHand, stamp } from './hand-log';
import { policyFor } from './policy';
import { NEW_TABLE, type TableState } from './table-state';

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
    expect(r.standIns.length).toBeGreaterThan(0);
    expect(r.standIns[0]!.seat).toBe(ME);
    expect(['discard', 'declareWin', 'declareKong']).toContain(r.standIns[0]!.action.type);
    // and the table is back at my next decision with a full clock
    expect((r.deadlines.turn ?? r.deadlines.claim)!).toBeGreaterThan(later);
    // a step with nothing expired reports nothing
    const quiet = step({ game: { state: r.state, deadlines: r.deadlines }, ruleset: karachi, seats, policy, now: later + 1000 });
    expect(quiet.standIns).toEqual([]);
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
        expect(r.standIns).toEqual([{ seat: ME, action: sharp }]);
        moves++;
        game = r;
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
      expect(r.moves[0]).toEqual({ by: 'clock', seat: ME, a: r.standIns[0]!.action });
      expect(r.moves.filter((m) => m.by === 'clock')).toHaveLength(r.standIns.length);
      expect(r.moves.slice(1).every((m) => m.by === 'clock' || isTableMadeMove(m))).toBe(true);
      expect(r.finishedHand).toBe(r.state.phase === 'finished');
      game = r;
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
  const table: TableState = { v: 1, scores: [100, -100, 0, 0], over: null, extra: { later: { kept: true } } };

  /** The totals with a won hand's transfers added, worked out here rather than by the code under test. */
  function plus(scores: readonly number[], s: HandState): number[] {
    const next = [...scores];
    if (s.result?.type === 'win') for (const t of s.result.settlement.transfers) ((next[t.from]! -= t.amount), (next[t.to]! += t.amount));
    return next;
  }

  /** The human plays the hand out; every step but the last must hand the table back as it was given. */
  function playOut(seed: string): { last: ReturnType<typeof step>; before: LiveGame } {
    let game: LiveGame = { ...dealFirstHand(karachi, seats, seed, policy, T0), tableState: table };
    for (let i = 0; i < 400; i++) {
      const a = (analysisBot(viewFor(game.state, karachi, ME), karachi) ?? { type: 'pass', seat: ME }) as ClientAction;
      const r = step({ game, ruleset: karachi, seats, policy, now: T0 + i * 1000, action: a, actor: ME });
      if (r.state.phase === 'finished') return { last: r, before: game };
      expect(r.tableState).toBe(table);
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
    expect(last.tableState).toBe(table);
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
    // Four bots: the deal of the next hand plays it to its end in the step that deals it.
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
      const r = step({ game: { ...first, tableState: table }, ruleset: karachi, seats: bots, policy, now: T0, action: { type: 'nextHand' }, seed });
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
  const before: TableState = { v: 1, scores: [100, -100, 0, 0], over: null, extra: { later: { kept: true } } };

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
    // The hand's points were already in the totals: the end takes them as they stand.
    expect(r.tableState).toEqual({ ...before, over: { how: 'complete', by: null, at: T0, hands: 16, scores: before.scores, seats } });
  });

  it('takes nothing more once the game is over: every move and end is refused, and a bare step changes nothing', { timeout: 60_000 }, () => {
    const { last, seed } = wonLast();
    const ended: LiveGame = last;
    const tries: Partial<StepInput>[] = [
      { action: { type: 'nextHand' }, actor: ME, seed },
      { action: { type: 'pass', seat: ME }, actor: ME },
      { action: { type: 'discard', seat: ME, tile: 'm1' }, actor: ME },
      { end: { how: 'abandoned', by: null } },
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
    expect(quiet).toMatchObject({ changed: false, gameOver: false, moves: [], dealt: false, finishedHand: false, standIns: [] });
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

  it('never takes an action and an end in one step', () => {
    const game = dealFirstHand(karachi, seats, 'end-both', policy, T0);
    expect(() => step({ game, ruleset: karachi, seats, policy, now: T0, action: { type: 'pass', seat: ME }, actor: ME, end: { how: 'abandoned', by: null } })).toThrow(/not both/);
  });
});
