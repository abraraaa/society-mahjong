import { describe, expect, it } from 'vitest';
import { karachi, publicView, reduce, startHand, viewFor, type HandState, type PrivatePlayerView, type Seat } from '@society/engine';
import { ApiError } from './live/client';
import type { GameSnapshot } from './live/snapshot';
import { settle, step } from './live/table';
import type { ClientAction, Seats, TimerPolicy } from './live/types';
import { POLL_MS, afterConflict, sendMove, shouldPoll, stillLegal } from './table-sync';

const ME: Seat = 0;
const OTHER: Seat = 1;
/** Two friends and two bots: the table the review saw lose every West exchange. */
const seats: Seats = [
  { kind: 'human', userId: 'me', name: 'Amna' },
  { kind: 'human', userId: 'b', name: 'Bilal' },
  { kind: 'bot', name: 'Bot' },
  { kind: 'bot', name: 'Bot' },
];
const policy: TimerPolicy = { claimSeconds: 20, turnSeconds: 60 };
const west = { roundWind: 'W' as const, roundIndex: 2, handInRound: 0, handIndex: 8 };
const east = { roundWind: 'E' as const, roundIndex: 0, handInRound: 1, handIndex: 1 };

/** What the act route sends back: the seat's view of `state` at `version`. */
function snapOf(state: HandState, version: number, status: GameSnapshot['status'] = 'active', me: Seat | null = ME): GameSnapshot {
  return {
    gameId: 'g',
    roomId: 'r',
    roomCode: 'KHI-TEST',
    isHost: false,
    rulesetId: 'karachi',
    version,
    deadlines: { claim: null, turn: null },
    seats: seats.map((s) => (s ? { kind: s.kind, name: s.name } : null)),
    scores: [0, 0, 0, 0],
    me,
    view: me === null ? publicView(state) : viewFor(state, karachi, me),
    status,
    now: 0,
  };
}

/** One request against the server's own table logic, as the act route runs it. */
function act(state: HandState, action: ClientAction, actor: Seat): HandState {
  return step({ game: { state, deadlines: { claim: null, turn: null } }, ruleset: karachi, seats, policy, now: 0, action, actor, seed: 'sync' }).state;
}

/** A West goulash with the bots' passes already in, waiting on both humans. */
function westExchange(): HandState {
  const s = settle(startHand(karachi, { seed: 'sync-west', progress: west, dealer: 0 }), karachi, seats);
  expect(s.phase).toBe('preplay');
  expect(viewFor(s, karachi, ME).legal.exchange).toBeDefined();
  expect(viewFor(s, karachi, OTHER).legal.exchange).toBeDefined();
  return s;
}

const exchangeOf = (s: HandState, seat: Seat): ClientAction => ({ type: 'exchange', seat, tiles: s.players[seat].concealed.slice(0, 3) });

/** Play the table on (bots and the other human answering with the simplest move) until it is this seat's turn to discard. */
function untilMyTurn(state: HandState): HandState {
  let s = state;
  for (let i = 0; i < 400; i++) {
    if (s.phase === 'turn' && s.turn === ME) return s;
    const mine = viewFor(s, karachi, ME).legal;
    const theirs = viewFor(s, karachi, OTHER).legal;
    if (mine.exchange) s = act(s, exchangeOf(s, ME), ME);
    else if (theirs.exchange) s = act(s, exchangeOf(s, OTHER), OTHER);
    else if (mine.pass) s = act(s, { type: 'pass', seat: ME }, ME);
    else if (theirs.pass) s = act(s, { type: 'pass', seat: OTHER }, OTHER);
    else if (s.phase === 'turn' && s.turn === OTHER) s = act(s, { type: 'discard', seat: OTHER, tile: s.players[OTHER].concealed[0]! }, OTHER);
    else throw new Error(`stuck in ${s.phase}`);
  }
  throw new Error('never reached my turn');
}

