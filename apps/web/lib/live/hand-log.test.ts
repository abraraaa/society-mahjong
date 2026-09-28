import { describe, expect, it } from 'vitest';
import { analysisBot, karachi, startHand, viewFor, type GameProgress, type HandResult, type HandState, type Seat } from '@society/engine';
import { dealFirstHand, step, type StepInput, type StepResult } from './table';
import { commitArgs, commitHands, dealerStreakAt, handWrites, parseLoggedMove, replayHand, stamp, type HandWrite, type TableWrite } from './hand-log';
import type { ClientAction, LiveGame, LoggedMove, Move, Seats } from './types';
import { policyFor } from './policy';
import { tableStateJson } from './table-state';

const ME: Seat = 0;
const seats: Seats = [
  { kind: 'human', userId: 'u-me', name: 'Me' },
  { kind: 'bot', name: 'Bilal' },
  { kind: 'bot', name: 'Sana' },
  { kind: 'bot', name: 'Ayesha' },
];
const policy = policyFor(['new']);
const T0 = 1_700_000_000_000;

/** The human's move, played with the bot's brain; a claim window with nothing worth taking is a pass. */
function myMove(game: LiveGame): ClientAction {
  return (analysisBot(viewFor(game.state, karachi, ME), karachi) ?? { type: 'pass', seat: ME }) as ClientAction;
}

/** The moment the table's clock runs out on whatever it's waiting for. */
function lateFor(game: LiveGame): number {
  return (game.deadlines.turn ?? game.deadlines.claim)! + 1;
}

/** A hand's row as commit_table keeps it: made by the request that deals the hand, then each request's moves appended, and its result once it ends. */
interface Row {
  readonly hand_index: number;
  readonly dealer: Seat;
  readonly progress: GameProgress;
  readonly actions: LoggedMove[];
  result: HandResult | null;
  ended: boolean;
}

/** A game's hand rows, kept the way the database will: the deal writes hand 0 at version 1, and every request that changes the table writes its handWrites at the next version. */
function logBook(first: LiveGame & { readonly moves: readonly Move[] }) {
  const rows = new Map<number, Row>();
  const s = first.state;
  rows.set(s.progress.handIndex, { hand_index: s.progress.handIndex, dealer: s.dealer, progress: s.progress, actions: stamp(first.moves, 1), result: null, ended: false });
  let version = 1;
  return {
    rows,
    commit(before: HandState, r: StepResult): void {
      if (!r.changed) return;
      version += 1;
      for (const w of handWrites(before, r.state, stamp(r.moves, version))) {
        const row = rows.get(w.hand) ?? { hand_index: w.hand, dealer: w.dealer, progress: w.progress, actions: [], result: null, ended: false };
        row.actions.push(...w.moves);
        if (w.result) row.result = w.result;
        if (w.ended) row.ended = true;
        rows.set(w.hand, row);
      }
    },
  };
}

describe('stamp', () => {
  it('sets v on every move and nothing else', () => {
    const first = dealFirstHand(karachi, [seats[1], seats[2], seats[0], seats[3]] as unknown as Seats, 'stamp-1', policy, T0);
    expect(first.moves.length).toBeGreaterThan(0);
    const stamped = stamp(first.moves, 7);
    expect(stamped).toHaveLength(first.moves.length);
    stamped.forEach((m, i) => {
      expect(m).toEqual({ ...first.moves[i], v: 7 });
      expect(Object.keys(m).sort()).toEqual([...Object.keys(first.moves[i]!), 'v'].sort());
    });
    // The step's own moves are left as they were.
    expect(first.moves.every((m) => !('v' in m))).toBe(true);
  });
});

/** A hand played by the human to its end, keeping every step with the table it was taken on. */
function playedHand(seed: string): { steps: { before: LiveGame; r: StepResult }[]; game: LiveGame } {
  let game: LiveGame = dealFirstHand(karachi, seats, seed, policy, T0);
  const steps: { before: LiveGame; r: StepResult }[] = [];
  for (let i = 0; i < 400 && game.state.phase !== 'finished'; i++) {
    const r = step({ game, ruleset: karachi, seats, policy, now: T0 + i * 1000, action: myMove(game), actor: ME });
    steps.push({ before: game, r });
    game = r;
  }
  expect(game.state.phase).toBe('finished');
  return { steps, game };
}

