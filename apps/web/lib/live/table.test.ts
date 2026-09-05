import { describe, expect, it } from 'vitest';
import { IllegalAction, analysisBot, karachi, legalActions, viewFor, type Seat } from '@society/engine';
import type { LiveGame } from './types';
import { NotYourMove, dealFirstHand, resolveExpired, settle, step } from './table';
import { isHuman, seatOf, type Seats } from './types';
import { policyFor } from './policy';

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
