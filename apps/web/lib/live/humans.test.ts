import { describe, expect, it } from 'vitest';
import { SEATS, analysisBot, karachi, legalActions, viewFor, type Action, type Seat } from '@society/engine';
import { dealFirstHand, resolveExpired, step } from './table';
import { isHuman, type LiveGame, type Seats } from './types';
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

function playHand(seats: Seats, seed: string, onState?: (g: LiveGame) => void): { game: LiveGame; moves: Record<number, number> } {
  let game: LiveGame = dealFirstHand(karachi, seats, seed, policy, T0);
  const moves: Record<number, number> = {};
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
    game = { state: r.state, deadlines: r.deadlines };
  }
  expect(game.state.phase).toBe('finished');
  expect(game.deadlines).toEqual({ claim: null, turn: null });
  return { game, moves };
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
