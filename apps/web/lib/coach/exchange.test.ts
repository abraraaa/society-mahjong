import { describe, expect, it } from 'vitest';
import { karachi, reduce, startHand, viewFor, type GameProgress, type PublicPlayerView, type Seat } from '@society/engine';
import {
  exchangeGlow,
  exchangeHeading,
  exchangeProgress,
  exchangeStep,
  goesToLine,
  passedKeys,
  passedLine,
  receiverOf,
  tileKeys,
  viewExchangeStep,
  waitingFor,
  type ExchangeStep,
} from './exchange';
import { isolate } from './words';

const WEST: GameProgress = { roundWind: 'W', roundIndex: 2, handInRound: 0, handIndex: 8 };
const EAST: GameProgress = { roundWind: 'E', roundIndex: 0, handInRound: 1, handIndex: 1 };
const NAMES: Readonly<Record<Seat, string>> = { 0: 'You', 1: 'Bilal', 2: 'Sana', 3: 'Ayesha' };

describe('exchangeStep', () => {
  it("gives West's three passes: right, across, left, three tiles each", () => {
    const spec = karachi.handSpec(WEST);
    expect([0, 1, 2].map((i) => exchangeStep(spec, i))).toEqual([
      { direction: 'right', count: 3, step: 1, of: 3 },
      { direction: 'across', count: 3, step: 2, of: 3 },
      { direction: 'left', count: 3, step: 3, of: 3 },
    ]);
    expect(exchangeStep(spec, 3)).toBeNull();
  });

  it('is null for a hand with no exchange', () => {
    expect(exchangeStep(karachi.handSpec(EAST), 0)).toBeNull();
  });

  it("reads the pass from the table's view, and nothing outside the exchange", () => {
    const view = viewFor(startHand(karachi, { seed: 'exchange-0', progress: WEST, dealer: 0 }), karachi, 0);
    expect(view.phase).toBe('preplay');
    expect(viewExchangeStep(view)).toEqual({ direction: 'right', count: 3, step: 1, of: 3 });
    expect(viewExchangeStep({ ...view, preplayStep: 2 })).toMatchObject({ direction: 'left', step: 3 });
    expect(viewExchangeStep({ ...view, phase: 'turn' })).toBeNull();
    const east = viewFor(startHand(karachi, { seed: 'exchange-0', progress: EAST, dealer: 0 }), karachi, 0);
    expect(viewExchangeStep(east)).toBeNull();
    // A ruleset the client doesn't know gives no step rather than a crash.
    expect(viewExchangeStep({ ...view, rulesetId: 'hongkong' })).toBeNull();
  });
});

describe('receiverOf', () => {
  it("passes to the engine's right, across and left", () => {
    expect(receiverOf(0, 'right')).toBe(1);
    expect(receiverOf(0, 'across')).toBe(2);
    expect(receiverOf(0, 'left')).toBe(3);
    expect(receiverOf(3, 'right')).toBe(0);
    expect(receiverOf(1, 'left')).toBe(0);
  });
});

describe('the words', () => {
  const step = (direction: ExchangeStep['direction'], n: number): ExchangeStep => ({ direction, count: 3, step: n, of: 3 });

  it('heads the sheet with which way the tiles go', () => {
    expect(exchangeHeading(step('right', 1), 3)).toBe('Pass three tiles to the right');
    expect(exchangeHeading(step('across', 2), 3)).toBe('Pass three tiles across');
    expect(exchangeHeading(step('left', 3), 3)).toBe('Pass three tiles to the left');
    expect(exchangeHeading(null, 3)).toBe('Pass three tiles');
    expect(exchangeHeading(null, 2)).toBe('Pass two tiles');
  });

  it('says which pass it is', () => {
    expect(exchangeProgress(step('right', 1))).toBe('1 of 3');
    expect(exchangeProgress(step('left', 3))).toBe('3 of 3');
  });

  it('says who gets them, and who the table is waiting for', () => {
    expect(goesToLine(isolate('Bilal'))).toBe(`They go to ${isolate('Bilal')}.`);
    expect(passedLine(isolate('Bilal'))).toBe(`Passed. Waiting for ${isolate('Bilal')}.`);
    expect(passedLine(null)).toBe('Passed.');
  });
});

