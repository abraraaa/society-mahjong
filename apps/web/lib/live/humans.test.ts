import { describe, expect, it } from 'vitest';
import { SEATS, analysisBot, karachi, legalActions, startHand, viewFor, type Action, type Seat } from '@society/engine';
import { EVERYONE_HERE, isAway, noteClockMove } from './absence';
import { NotYourMove, dealFirstHand, deadlinesFor, resolveExpired, settle, step, type StepResult } from './table';
import { NEW_TABLE } from './table-state';
import { CLAIM_PASS_MARGIN_MS } from './timing';
import { isHuman, isPlayerMove, type ClientAction, type LiveGame, type LoggedMove, type Seats } from './types';
import { replayHand, stamp } from './hand-log';
import { policyFor } from './policy';

/**
 * Two and three humans at one table. Every other test seats one human with
 * three bots; a friends' table is the product, and the seams are here: who
 * the clock waits on, a claim window two people must both answer, someone
 * standing up mid-hand.
 */
const two: Seats = [
  { kind: 'human', userId: 'u-a', name: 'Abrar' },
  { kind: 'human', userId: 'u-b', name: 'Bilal' },
  { kind: 'bot', name: 'Sana' },
  { kind: 'bot', name: 'Ayesha' },
];
const three: Seats = [
  { kind: 'human', userId: 'u-a', name: 'Abrar' },
  { kind: 'bot', name: 'Sana' },
  { kind: 'human', userId: 'u-b', name: 'Bilal' },
  { kind: 'human', userId: 'u-c', name: 'Zara' },
];
const policy = policyFor(['new']);
const T0 = 1_700_000_000_000;

/** The human seats the table is waiting on right now. */
function pending(game: LiveGame, seats: Seats): Seat[] {
  const s = game.state;
  if (s.phase === 'finished') return [];
  if (s.phase === 'turn') return isHuman(seats, s.turn) ? [s.turn] : [];
  return SEATS.filter((seat) => {
    if (!isHuman(seats, seat)) return false;
    const legal = legalActions(s, karachi, seat);
    return s.phase === 'claim' ? legal.claims !== undefined : legal.exchange !== undefined;
  });
}

/** Play the pending human with the bot's brain; a claim with nothing worth taking is a pass. */
function humanMove(game: LiveGame, seat: Seat): Action {
  const legal = legalActions(game.state, karachi, seat);
  return analysisBot(viewFor(game.state, karachi, seat), karachi) ?? (legal.claims ? { type: 'pass', seat } : ({ type: 'pass', seat } as Action));
}

function playHand(seats: Seats, seed: string, onState?: (g: LiveGame) => void): { game: LiveGame; moves: Record<number, number>; log: LoggedMove[] } {
  const first = dealFirstHand(karachi, seats, seed, policy, T0);
  let game: LiveGame = first;
  const moves: Record<number, number> = {};
  // The hand's log as the requests would write it: the deal at version 1, then each step's moves at the next version.
  const log = stamp(first.moves, 1);
  for (let i = 0; i < 600 && game.state.phase !== 'finished'; i++) {
    onState?.(game);
    const who = pending(game, seats);
    expect(who.length, `seed ${seed}: the table is waiting on nobody in phase ${game.state.phase}`).toBeGreaterThan(0);
    // The deadline says a human is being waited on, and only then.
    expect(game.deadlines.turn !== null || game.deadlines.claim !== null).toBe(true);
    const seat = who[0]!;
    const r = step({ game, ruleset: karachi, seats, policy, now: T0 + i * 1000, action: humanMove(game, seat) as never, actor: seat, seed });
    expect(r.changed).toBe(true);
    moves[seat] = (moves[seat] ?? 0) + 1;
    log.push(...stamp(r.moves, i + 2));
    game = { state: r.state, deadlines: r.deadlines };
  }
  expect(game.state.phase).toBe('finished');
  expect(game.deadlines).toEqual({ claim: null, turn: null });
  return { game, moves, log };
}