describe('handWrites', () => {
  it('gives a move on a live hand one entry with its moves and no result, and the move that ends it the result', { timeout: 60_000 }, () => {
    const { steps } = playedHand('writes-1');
    const live = steps.find(({ r }) => r.state.phase !== 'finished')!;
    const moves = stamp(live.r.moves, 5);
    expect(handWrites(live.before.state, live.r.state, moves)).toEqual([
      { hand: 0, dealer: live.r.state.dealer, progress: live.r.state.progress, moves, result: null, ended: false },
    ]);

    const last = steps.at(-1)!;
    const ending = stamp(last.r.moves, 9);
    const [w, ...more] = handWrites(last.before.state, last.r.state, ending);
    expect(more).toEqual([]);
    expect(w).toMatchObject({ hand: 0, moves: ending, ended: true });
    expect(w!.result).not.toBeNull();
    expect(w!.result).toEqual(last.r.state.result);
  });

  it('gives a deal the new hand’s index, dealer and progress, with its bots’ first moves', { timeout: 60_000 }, () => {
    const { game } = playedHand('writes-2');
    const r = step({ game, ruleset: karachi, seats, policy, now: T0, action: { type: 'nextHand' }, actor: ME, seed: 'writes-2' });
    expect(r.dealt).toBe(true);
    const moves = stamp(r.moves, 3);
    const writes = handWrites(game.state, r.state, moves);
    expect(writes).toEqual([{ hand: 1, dealer: r.state.dealer, progress: r.state.progress, moves, result: null, ended: false }]);
    // The new dealer is a bot, which has moved before the human's first decision.
    expect(r.state.dealer).not.toBe(ME);
    expect(moves.length).toBeGreaterThan(0);
    expect(replayHand(karachi, 'writes-2', { progress: writes[0]!.progress, dealer: writes[0]!.dealer }, writes[0]!.moves)).toEqual(r.state);
    // A deal that logged nothing still makes the new hand's row.
    const bare = startHand(karachi, { seed: 'writes-2', progress: r.state.progress, dealer: r.state.dealer });
    expect(handWrites(game.state, bare, [])).toEqual([{ hand: 1, dealer: bare.dealer, progress: bare.progress, moves: [], result: null, ended: false }]);
  });

  it('gives [] for a step that logged nothing and ended nothing', { timeout: 60_000 }, () => {
    const game = dealFirstHand(karachi, seats, 'writes-3', policy, T0);
    const quiet = step({ game, ruleset: karachi, seats, policy, now: T0 + 1000 });
    expect(quiet.moves).toEqual([]);
    expect(handWrites(game.state, quiet.state, [])).toEqual([]);
    // Nor for a finished hand looked at again, or a "next hand" when the game is over.
    const { game: done } = playedHand('writes-3');
    expect(handWrites(done.state, done.state, [])).toEqual([]);
    const lastHand = { ...done.state, progress: { roundWind: 'N' as const, roundIndex: 3, handInRound: 3, handIndex: 15 } };
    const over = step({
      game: { state: lastHand, deadlines: done.deadlines },
      ruleset: karachi,
      seats,
      policy,
      now: T0,
      action: { type: 'nextHand' },
      actor: ME,
      seed: 'writes-3',
    });
    expect(over.gameOver).toBe(true);
    expect(handWrites(lastHand, over.state, stamp(over.moves, 4))).toEqual([]);
  });

  it('puts every move in the hand the step returns', { timeout: 60_000 }, () => {
    const { steps, game } = playedHand('writes-4');
    const dealt = step({ game, ruleset: karachi, seats, policy, now: T0, action: { type: 'nextHand' }, actor: ME, seed: 'writes-4' });
    for (const { before, r } of [...steps, { before: game, r: dealt }]) {
      const writes = handWrites(before.state, r.state, stamp(r.moves, 2));
      expect(writes).toHaveLength(1);
      expect(writes[0]!.hand).toBe(r.state.progress.handIndex);
      expect(writes[0]!.moves).toHaveLength(r.moves.length);
    }
  });
});

/** The hand writes of three real steps: a move on a live hand, the step that finishes it (a win, on this seed), and the deal of the next. */
function threeWrites(): { live: HandWrite; ended: HandWrite; dealt: HandWrite } {
  const seed = 'writes-2';
  const { steps, game } = playedHand(seed);
  const live = steps.find(({ r }) => r.state.phase !== 'finished')!;
  const last = steps.at(-1)!;
  const deal = step({ game, ruleset: karachi, seats, policy, now: T0, action: { type: 'nextHand' }, actor: ME, seed });
  const [a] = handWrites(live.before.state, live.r.state, stamp(live.r.moves, 2));
  const [b] = handWrites(last.before.state, last.r.state, stamp(last.r.moves, 3));
  const [c] = handWrites(game.state, deal.state, stamp(deal.moves, 4));
  return { live: a!, ended: b!, dealt: c! };
}