describe('afterConflict: the West exchange with two humans', () => {
  it('goes again when the other human passed their tiles first', () => {
    const s0 = westExchange();
    const mine = exchangeOf(s0, ME);
    // Both tap Pass tiles against version 0; Bilal's lands first and makes it version 1.
    const s1 = act(s0, exchangeOf(s0, OTHER), OTHER);
    expect(s1.seq).toBe(s0.seq); // one seat's pass logs nothing until all four are in
    expect(afterConflict(mine, snapOf(s0, 0), snapOf(s1, 1), false)).toBe('retry');
    // And the table takes it against the newer version: the pass completes.
    const s2 = act(s1, mine, ME);
    expect(s2.preplayStep).toBe(s0.preplayStep + 1);
  });

  it('goes again once only', () => {
    const s0 = westExchange();
    const s1 = act(s0, exchangeOf(s0, OTHER), OTHER);
    expect(afterConflict(exchangeOf(s0, ME), snapOf(s0, 0), snapOf(s1, 1), true)).toBe('tell');
  });

  it('never replays an exchange into the next pass once a stand-in made this one', () => {
    const s0 = westExchange();
    const mine = exchangeOf(s0, ME);
    const s1 = act(s0, exchangeOf(s0, OTHER), OTHER);
    // The clock ran out and a stand-in passed three other tiles for me: on to the 'across' pass.
    const standIn: ClientAction = { type: 'exchange', seat: ME, tiles: s1.players[ME].concealed.slice(-3) };
    const s2 = settle(reduce(s1, standIn, karachi), karachi, seats);
    expect(s2.preplayStep).toBe(s0.preplayStep + 1);
    // The same three tiles would pass the new step's checks; what stops them is that the table has moved on.
    expect(stillLegal(mine, viewFor(s2, karachi, ME))).toBe(true);
    expect(afterConflict(mine, snapOf(s0, 0), snapOf(s2, 2), false)).toBe('tell');
  });
});

describe('afterConflict: other moves', () => {
  it('goes again with a discard when the table changed but nothing happened at it', () => {
    const s = untilMyTurn(settle(startHand(karachi, { seed: 'sync-turn', progress: east, dealer: 0 }), karachi, seats));
    const discard: ClientAction = { type: 'discard', seat: ME, tile: s.players[ME].concealed[0]! };
    expect(afterConflict(discard, snapOf(s, 4), snapOf(s, 5), false)).toBe('retry');
  });

  it('tells the player when the turn has gone (a stand-in discarded for them)', () => {
    const s = untilMyTurn(settle(startHand(karachi, { seed: 'sync-turn', progress: east, dealer: 0 }), karachi, seats));
    const discard: ClientAction = { type: 'discard', seat: ME, tile: s.players[ME].concealed[0]! };
    const after = settle(reduce(s, { type: 'discard', seat: ME, tile: s.players[ME].concealed.at(-1)! }, karachi), karachi, seats);
    expect(afterConflict(discard, snapOf(s, 4), snapOf(after, 5), false)).toBe('tell');
  });

  it('tells the player when the game has closed or finished under them', () => {
    const s = untilMyTurn(settle(startHand(karachi, { seed: 'sync-turn', progress: east, dealer: 0 }), karachi, seats));
    const discard: ClientAction = { type: 'discard', seat: ME, tile: s.players[ME].concealed[0]! };
    expect(afterConflict(discard, snapOf(s, 4), snapOf(s, 5, 'abandoned'), false)).toBe('tell');
    expect(afterConflict(discard, snapOf(s, 4), snapOf(s, 5, 'finished'), false)).toBe('tell');
  });

  it('does not go again against the very version that was just refused', () => {
    const s = untilMyTurn(settle(startHand(karachi, { seed: 'sync-turn', progress: east, dealer: 0 }), karachi, seats));
    const discard: ClientAction = { type: 'discard', seat: ME, tile: s.players[ME].concealed[0]! };
    expect(afterConflict(discard, snapOf(s, 4), snapOf(s, 4), false)).toBe('tell');
  });

  it('lets a next-hand tap go quietly when someone else has already dealt it, or ended the game', () => {
    const finished: HandState = { ...startHand(karachi, { seed: 'sync-next', progress: east, dealer: 0 }), phase: 'finished', result: { type: 'draw' } };
    const dealt = settle(startHand(karachi, { seed: 'sync-next', progress: { ...east, handInRound: 2, handIndex: 2 }, dealer: 1 }), karachi, seats);
    const next: ClientAction = { type: 'nextHand' };
    expect(afterConflict(next, snapOf(finished, 7), snapOf(dealt, 8), false)).toBe('quiet');
    expect(afterConflict(next, snapOf(finished, 7), snapOf(finished, 8, 'finished'), false)).toBe('quiet');
    // Still on the finished hand at a newer version: the tap is still good.
    expect(afterConflict(next, snapOf(finished, 7), snapOf(finished, 8), false)).toBe('retry');
  });

  it('never goes again for a seat that is only watching', () => {
    const s0 = westExchange();
    const s1 = act(s0, exchangeOf(s0, OTHER), OTHER);
    expect(afterConflict(exchangeOf(s0, ME), snapOf(s0, 0), snapOf(s1, 1, 'active', null), false)).toBe('tell');
  });
});