/** Each entry is its maker's: a person's own move under their own id, a bot's in a bot seat, the table's pass for a person with nothing to claim. */
function expectTagged(seats: Seats, log: readonly LoggedMove[]): void {
  for (const m of log) {
    expect(m.seat, JSON.stringify(m)).toBeDefined();
    const entry = seats[m.seat!];
    expect(isPlayerMove(m.a) && m.a.seat === m.seat, JSON.stringify(m)).toBe(true);
    if (m.by === 'player') expect(entry?.kind === 'human' && m.userId === entry.userId, JSON.stringify(m)).toBe(true);
    else if (m.by === 'bot') expect(entry?.kind === 'bot' && m.userId === undefined, JSON.stringify(m)).toBe(true);
    else if (m.by === 'table') expect(entry?.kind === 'human' && m.userId === undefined && m.a.type === 'pass', JSON.stringify(m)).toBe(true);
    else throw new Error(`nobody's clock ran out, so nothing is ${m.by}'s: ${JSON.stringify(m)}`);
  }
}

/**
 * A window both humans can claim is rare in play, so it is built: a window
 * one human can claim, with the other human's hand edited to hold a pair of
 * the discarded tile. HandState is plain data; nothing but the counts matter.
 */
function windowForBoth(): LiveGame {
  let found: LiveGame | null = null;
  playHand(two, 'both-1', (g) => {
    if (found || g.state.phase !== 'claim') return;
    const who = pending(g, two);
    const from = g.state.lastDiscard!.from;
    if (who.length === 1 && from !== 0 && from !== 1) found = g;
  });
  expect(found, 'no claim window with a bot discarder').not.toBeNull();
  const g = found!;
  const other = (pending(g, two)[0] === 0 ? 1 : 0) as Seat;
  const k = g.state.lastDiscard!.kind;
  const p = g.state.players[other];
  const concealed = [k, k, ...p.concealed.filter((t) => t !== k).slice(0, p.concealed.length - 2)];
  const players = g.state.players.map((x, i) => (i === other ? { ...x, concealed } : x)) as unknown as typeof g.state.players;
  // The server had already passed for a hand with nothing to claim; undo that too.
  const claims = { ...g.state.claims };
  delete claims[other];
  const state = { ...g.state, players, claims };
  const game = { state, deadlines: g.deadlines };
  expect(pending(game, two).sort()).toEqual([0, 1]);
  return game;
}