describe('commitHands', () => {
  it('gives each hand row exactly the keys commit_table reads, with the types it casts them to', { timeout: 60_000 }, () => {
    const { live, ended, dealt } = threeWrites();
    expect(ended.result?.type).toBe('win');
    const washout: HandWrite = { ...ended, result: { type: 'draw' } };
    // As it reaches the database: JSON.
    const entries = JSON.parse(JSON.stringify(commitHands([live, ended, dealt, washout]))) as Record<string, unknown>[];
    expect(entries).toHaveLength(4);
    for (const e of entries) {
      expect(Object.keys(e).sort()).toEqual(['dealer', 'ended', 'hand', 'moves', 'progress', 'result', 'settlement']);
      // hands.hand_index, dealer and progress are not null: a hand the function can't place fails the whole commit.
      expect(Number.isInteger(e['hand'])).toBe(true);
      expect(e['hand']).toBe((e['progress'] as { handIndex: unknown }).handIndex);
      expect(Number.isInteger(e['dealer']) && (e['dealer'] as number) >= 0 && (e['dealer'] as number) <= 3).toBe(true);
      const moves = e['moves'] as Record<string, unknown>[];
      expect(Array.isArray(moves)).toBe(true);
      for (const m of moves) {
        expect(typeof m['v']).toBe('number');
        expect(typeof m['by']).toBe('string');
      }
      for (const doc of [e['result'], e['settlement']]) expect(doc === null || (typeof doc === 'object' && !Array.isArray(doc))).toBe(true);
      expect(typeof e['ended']).toBe('boolean');
    }
    const [onLive, onEnd, onDeal, onWashout] = entries;
    expect(onLive).toMatchObject({ hand: 0, result: null, settlement: null, ended: false });
    expect((onLive!['moves'] as unknown[]).length).toBeGreaterThan(0);
    // The win's settlement goes with its result; a washout has none.
    expect(onEnd).toMatchObject({ hand: 0, ended: true });
    expect(onEnd!['result']).toEqual(JSON.parse(JSON.stringify(ended.result)));
    expect(onEnd!['settlement']).toEqual(JSON.parse(JSON.stringify(ended.result?.type === 'win' ? ended.result.settlement : 'no win')));
    expect(onWashout).toMatchObject({ result: { type: 'draw' }, settlement: null, ended: true });
    expect(onDeal).toMatchObject({ hand: 1, dealer: dealt.dealer, result: null, settlement: null, ended: false });
    expect(commitHands([])).toEqual([]);
  });
});

describe('commitArgs', () => {
  it('gives exactly commit_table’s nine arguments, times as ISO strings or null', { timeout: 60_000 }, () => {
    const { live, ended } = threeWrites();
    const table = { v: 1, scores: [3, -3, 0, 0] as const, extra: { ready: { hand: 0 } } };
    const w: TableWrite = { state: { seq: 7 } as never, table, deadlines: { claim: T0 + 20_000, turn: null }, wakeAt: T0 + 20_000, acted: true, hands: [live, ended] };
    const args = commitArgs('g-1', 6, w);
    expect(Object.keys(args).sort()).toEqual(['p_acted', 'p_claim_deadline', 'p_expected', 'p_game_id', 'p_hands', 'p_state', 'p_table_state', 'p_turn_deadline', 'p_wake_at']);
    expect(args).toEqual({
      p_game_id: 'g-1',
      p_expected: 6,
      p_state: w.state,
      p_table_state: tableStateJson(table),
      p_claim_deadline: new Date(T0 + 20_000).toISOString(),
      p_turn_deadline: null,
      p_wake_at: new Date(T0 + 20_000).toISOString(),
      p_acted: true,
      p_hands: commitHands([live, ended]),
    });
    expect(args.p_table_state).toEqual({ v: 1, scores: [3, -3, 0, 0], ready: { hand: 0 } });

    // No clocks, a request no person made, and no hand rows.
    const quiet = commitArgs('g-1', 7, { ...w, deadlines: { claim: null, turn: T0 + 90_000 }, wakeAt: null, acted: false, hands: [] });
    expect(quiet).toMatchObject({ p_claim_deadline: null, p_turn_deadline: new Date(T0 + 90_000).toISOString(), p_wake_at: null, p_acted: false, p_hands: [] });
  });
});