describe('exchangeGlow', () => {
  it('lights exactly the suggested copies: one suggested 1 Bamboo of two held lights one', () => {
    expect(exchangeGlow(['s1', 's1', 's5', 'WE'], ['s1', 'WE', 'p9'])).toEqual([true, false, false, true]);
  });

  it('lights two of three when two are suggested, left to right', () => {
    expect(exchangeGlow(['m2', 'm2', 'm2', 'DR'], ['m2', 'm2', 'DR'])).toEqual([true, true, false, true]);
  });

  it('lights nothing for no suggestion', () => {
    expect(exchangeGlow(['m2', 'p3'], [])).toEqual([false, false]);
  });
});

describe('tileKeys', () => {
  it('keys each tile by kind and copy, as the hand tray does', () => {
    expect(tileKeys(['m1', 'm1', 'p2', 'm1'])).toEqual(['m1#0', 'm1#1', 'p2#0', 'm1#2']);
  });

  it('keeps the key of a tile that stays when the hand around it changes', () => {
    const before = tileKeys(['m1', 'p2', 'p2', 's9']);
    const after = tileKeys(['m1', 'm4', 'p2', 's9']);
    expect(after).toEqual(expect.arrayContaining(['m1#0', 'p2#0', 's9#0']));
    expect(before).toEqual(expect.arrayContaining(['m1#0', 'p2#0', 's9#0']));
  });
});

describe('waitingFor', () => {
  const players = (passed: readonly Seat[]) =>
    ([0, 1, 2, 3] as const).map((seat) => ({ seat, exchanged: passed.includes(seat) }) as unknown as PublicPlayerView) as unknown as readonly [
      PublicPlayerView,
      PublicPlayerView,
      PublicPlayerView,
      PublicPlayerView,
    ];

  it('names who has still to pass, isolated, leaving the player out', () => {
    expect(waitingFor({ me: 0, players: players([0, 2, 3]) }, NAMES)).toBe(isolate('Bilal'));
    expect(waitingFor({ me: 0, players: players([0, 3]) }, NAMES)).toBe(`${isolate('Bilal')} and ${isolate('Sana')}`);
    expect(waitingFor({ me: 0, players: players([0]) }, NAMES)).toBe(`${isolate('Bilal')}, ${isolate('Sana')} and ${isolate('Ayesha')}`);
    // The player hasn't passed yet: still only the others.
    expect(waitingFor({ me: 0, players: players([1, 2, 3]) }, NAMES)).toBeNull();
  });

  it('is null when everyone has passed', () => {
    expect(waitingFor({ me: 2, players: players([0, 1, 2, 3]) }, NAMES)).toBeNull();
  });
});

describe('passedKeys', () => {
  const hand = ['s1', 's1', 'p4', 'm9', 'WE', 'DR'] as const;

  it('keeps her own picks lifted when they are the tiles the table recorded', () => {
    // The second 1 Bamboo, not the first: the very copy she picked stays up.
    expect(passedKeys(hand, ['s1#1', 'm9#0', 'DR#0'], ['DR', 's1', 'm9'])).toEqual(['s1#1', 'm9#0', 'DR#0']);
  });

  it('lifts the tiles the table recorded when the clock passed for her, or her other phone passed others', () => {
    // Nothing picked: the table passed for her.
    expect(passedKeys(hand, [], ['p4', 'WE', 's1'])).toEqual(['s1#0', 'p4#0', 'WE#0']);
    // Three picked, but other tiles went.
    expect(passedKeys(hand, ['m9#0', 'DR#0', 's1#1'], ['p4', 'WE', 's1'])).toEqual(['s1#0', 'p4#0', 'WE#0']);
    // A pick for a tile no longer in the hand doesn't count.
    expect(passedKeys(hand, ['m9#0', 'DR#0', 'WW#0'], ['m9', 'DR', 'p4'])).toEqual(['p4#0', 'm9#0', 'DR#0']);
  });

  it("lifts nothing when the table hasn't said what went", () => {
    expect(passedKeys(hand, ['s1#0', 'p4#0', 'm9#0'], undefined)).toEqual([]);
  });

  it('reads what went from the view, as the engine keeps it until everyone has passed', () => {
    let s = startHand(karachi, { seed: 'exchange-0', progress: WEST, dealer: 0 });
    const concealed = s.players[0].concealed;
    const tiles = [concealed[4]!, concealed[0]!, concealed[9]!];
    s = reduce(s, { type: 'exchange', seat: 0, tiles }, karachi);
    const view = viewFor(s, karachi, 0);
    const keys = tileKeys(view.concealed);
    const lifted = passedKeys(view.concealed, [], view.myExchange).map((k) => view.concealed[keys.indexOf(k)]);
    expect(lifted.sort()).toEqual([...tiles].sort());
  });
});