describe('two humans and two bots', () => {
  it('plays whole hands with the clock always on a human and both humans moving', { timeout: 120_000 }, () => {
    for (const seed of ['pair-1', 'pair-2', 'pair-3']) {
      const { moves } = playHand(two, seed, (g) => {
        // A turn deadline means the turn is a human's; bots never hold the table.
        if (g.deadlines.turn !== null && g.state.phase === 'turn') expect(isHuman(two, g.state.turn)).toBe(true);
      });
      expect(moves[0] ?? 0).toBeGreaterThan(0);
      expect(moves[1] ?? 0).toBeGreaterThan(0);
    }
  });

  it('holds a claim window open until both humans have answered, then resolves', { timeout: 120_000 }, () => {
    const g = windowForBoth();
    expect(g.deadlines.claim).not.toBeNull();
    // First human passes: still waiting on the second, clock still set.
    const r1 = step({ game: g, ruleset: karachi, seats: two, policy, now: T0, action: { type: 'pass', seat: 0 }, actor: 0 });
    expect(r1.state.phase).toBe('claim');
    expect(viewFor(r1.state, karachi, 1).players[0]!.responded).toBe(true);
    expect(pending({ state: r1.state, deadlines: r1.deadlines }, two)).toEqual([1]);
    expect(r1.deadlines.claim).not.toBeNull();
    // Second human answers: the window closes and the table moves on.
    const g1 = { state: r1.state, deadlines: r1.deadlines };
    const r2 = step({ game: g1, ruleset: karachi, seats: two, policy, now: T0 + 1000, action: humanMove(g1, 1) as never, actor: 1 });
    expect(r2.state.phase).not.toBe('claim');
  });

  it('lets a stand-in answer for both humans when the window expires', { timeout: 120_000 }, () => {
    const g = windowForBoth();
    const s = resolveExpired(g, karachi, two, g.deadlines.claim!);
    expect(s).not.toBeNull();
    expect(s!.phase).not.toBe('claim');
  });

  it('logs a claim window both people answer, one move each, in the order they came', { timeout: 120_000 }, () => {
    const g = windowForBoth();
    const r1 = step({ game: g, ruleset: karachi, seats: two, policy, now: T0, action: { type: 'pass', seat: 0 }, actor: 0 });
    expect(r1.moves).toEqual([{ by: 'player', seat: 0, userId: 'u-a', a: { type: 'pass', seat: 0 } }]);
    const g1 = { state: r1.state, deadlines: r1.deadlines };
    const second = humanMove(g1, 1);
    const r2 = step({ game: g1, ruleset: karachi, seats: two, policy, now: T0 + 1000, action: second as never, actor: 1 });
    expect(r2.moves[0]).toEqual({ by: 'player', seat: 1, userId: 'u-b', a: second });
    expectTagged(two, stamp(r2.moves, 3));
    // Left to the clock instead, both answers are the clock's, in seat order.
    const late = step({ game: g, ruleset: karachi, seats: two, policy, now: g.deadlines.claim! });
    expect(late.moves.filter((m) => m.by === 'clock').map((m) => m.seat)).toEqual([0, 1]);
  });

  /**
   * The review's attack: while one human is deciding on a discard, the other
   * sends the server's own move for their own seat. It used to close the
   * window and turn the unanswered claim into a pass, even on a Mahjong.
   */
  it("refuses a player who sends resolveClaims to close someone else's claim window", { timeout: 120_000 }, () => {
    let found: LiveGame | null = null;
    for (const seed of ['guard-1', 'guard-2', 'guard-3']) {
      playHand(two, seed, (g) => {
        if (!found && g.state.phase === 'claim' && pending(g, two).length === 1) found = g;
      });
      if (found) break;
    }
    expect(found, 'no claim window with one human answering').not.toBeNull();
    const g: LiveGame = found!;
    const victim = pending(g, two)[0]!;
    const attacker = (victim === 0 ? 1 : 0) as Seat;
    expect(g.deadlines.claim).toBeGreaterThan(T0);
    const forged = { type: 'resolveClaims', seat: attacker } as unknown as ClientAction;
    expect(() => step({ game: g, ruleset: karachi, seats: two, policy, now: T0, action: forged, actor: attacker, seed: 'guard' })).toThrow(NotYourMove);
    // Nothing moved: the window is still open, still on the clock, and still the victim's to answer.
    const after = step({ game: g, ruleset: karachi, seats: two, policy, now: T0 });
    expect(after.changed).toBe(false);
    expect(after.state.phase).toBe('claim');
    expect(after.deadlines).toEqual(g.deadlines);
    expect(pending({ state: after.state, deadlines: after.deadlines }, two)).toEqual([victim]);
    expect(legalActions(after.state, karachi, victim).claims!.length).toBeGreaterThan(0);
  });

  it('carries on when a human stands up mid-hand and a bot takes the seat', { timeout: 120_000 }, () => {
    // Play until it is Bilal's (seat 1) turn, then swap the seat for a bot, as leaveGame does.
    let atBilal: LiveGame | null = null;
    playHand(two, 'leave-1', (g) => {
      if (!atBilal && g.state.phase === 'turn' && g.state.turn === 1) atBilal = g;
    });
    expect(atBilal).not.toBeNull();
    const seats = two.map((s, i) => (i === 1 ? { kind: 'bot' as const, name: 'Hamza' } : s)) as unknown as Seats;
    const r = step({ game: atBilal!, ruleset: karachi, seats, policy, now: T0 });
    expect(r.changed).toBe(true);
    // The table is now waiting on the remaining human, or the hand ended.
    if (r.state.phase !== 'finished') expect(pending({ state: r.state, deadlines: r.deadlines }, seats)).toEqual([0]);
  });
});