describe('parseLoggedMove', () => {
  const discard = { type: 'discard', seat: 0, tile: 'p5' };

  it('survives garbage', () => {
    const garbage: unknown[] = [
      undefined,
      null,
      0,
      'discard',
      [],
      {},
      [{ v: 1, by: 'bot', seat: 1, a: { type: 'pass', seat: 1 } }],
      { v: 1 },
      { v: 1, by: 'bot', seat: 1 },
      { v: '1', by: 'bot', seat: 1, a: { type: 'pass', seat: 1 } },
      { v: 1.5, by: 'bot', seat: 1, a: { type: 'pass', seat: 1 } },
      { v: -1, by: 'bot', seat: 1, a: { type: 'pass', seat: 1 } },
      { v: 1, by: 'robot', seat: 1, a: { type: 'pass', seat: 1 } },
      { v: 1, by: 'bot', seat: 4, a: { type: 'pass', seat: 1 } },
      { v: 1, by: 'bot', seat: '1', a: { type: 'pass', seat: 1 } },
      { v: 1, by: 'player', seat: 0, userId: 7, a: discard },
      { v: 1, by: 'bot', seat: 1, a: 'pass' },
      { v: 1, by: 'bot', seat: 1, a: { type: 'resolveClaims' } },
      { v: 1, by: 'player', seat: 0, a: { type: 'nextHand' } },
      { v: 1, by: 'bot', seat: 1, a: { type: 'discard', seat: 1, tile: 'zz' } },
      { v: 1, by: 'bot', seat: 1, a: { type: 'discard', seat: 5, tile: 'p5' } },
      { v: 1, by: 'table', seat: 1, a: { type: 'away', reason: 'bored' } },
      { v: 1, by: 'host', a: { type: 'endGame', how: 'rage' } },
      { v: 1, by: 'table', seat: 1, a: { type: 'shuffle' } },
    ];
    for (const x of garbage) expect(parseLoggedMove(x), JSON.stringify(x)).toBeNull();
  });

  it('reads an engine move, keeping only the keys it knows', () => {
    expect(parseLoggedMove({ v: 3, by: 'player', seat: 0, userId: 'u-me', a: { ...discard, why: 'x' }, extra: true })).toEqual({
      v: 3,
      by: 'player',
      seat: 0,
      userId: 'u-me',
      a: discard,
    });
    expect(parseLoggedMove({ v: 4, by: 'bot', seat: 2, a: { type: 'claim', seat: 2, claim: { type: 'pung', tiles: ['p5', 'p5'] } } })).toEqual({
      v: 4,
      by: 'bot',
      seat: 2,
      a: { type: 'claim', seat: 2, claim: { type: 'pung', tiles: ['p5', 'p5'] } },
    });
    expect(parseLoggedMove({ v: 5, by: 'clock', seat: 1, a: { type: 'exchange', seat: 1, tiles: ['m1', 'DR', 'WE'] } })).toEqual({
      v: 5,
      by: 'clock',
      seat: 1,
      a: { type: 'exchange', seat: 1, tiles: ['m1', 'DR', 'WE'] },
    });
  });

  it('reads a table note', () => {
    expect(parseLoggedMove({ v: 6, by: 'table', seat: 1, a: { type: 'away', reason: 'clock' } })).toEqual({ v: 6, by: 'table', seat: 1, a: { type: 'away', reason: 'clock' } });
    expect(parseLoggedMove({ v: 7, by: 'player', seat: 1, userId: 'u-b', a: { type: 'back' } })).toEqual({ v: 7, by: 'player', seat: 1, userId: 'u-b', a: { type: 'back' } });
    // A game's end names no seat.
    expect(parseLoggedMove({ v: 8, by: 'host', userId: 'u-a', a: { type: 'endGame', how: 'host' } })).toEqual({
      v: 8,
      by: 'host',
      userId: 'u-a',
      a: { type: 'endGame', how: 'host' },
    });
  });

  it('gives null for an action logged before every move was, with no v or by', () => {
    expect(parseLoggedMove(discard)).toBeNull();
    expect(parseLoggedMove({ ...discard, v: 2 })).toBeNull();
  });
});