describe('sendMove', () => {
  /**
   * A stand-in for the act route and the page: `answers` are what the server
   * says to each request in turn (a snapshot, or a thrown error), `versions`
   * records the version each request was made against, and `take` keeps the
   * newest snapshot the way the page does.
   */
  function harness(answers: Array<GameSnapshot | Error>, held: GameSnapshot) {
    const versions: number[] = [];
    let latest = held;
    const taken: number[] = [];
    const act = async (version: number) => {
      versions.push(version);
      const next = answers.shift();
      if (!next) throw new Error('no more answers');
      if (next instanceof Error) throw next;
      return next;
    };
    const take = (s: GameSnapshot) => {
      taken.push(s.version);
      if (s.version >= latest.version) latest = s;
    };
    return { versions, taken, act, take, latest: () => latest };
  }
  const stale = (snapshot?: GameSnapshot) => new ApiError(409, 'stale version', snapshot);

  it("goes again with the returned snapshot's version, not the one the tap was made on", async () => {
    const s0 = westExchange();
    const mine = exchangeOf(s0, ME);
    const s1 = act(s0, exchangeOf(s0, OTHER), OTHER);
    const s2 = act(s1, mine, ME);
    const h = harness([stale(snapOf(s1, 1)), snapOf(s2, 2)], snapOf(s0, 0));
    const out = await sendMove(mine, snapOf(s0, 0), h.act, h.take, h.latest);
    expect(out).toEqual({ kind: 'landed' });
    expect(h.versions).toEqual([0, 1]);
    expect(h.taken).toEqual([1, 2]);
  });

  it('goes again once at most, then hands back the refusal', async () => {
    const s0 = westExchange();
    const mine = exchangeOf(s0, ME);
    const s1 = act(s0, exchangeOf(s0, OTHER), OTHER);
    const second = stale(snapOf(s1, 2));
    const h = harness([stale(snapOf(s1, 1)), second, snapOf(s1, 3)], snapOf(s0, 0));
    const out = await sendMove(mine, snapOf(s0, 0), h.act, h.take, h.latest);
    expect(out).toEqual({ kind: 'failed', err: second });
    expect(h.versions).toEqual([0, 1]);
    // The newer table is still taken, so the player sees where things stand.
    expect(h.taken).toEqual([1, 2]);
  });

  it('does not go again when the move is no longer open', async () => {
    const s = untilMyTurn(settle(startHand(karachi, { seed: 'sync-turn', progress: east, dealer: 0 }), karachi, seats));
    const discard: ClientAction = { type: 'discard', seat: ME, tile: s.players[ME].concealed[0]! };
    const gone = settle(reduce(s, { type: 'discard', seat: ME, tile: s.players[ME].concealed.at(-1)! }, karachi), karachi, seats);
    const refusal = stale(snapOf(gone, 5));
    const h = harness([refusal], snapOf(s, 4));
    expect(await sendMove(discard, snapOf(s, 4), h.act, h.take, h.latest)).toEqual({ kind: 'failed', err: refusal });
    expect(h.versions).toEqual([4]);
    expect(h.taken).toEqual([5]);
  });

  it('uses a newer table the page already holds over the one the 409 carried', async () => {
    const s0 = westExchange();
    const mine = exchangeOf(s0, ME);
    const s1 = act(s0, exchangeOf(s0, OTHER), OTHER);
    const h = harness([stale(snapOf(s1, 1)), snapOf(s1, 4)], snapOf(s0, 0));
    // A poke's refetch landed version 3 while the refused request was on its way.
    h.take(snapOf(s1, 3));
    await sendMove(mine, snapOf(s0, 0), h.act, h.take, h.latest);
    expect(h.versions).toEqual([0, 3]);
  });

  it('lets a next-hand tap go quietly once the next hand is dealt', async () => {
    const finished: HandState = { ...startHand(karachi, { seed: 'sync-next', progress: east, dealer: 0 }), phase: 'finished', result: { type: 'draw' } };
    const dealt = settle(startHand(karachi, { seed: 'sync-next', progress: { ...east, handInRound: 2, handIndex: 2 }, dealer: 1 }), karachi, seats);
    const h = harness([stale(snapOf(dealt, 8))], snapOf(finished, 7));
    expect(await sendMove({ type: 'nextHand' }, snapOf(finished, 7), h.act, h.take, h.latest)).toEqual({ kind: 'quiet' });
    expect(h.versions).toEqual([7]);
  });

  it('hands back anything but a 409 with a table at once: a timeout, a network failure, a refusal', async () => {
    const s = untilMyTurn(settle(startHand(karachi, { seed: 'sync-turn', progress: east, dealer: 0 }), karachi, seats));
    const discard: ClientAction = { type: 'discard', seat: ME, tile: s.players[ME].concealed[0]! };
    for (const err of [new ApiError(0, 'timed out'), new TypeError('Failed to fetch'), new ApiError(400, 'not your turn'), stale()]) {
      const h = harness([err], snapOf(s, 4));
      expect(await sendMove(discard, snapOf(s, 4), h.act, h.take, h.latest)).toEqual({ kind: 'failed', err });
      expect(h.versions).toEqual([4]);
      expect(h.taken).toEqual([]);
    }
  });
});