describe('three humans and one bot', () => {
  it('plays whole hands and every human gets to move', { timeout: 120_000 }, () => {
    const { moves } = playHand(three, 'trio-1');
    for (const seat of [0, 2, 3]) expect(moves[seat] ?? 0, `seat ${seat} never moved`).toBeGreaterThan(0);
  });
});

/**
 * The hand log at a friends' table: whose move each one was, and that the
 * seed plus the log is the hand, however many people sat at it.
 */
describe('the hand log with several people', () => {
  it('logs each person’s moves under their own id and replays the hand from its seed', { timeout: 120_000 }, () => {
    let tablePasses = 0;
    for (const [seats, seed] of [
      [two, 'pair-1'],
      [two, 'pair-2'],
      [three, 'trio-1'],
    ] as const) {
      const { game, log } = playHand(seats, seed);
      expectTagged(seats, log);
      for (const [seat, entry] of seats.entries()) {
        if (entry?.kind === 'human')
          expect(
            log.some((m) => m.by === 'player' && m.seat === seat),
            `${seed}: seat ${seat} has no moves of its own`,
          ).toBe(true);
      }
      tablePasses += log.filter((m) => m.by === 'table').length;
      const vs = log.map((m) => m.v);
      expect(vs).toEqual([...vs].sort((a, b) => a - b));
      expect(replayHand(karachi, seed, { progress: { roundWind: 'E', roundIndex: 0, handInRound: 0, handIndex: 0 }, dealer: 0 }, log)).toEqual(game.state);
    }
    expect(tablePasses, 'no person was ever passed for by the table').toBeGreaterThan(0);
  });
});

/**
 * Someone who stops playing at a friends' table (R2-R8): their turns' clocks
 * run out twice at most before a bot plays their seat at once, and the table
 * never waits on them again until they're back. Letting a tile go, which an
 * open page with nobody at it does by itself, never counts as being there.
 */