describe('replayHand', () => {
  /** A hand at a table whose one human never answers: every decision of theirs goes to the clock, and the bots play gently. */
  function clockHand(seed: string): { first: LiveGame & { moves: readonly Move[] }; log: LoggedMove[]; end: HandState } {
    const first = dealFirstHand(karachi, seats, seed, policy, T0, { bots: 'gentle' });
    const log = stamp(first.moves, 1);
    let game: LiveGame = first;
    let version = 1;
    for (let i = 0; i < 400 && game.state.phase !== 'finished'; i++) {
      const r = step({ game, ruleset: karachi, seats, policy, now: lateFor(game), bots: 'gentle' });
      expect(r.changed).toBe(true);
      expect(r.moves[0]).toMatchObject({ by: 'clock', seat: ME });
      version += 1;
      log.push(...stamp(r.moves, version));
      game = r;
    }
    expect(game.state.phase).toBe('finished');
    return { first, log, end: game.state };
  }

  it('replays a hand from its seed and its log, with gentle bots and a human whose clock runs out every turn', { timeout: 60_000 }, () => {
    const { first, log, end } = clockHand('replay-1');
    expect(log.some((m) => m.by === 'bot')).toBe(true);
    expect(replayHand(karachi, 'replay-1', { progress: first.state.progress, dealer: first.state.dealer }, log)).toEqual(end);
    // Read back from JSON, as it comes out of the database.
    expect(replayHand(karachi, 'replay-1', { progress: first.state.progress, dealer: first.state.dealer }, JSON.parse(JSON.stringify(log)) as unknown[])).toEqual(end);
  });

  it('replays the West exchanges, the bots’ and the clock’s', { timeout: 60_000 }, () => {
    const progress: GameProgress = { roundWind: 'W', roundIndex: 2, handInRound: 0, handIndex: 8 };
    const dealt = startHand(karachi, { seed: 'replay-w', progress, dealer: 1 });
    expect(dealt.phase).toBe('preplay');
    let game: LiveGame = { state: dealt, deadlines: { claim: null, turn: null } };
    const log: LoggedMove[] = [];
    for (let v = 1; v < 400 && game.state.phase !== 'finished'; v++) {
      const now = game.deadlines.turn === null && game.deadlines.claim === null ? T0 : lateFor(game);
      const r = step({ game, ruleset: karachi, seats, policy, now, bots: 'gentle' });
      log.push(...stamp(r.moves, v));
      game = r;
    }
    expect(game.state.phase).toBe('finished');
    expect(log.filter((m) => m.a.type === 'exchange' && m.by === 'bot').length).toBeGreaterThanOrEqual(3);
    expect(log.some((m) => m.a.type === 'exchange' && m.by === 'clock')).toBe(true);
    expect(replayHand(karachi, 'replay-w', { progress, dealer: 1 }, log)).toEqual(game.state);
  });

  it('skips table notes', { timeout: 60_000 }, () => {
    const { first, log, end } = clockHand('replay-2');
    const noted: unknown[] = [
      log[0],
      { v: log[0]!.v, by: 'table', seat: ME, a: { type: 'away', reason: 'clock' } },
      ...log.slice(1, 4),
      { v: log[3]!.v, by: 'player', seat: ME, userId: 'u-me', a: { type: 'back' } },
      ...log.slice(4),
      { v: log.at(-1)!.v, by: 'table', a: { type: 'endGame', how: 'complete' } },
    ];
    expect(replayHand(karachi, 'replay-2', { progress: first.state.progress, dealer: first.state.dealer }, noted)).toEqual(end);
  });

  it('throws on a v that goes down, and on an entry it can’t read', { timeout: 60_000 }, () => {
    const { first, log } = clockHand('replay-3');
    const start = { progress: first.state.progress, dealer: first.state.dealer };
    const late = log.findIndex((m) => m.v > 2);
    const backwards = [...log.slice(0, late + 1), { ...log[late + 1]!, v: 2 }, ...log.slice(late + 2)];
    expect(() => replayHand(karachi, 'replay-3', start, backwards)).toThrow(/goes back/);
    // A hand begun before every move was logged holds bare actions: it doesn't replay.
    const bare = [log[0]!.a, ...log.slice(1)];
    expect(() => replayHand(karachi, 'replay-3', start, bare)).toThrow(/not a logged move/);
  });

  it('replays every hand of a game from the rows the table writes, across a deal, with the dealer run as the streak', { timeout: 120_000 }, () => {
    const seed = 'replay-game';
    const first = dealFirstHand(karachi, seats, seed, policy, T0, { bots: 'gentle' });
    const book = logBook(first);
    const finals = new Map<number, HandState>();
    let game: LiveGame = first;
    for (let i = 0; i < 1200 && game.state.progress.handIndex < 2; i++) {
      const input: StepInput =
        game.state.phase === 'finished'
          ? { game, ruleset: karachi, seats, policy, now: T0 + i * 1000, action: { type: 'nextHand' }, actor: ME, seed, bots: 'gentle' }
          : i % 3 === 0
            ? { game, ruleset: karachi, seats, policy, now: lateFor(game), bots: 'gentle' }
            : { game, ruleset: karachi, seats, policy, now: T0 + i * 1000, action: myMove(game), actor: ME, bots: 'gentle' };
      if (game.state.phase === 'finished') finals.set(game.state.progress.handIndex, game.state);
      const r = step(input);
      book.commit(game.state, r);
      game = r;
    }
    finals.set(game.state.progress.handIndex, game.state);
    expect(game.state.progress.handIndex).toBe(2);

    const rows = [...book.rows.values()];
    expect(rows.map((r) => r.hand_index)).toEqual([0, 1, 2]);
    for (const row of rows) {
      // The log is appended in version order, so v never goes down.
      const vs = row.actions.map((m) => m.v);
      expect(vs).toEqual([...vs].sort((a, b) => a - b));
      const start = { progress: row.progress, dealer: row.dealer, dealerStreak: dealerStreakAt(rows, row.hand_index) };
      const replayed = replayHand(karachi, seed, start, JSON.parse(JSON.stringify(row.actions)) as unknown[]);
      expect(replayed).toEqual(finals.get(row.hand_index));
      expect(row.ended).toBe(replayed.phase === 'finished');
      expect(row.result).toEqual(row.ended ? replayed.result : null);
    }
    // The player's own moves carry their id; the clock's and the bots' don't.
    const all = rows.flatMap((r) => r.actions);
    expect(all.filter((m) => m.by === 'player').every((m) => m.userId === 'u-me' && m.seat === ME)).toBe(true);
    expect(all.filter((m) => m.by !== 'player').every((m) => m.userId === undefined)).toBe(true);
  });
});