describe('stillLegal', () => {
  const turn = (): PrivatePlayerView => viewFor(untilMyTurn(settle(startHand(karachi, { seed: 'sync-turn', progress: east, dealer: 0 }), karachi, seats)), karachi, ME);

  it('a discard needs the turn and the tile', () => {
    const v = turn();
    expect(stillLegal({ type: 'discard', seat: ME, tile: v.concealed[0]! }, v)).toBe(true);
    const missing = (['m1', 'm2', 'm3', 'm4', 'm5', 'p1', 'p2', 'p3', 's1', 's2', 'DR', 'DG', 'DW'] as const).find((k) => !v.concealed.includes(k))!;
    expect(stillLegal({ type: 'discard', seat: ME, tile: missing }, v)).toBe(false);
    expect(stillLegal({ type: 'discard', seat: ME, tile: v.concealed[0]! }, { ...v, turn: OTHER })).toBe(false);
  });

  it("a move for another seat is never this seat's", () => {
    const v = turn();
    expect(stillLegal({ type: 'discard', seat: OTHER, tile: v.concealed[0]! }, v)).toBe(false);
  });

  it('a claim must be one the table offers, tiles and all', () => {
    const v = turn();
    const claimView: PrivatePlayerView = { ...v, phase: 'claim', legal: { claims: [{ type: 'pung', tiles: ['p5', 'p5'] }], pass: true } };
    expect(stillLegal({ type: 'claim', seat: ME, claim: { type: 'pung', tiles: ['p5', 'p5'] } }, claimView)).toBe(true);
    expect(stillLegal({ type: 'claim', seat: ME, claim: { type: 'kong', tiles: ['p5', 'p5', 'p5'] } }, claimView)).toBe(false);
    expect(stillLegal({ type: 'pass', seat: ME }, claimView)).toBe(true);
    // Already answered: the window offers this seat nothing.
    expect(stillLegal({ type: 'pass', seat: ME }, { ...claimView, legal: {} })).toBe(false);
  });

  it('a win or a kong must still be on offer, on this seat’s turn', () => {
    const v = turn();
    expect(stillLegal({ type: 'declareWin', seat: ME }, { ...v, legal: { ...v.legal, win: true } })).toBe(true);
    expect(stillLegal({ type: 'declareWin', seat: ME }, { ...v, legal: { ...v.legal, win: false } })).toBe(false);
    expect(stillLegal({ type: 'declareKong', seat: ME, tile: 'p5' }, { ...v, legal: { ...v.legal, kong: ['p5'] } })).toBe(true);
    expect(stillLegal({ type: 'declareKong', seat: ME, tile: 'p5' }, { ...v, legal: { ...v.legal, kong: [] } })).toBe(false);
  });

  it('an exchange needs the right count of tiles, every one still in hand', () => {
    const v = viewFor(westExchange(), karachi, ME);
    const [a, b, c] = v.concealed;
    expect(stillLegal({ type: 'exchange', seat: ME, tiles: [a!, b!, c!] }, v)).toBe(true);
    expect(stillLegal({ type: 'exchange', seat: ME, tiles: [a!, b!] }, v)).toBe(false);
    // Three of a tile held fewer than three times.
    const once = v.concealed.find((k) => v.concealed.filter((x) => x === k).length === 1)!;
    expect(stillLegal({ type: 'exchange', seat: ME, tiles: [once, once, once] }, v)).toBe(false);
  });

  it('the next hand only while this one is finished', () => {
    const v = turn();
    expect(stillLegal({ type: 'nextHand' }, v)).toBe(false);
    expect(stillLegal({ type: 'nextHand' }, { ...v, phase: 'finished' })).toBe(true);
  });
});

describe('shouldPoll', () => {
  it('polls a game in play, on screen, with nothing of ours on its way', () => {
    expect(shouldPoll({ status: 'active', visible: true, sending: false })).toBe(true);
  });

  it('holds off while a move is in flight, the page is hidden, or there is no game in play', () => {
    expect(shouldPoll({ status: 'active', visible: true, sending: true })).toBe(false);
    expect(shouldPoll({ status: 'active', visible: false, sending: false })).toBe(false);
    expect(shouldPoll({ status: 'finished', visible: true, sending: false })).toBe(false);
    expect(shouldPoll({ status: 'abandoned', visible: true, sending: false })).toBe(false);
    expect(shouldPoll({ status: null, visible: true, sending: false })).toBe(false);
  });

  it('is slow: longer than a request is allowed to take, so looks never pile up', async () => {
    const { REQUEST_TIMEOUT_MS } = await import('./live/client');
    expect(POLL_MS).toBeGreaterThan(REQUEST_TIMEOUT_MS);
  });
});