describe('two humans, and one of them stops playing', () => {
  const A: Seat = 0;
  const B: Seat = 1;
  const person = (g: LiveGame, seat: Seat) => isHuman(two, seat) && !isAway(g.tableState?.absence, two, seat);
  /** Who the table is waiting on, going by who's away. */
  function waiting(g: LiveGame): Seat[] {
    const s = g.state;
    if (s.phase === 'finished') return [];
    if (s.phase === 'turn') return person(g, s.turn) ? [s.turn] : [];
    return SEATS.filter((seat) => {
      if (!person(g, seat)) return false;
      const legal = legalActions(s, karachi, seat);
      return s.phase === 'claim' ? legal.claims !== undefined : legal.exchange !== undefined;
    });
  }

  interface Run {
    /** B's turns (and passes of tiles) the clock answered for */
    readonly turnClocks: number;
    /** every step, in order, with the table it was given */
    readonly steps: readonly { readonly before: LiveGame; readonly r: StepResult; readonly now: number; readonly by: 'A' | 'B' | 'tick' }[];
    readonly game: LiveGame;
  }

  /**
   * A plays; B never does. With `autoPass`, B's page passes by itself in every
   * claim window B has an option in, just before its clock runs out, as the
   * claim sheet does. Across hands: A deals the next one.
   */
  function run(seed: string, opts: { autoPass: boolean; hands: number }, start?: { readonly game: LiveGame; readonly now: number }): Run {
    let game: LiveGame = start?.game ?? { ...dealFirstHand(karachi, two, seed, policy, T0), tableState: NEW_TABLE };
    let now = start?.now ?? T0;
    let turnClocks = 0;
    const steps: { before: LiveGame; r: StepResult; now: number; by: 'A' | 'B' | 'tick' }[] = [];
    let hands = 0;
    for (let i = 0; i < 3000 && hands < opts.hands; i++) {
      const who = waiting(game);
      let r: StepResult;
      let by: 'A' | 'B' | 'tick';
      if (game.state.phase === 'finished') {
        hands++;
        if (hands >= opts.hands) break;
        now += 1000;
        r = step({ game, ruleset: karachi, seats: two, policy, now, action: { type: 'nextHand' }, actor: A, seed });
        by = 'A';
      } else if (who.includes(A)) {
        now += 1000;
        r = step({ game, ruleset: karachi, seats: two, policy, now, action: humanMove(game, A) as never, actor: A, seed });
        by = 'A';
      } else if (opts.autoPass && game.state.phase === 'claim' && who.includes(B) && game.deadlines.claim !== null && game.deadlines.claim - CLAIM_PASS_MARGIN_MS > now) {
        now = game.deadlines.claim - CLAIM_PASS_MARGIN_MS;
        r = step({ game, ruleset: karachi, seats: two, policy, now, action: { type: 'pass', seat: B }, actor: B, seed });
        by = 'B';
      } else {
        // Only B could be pending: the table must be timing them, and the phone that notices ticks once the clock runs out.
        expect(who, `seed ${seed}: waiting on ${JSON.stringify(who)} with no clock`).toEqual([B]);
        const due = game.deadlines.turn ?? game.deadlines.claim;
        expect(due, `seed ${seed}: B is pending but no clock runs`).not.toBeNull();
        now = Math.max(now, due!) + 1;
        const phase = game.state.phase;
        r = step({ game, ruleset: karachi, seats: two, policy, now, seed });
        if (phase === 'turn' || phase === 'preplay') turnClocks += r.moves.filter((m) => m.by === 'clock' && m.seat === B).length;
        by = 'tick';
      }
      steps.push({ before: game, r, now, by });
      game = r;
    }
    return { turnClocks, steps, game };
  }

  it('answers B’s turns on the clock twice at most, then a bot plays B’s seat and the table never waits on B', { timeout: 120_000 }, () => {
    for (const seed of ['gone-1', 'gone-2']) {
      const { turnClocks, steps, game } = run(seed, { autoPass: false, hands: 3 });
      expect(turnClocks, seed).toBeLessThanOrEqual(2);
      expect(isAway(game.tableState?.absence, two, B), seed).toBe(true);
      const went = steps.findIndex((x) => isAway(x.r.tableState.absence, two, B));
      expect(went).toBeGreaterThanOrEqual(0);
      for (const { r } of steps.slice(went + 1)) {
        // From here B's moves are all their bot's, and a clock runs only while A is being waited on.
        expect(r.moves.filter((m) => m.seat === B).every((m) => m.by === 'away' || (m.by === 'table' && m.a.type === 'pass'))).toBe(true);
        if (r.deadlines.turn !== null || r.deadlines.claim !== null) expect(waiting(r)).toContain(A);
      }
      // B taps Next hand on a finished hand: that's a tap, and B's back.
      const done = steps.map((x) => x.r).find((r, i) => i > went && r.state.phase === 'finished' && isAway(r.tableState.absence, two, B));
      if (done) {
        const back = step({ game: done, ruleset: karachi, seats: two, policy, now: T0 + 9e9, action: { type: 'nextHand' }, actor: B, seed });
        expect(isAway(back.tableState.absence, two, B)).toBe(false);
        expect(back.tableState.absence[B]).toMatchObject({ misses: 0, lastTap: T0 + 9e9 });
      }
    }
  });

  it(
    'sends B away all the same when B’s open page passes by itself in every claim window, and the host can still hand B’s seat over between the misses',
    { timeout: 120_000 },
    () => {
      for (const seed of ['idle-1', 'idle-2', 'idle-3']) {
        const { turnClocks, game } = run(seed, { autoPass: true, hands: 3 });
        expect(turnClocks, seed).toBeLessThanOrEqual(2);
        expect(isAway(game.tableState?.absence, two, B), seed).toBe(true);
      }

      // A claim window B has an option in, with B's first miss behind them: A answers, and B's page passes by itself just
      // before the clock runs out.
      const g = windowForBoth();
      const due = g.deadlines.claim!;
      const missed: LiveGame = { ...g, tableState: { ...NEW_TABLE, absence: noteClockMove(EVERYONE_HERE, two, { by: 'clock', seat: B, a: { type: 'pass', seat: B } }, true) } };
      const a = step({ game: missed, ruleset: karachi, seats: two, policy, now: due - 10_000, action: { type: 'pass', seat: A }, actor: A });
      const auto = step({ game: a, ruleset: karachi, seats: two, policy, now: due - CLAIM_PASS_MARGIN_MS, action: { type: 'pass', seat: B }, actor: B });
      expect(auto.moves[0]).toEqual({ by: 'player', seat: B, userId: 'u-b', a: { type: 'pass', seat: B } });
      // Nothing of B's changed: still one miss, not a tap.
      expect(auto.tableState.absence[B]).toEqual(missed.tableState!.absence[B]);

      // The host's table was sent before that pass: handing B's seat over still goes ahead.
      const handed = step({
        game: auto,
        ruleset: karachi,
        seats: two,
        policy,
        now: due + 5_000,
        change: { type: 'letBotPlay', seat: B, bySeat: A, sawAt: due - CLAIM_PASS_MARGIN_MS - 1 },
      });
      expect(handed.tableState.absence[B]).toMatchObject({ away: 'host' });

      // Left alone instead, B misses one more turn and goes away, however many claim windows the page passes in.
      const rest = run('idle-window', { autoPass: true, hands: 3 }, { game: auto, now: due });
      expect(rest.turnClocks).toBeLessThanOrEqual(1);
      expect(isAway(rest.game.tableState?.absence, two, B)).toBe(true);
      expect(rest.game.tableState?.absence[B]).toMatchObject({ away: 'clock' });
    },
  );

  it('keeps the other person’s clock running when one of two answers a claim window, or passes their tiles first', { timeout: 120_000 }, () => {
    // A claim window both must answer, as the test above builds one.
    const g = { ...windowForBoth(), tableState: NEW_TABLE };
    const who = pending(g, two);
    const r = step({ game: g, ruleset: karachi, seats: two, policy, now: T0 + 5_000, action: { type: 'pass', seat: who[0]! }, actor: who[0]! });
    expect(r.state.phase).toBe('claim');
    expect(r.deadlines).toBe(g.deadlines);

    // A West pass of three tiles both owe: the first to pass leaves the other's clock as it was.
    let west: LiveGame | null = null;
    for (let i = 0; i < 40 && !west; i++) {
      const state = settle(startHand(karachi, { seed: `west-${i}`, progress: { roundWind: 'W', roundIndex: 2, handInRound: 0, handIndex: 8 }, dealer: 0 }), karachi, two);
      if (state.phase === 'preplay' && legalActions(state, karachi, 0).exchange && legalActions(state, karachi, 1).exchange)
        west = { state, deadlines: deadlinesFor(state, karachi, two, policy, T0), tableState: NEW_TABLE };
    }
    expect(west, 'no West pass for both').not.toBeNull();
    const tiles = viewFor(west!.state, karachi, 0).concealed.slice(0, legalActions(west!.state, karachi, 0).exchange!.count);
    const passed = step({ game: west!, ruleset: karachi, seats: two, policy, now: T0 + 5_000, action: { type: 'exchange', seat: 0, tiles }, actor: 0 });
    expect(passed.state.phase).toBe('preplay');
    expect(passed.deadlines).toBe(west!.deadlines);
  });
});