describe('dealerStreakAt', () => {
  it('counts a retained dealer’s run, and starts again at 0 for a new dealer', () => {
    const rows = [
      { hand_index: 3, dealer: 1 },
      { hand_index: 0, dealer: 0 },
      { hand_index: 1, dealer: 1 },
      { hand_index: 2, dealer: 1 },
      { hand_index: 4, dealer: 2 },
      { hand_index: 5, dealer: 2 },
    ];
    expect(dealerStreakAt(rows, 0)).toBe(0);
    expect(dealerStreakAt(rows, 1)).toBe(0);
    expect(dealerStreakAt(rows, 2)).toBe(1);
    expect(dealerStreakAt(rows, 3)).toBe(2);
    expect(dealerStreakAt(rows, 4)).toBe(0);
    expect(dealerStreakAt(rows, 5)).toBe(1);
    // A hand with no row, or a gap in the rows, ends the run.
    expect(dealerStreakAt(rows, 9)).toBe(0);
    expect(
      dealerStreakAt(
        [
          { hand_index: 0, dealer: 1 },
          { hand_index: 2, dealer: 1 },
        ],
        2,
      ),
    ).toBe(0);
  });

  it('matches the streak the engine keeps across a real game', { timeout: 60_000 }, () => {
    // Karachi moves the dealer on every hand, so every streak is 0; the rows say so without storing it.
    const first = dealFirstHand(karachi, seats, 'streak-1', policy, T0);
    const book = logBook(first);
    let game: LiveGame = first;
    for (let i = 0; i < 800 && game.state.progress.handIndex < 2; i++) {
      const r =
        game.state.phase === 'finished'
          ? step({ game, ruleset: karachi, seats, policy, now: T0, action: { type: 'nextHand' }, actor: ME, seed: 'streak-1' })
          : step({ game, ruleset: karachi, seats, policy, now: T0 + i * 1000, action: myMove(game), actor: ME });
      book.commit(game.state, r);
      if (r.dealt) expect(dealerStreakAt([...book.rows.values()], r.state.progress.handIndex)).toBe(r.state.dealerStreak);
      game = r;
    }
    expect(game.state.progress.handIndex).toBe(2);
  });
});
