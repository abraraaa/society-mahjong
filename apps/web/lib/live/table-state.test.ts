import { describe, expect, it } from 'vitest';
import { EVERYONE_HERE, markAway, markPresent, noteClockMove } from './absence';
import { NEW_TABLE, TABLE_STATE_V, lastActed, parseTableState, sameTableState, tableStateJson, wakeAt, withLegacyScores, type GameOver, type TableState } from './table-state';
import { STALE_GAME_MS } from './lifecycle';
import type { Seats } from './types';

const T0 = 1_700_000_000_000;

const SEATS: Seats = [
  { kind: 'human', userId: 'u-amna', name: 'Amna' },
  { kind: 'human', userId: 'u-bilal', name: 'Bilal' },
  { kind: 'bot', name: 'Sana' },
  { kind: 'bot', name: 'Omar' },
];
/** A game whose last hand was scored: Bilal top. */
const OVER: GameOver = { how: 'complete', by: null, at: T0, hands: 16, scores: [2000, 14504, -8000, -8504], seats: SEATS };

describe('parseTableState', () => {
  it('reads 0005’s default, and anything that isn’t a document, as a legacy table with no scores of its own', () => {
    for (const x of [{}, null, undefined, 0, 'v1', [], [1, 2, 3, 4], true]) {
      expect(parseTableState(x), JSON.stringify(x)).toEqual({
        table: { v: TABLE_STATE_V, scores: null, over: null, absence: EVERYONE_HERE, ready: null, extra: {} },
        legacy: true,
      });
    }
  });

  it('treats a "v" it can’t read as no "v" at all', () => {
    for (const v of ['1', 0, -1, 1.5, null, true]) expect(parseTableState({ v, scores: [1, 2, 3, 4] }).legacy, String(v)).toBe(true);
  });

  it('reads a v1 table’s scores', () => {
    expect(parseTableState({ v: 1, scores: [0, 14504, -8000, -6504] })).toEqual({
      table: { v: 1, scores: [0, 14504, -8000, -6504], over: null, absence: EVERYONE_HERE, ready: null, extra: {} },
      legacy: false,
    });
  });

  it('gives a table whose scores are missing or wrong nobody any points, rather than failing', () => {
    for (const scores of [undefined, null, [1, 2, 3], [1, 2, 3, 4, 5], ['1', 2, 3, 4], [1, null, 3, 4], 'none', { 0: 1 }]) {
      expect(parseTableState({ v: 1, scores }).table.scores, JSON.stringify(scores)).toEqual([0, 0, 0, 0]);
    }
  });

  it('reads a newer deploy’s table as given, parts and all, so the service can see it isn’t its own', () => {
    const { table, legacy } = parseTableState({ v: 2, scores: [5, -5, 0, 0], ready: { hand: 3, userIds: ['u-a'], dealAt: T0 }, later: { hand: 3 } });
    expect(legacy).toBe(false);
    expect(table).toEqual({ v: 2, scores: [5, -5, 0, 0], over: null, absence: EVERYONE_HERE, ready: { hand: 3, userIds: ['u-a'], dealAt: T0 }, extra: { later: { hand: 3 } } });
  });

  it('reads how the game ended', () => {
    const { table, legacy } = parseTableState(JSON.parse(JSON.stringify({ v: 1, scores: OVER.scores, over: OVER })));
    expect(legacy).toBe(false);
    expect(table).toEqual({ v: 1, scores: OVER.scores, over: OVER, absence: EVERYONE_HERE, ready: null, extra: {} });
    const byHost = { ...OVER, how: 'host', by: { userId: 'u-amna', name: 'Amna' }, hands: 7 };
    expect(parseTableState({ v: 1, scores: OVER.scores, over: byHost }).table.over).toEqual(byHost);
  });

  it('gives an end with parts missing or wrong their defaults, rather than failing', () => {
    const over = parseTableState({ v: 1, scores: [1, -1, 0, 0], over: { how: 'abandoned', by: { userId: 7 }, at: 'noon', hands: -2, scores: [1, 2], seats: 'none' } }).table.over;
    expect(over).toEqual({ how: 'abandoned', by: null, at: 0, hands: 0, scores: [1, -1, 0, 0], seats: [null, null, null, null] });
    // A seat it can't read is an empty seat; one it can keeps whatever else it holds.
    const seats = [{ kind: 'human', userId: 'u-a', name: 'A', since: 'then' }, { kind: 'bot', name: 'B', heldFor: 'u-c' }, { kind: 'human', name: 'no id' }, 'x'];
    expect(parseTableState({ v: 1, scores: [0, 0, 0, 0], over: { how: 'complete', seats } }).table.over?.seats).toEqual([seats[0], seats[1], null, null]);
  });

  it('leaves an end it can’t read in `extra`, written back as it was, and reads the game as in play', () => {
    for (const odd of [{ how: 'timeout', at: T0 }, 'over', 3, null]) {
      const { table } = parseTableState({ v: 1, scores: [0, 0, 0, 0], over: odd });
      expect(table.over, JSON.stringify(odd)).toBeNull();
      expect(tableStateJson(table)).toEqual({ v: 1, scores: [0, 0, 0, 0], over: odd });
    }
  });

  it('reads a legacy row as in play, whatever it holds', () => {
    const { table, legacy } = parseTableState({ over: OVER });
    expect(legacy).toBe(true);
    expect(table.over).toBeNull();
    expect(table.extra).toEqual({ over: OVER });
  });

  it('reads who’s ready for the next hand, each id once', () => {
    const { table } = parseTableState({ v: 1, scores: [0, 0, 0, 0], ready: { hand: 7, userIds: ['u-a', 'u-b', 'u-a', 3, null], dealAt: T0 + 20_000 } });
    expect(table.ready).toEqual({ hand: 7, userIds: ['u-a', 'u-b'], dealAt: T0 + 20_000 });
    // No ids is nobody yet, not a wait that can't be read.
    expect(parseTableState({ v: 1, ready: { hand: 0, dealAt: T0 } }).table.ready).toEqual({ hand: 0, userIds: [], dealAt: T0 });
  });

  it('reads a wait with no hand or no start time as none, and drops it', () => {
    for (const ready of [
      { userIds: ['u-a'], dealAt: T0 },
      { hand: 7, userIds: ['u-a'] },
      { hand: -1, dealAt: T0 },
      { hand: 1.5, dealAt: T0 },
      { hand: 7, dealAt: 'soon' },
      [7],
      'ready',
      null,
    ]) {
      const { table } = parseTableState({ v: 1, scores: [0, 0, 0, 0], ready });
      expect(table.ready, JSON.stringify(ready)).toBeNull();
      expect(tableStateJson(table), JSON.stringify(ready)).toEqual({ v: 1, scores: [0, 0, 0, 0] });
    }
  });

  it('reads nobody ready on a legacy row, keeping whatever it held in `extra`', () => {
    const { table } = parseTableState({ ready: { hand: 3, userIds: ['u-a'], dealAt: T0 } });
    expect(table.ready).toBeNull();
    expect(table.extra).toEqual({ ready: { hand: 3, userIds: ['u-a'], dealAt: T0 } });
  });
});

describe('tableStateJson', () => {
  it('writes v1 with the scores, and no end while the game is in play', () => {
    expect(tableStateJson(NEW_TABLE)).toEqual({ v: 1, scores: [0, 0, 0, 0] });
    expect(tableStateJson({ v: 1, scores: [3, -3, 0, 0], over: null, absence: EVERYONE_HERE, ready: null, extra: {} })).toEqual({ v: 1, scores: [3, -3, 0, 0] });
  });

  it('writes who’s ready for the next hand only once someone is, and reads it back the same', () => {
    expect(tableStateJson(NEW_TABLE)).not.toHaveProperty('ready');
    const t: TableState = { ...NEW_TABLE, ready: { hand: 4, userIds: ['u-amna'], dealAt: T0 + 20_000 } };
    const written = tableStateJson(t);
    expect(written).toEqual({ v: 1, scores: [0, 0, 0, 0], ready: { hand: 4, userIds: ['u-amna'], dealAt: T0 + 20_000 } });
    expect(parseTableState(JSON.parse(JSON.stringify(written)))).toEqual({ table: t, legacy: false });
  });

  it('writes how the game ended once it has, and reads it back the same', () => {
    const t: TableState = { v: 1, scores: OVER.scores, over: OVER, absence: EVERYONE_HERE, ready: null, extra: {} };
    const written = tableStateJson(t);
    expect(written).toEqual({ v: 1, scores: OVER.scores, over: OVER });
    expect(parseTableState(JSON.parse(JSON.stringify(written)))).toEqual({ table: t, legacy: false });
  });

  it('puts back the keys it doesn’t know, untouched, so an older deploy never erases a newer one’s bookkeeping', () => {
    const stored = { v: 1, scores: [1, -1, 0, 0], lobby: { hand: 3, dealAt: T0 }, handover: [{ userId: 'u-a', misses: 1 }], later: [1, { deep: true }] };
    const back = tableStateJson(parseTableState(stored).table);
    expect(back).toEqual(stored);
    // And it survives the database's round trip.
    expect(parseTableState(JSON.parse(JSON.stringify(back)))).toEqual(parseTableState(stored));
  });

  it('writes who’s away only once some seat has something in it, and reads it back the same', () => {
    expect(tableStateJson(NEW_TABLE)).not.toHaveProperty('absence');
    const away = noteClockMove(markAway(EVERYONE_HERE, SEATS, 1, 'host'), SEATS, { by: 'clock', seat: 0, a: { type: 'discard', seat: 0, tile: 's5' } }, true);
    const t: TableState = { ...NEW_TABLE, absence: markPresent(away, SEATS, 0, T0) };
    const written = tableStateJson(t);
    expect(written['absence']).toEqual([
      {
        userId: 'u-amna',
        since: null,
        misses: 0,
        away: null,
        clockMoves: 1,
        lastClockMove: { by: 'clock', seat: 0, a: { type: 'discard', seat: 0, tile: 's5' } },
        lastTap: T0,
        played: { turns: 0, sets: 0, exchanges: 0, wins: 0, hands: 0 },
      },
      {
        userId: 'u-bilal',
        since: null,
        misses: 0,
        away: 'host',
        clockMoves: 0,
        lastClockMove: null,
        lastTap: null,
        played: { turns: 0, sets: 0, exchanges: 0, wins: 0, hands: 0 },
      },
      EVERYONE_HERE[2],
      EVERYONE_HERE[3],
    ]);
    expect(parseTableState(JSON.parse(JSON.stringify(written)))).toEqual({ table: t, legacy: false });
    // A tap alone is kept too: the host's hand-over is refused for someone who has just played (R8).
    expect(tableStateJson({ ...NEW_TABLE, absence: markPresent(EVERYONE_HERE, SEATS, 1, T0) })['absence']).toHaveLength(4);
  });

  it('reads no one away on a legacy row, keeping whatever it held in `extra`', () => {
    const { table } = parseTableState({ absence: [{ away: 'clock' }] });
    expect(table.absence).toBe(EVERYONE_HERE);
    expect(table.extra).toEqual({ absence: [{ away: 'clock' }] });
  });

  it('writes a legacy table with its seeded scores as a v1 table', () => {
    const { table } = parseTableState({ note: 'kept' });
    const written = tableStateJson(withLegacyScores(table, [7, -7, 0, 0]));
    expect(written).toEqual({ note: 'kept', v: 1, scores: [7, -7, 0, 0] });
    expect(parseTableState(written)).toEqual({ table: { v: 1, scores: [7, -7, 0, 0], over: null, absence: EVERYONE_HERE, ready: null, extra: { note: 'kept' } }, legacy: false });
  });
});

describe('withLegacyScores', () => {
  const legacy = parseTableState({}).table;

  it('seeds a legacy table from the room’s ledger', () => {
    expect(withLegacyScores(legacy, [3, -3, 0, 0]).scores).toEqual([3, -3, 0, 0]);
  });

  it('normalises a short, long or non-numeric ledger to four numbers', () => {
    expect(withLegacyScores(legacy, [5]).scores).toEqual([5, 0, 0, 0]);
    expect(withLegacyScores(legacy, [1, 2, 3, 4, 5]).scores).toEqual([1, 2, 3, 4]);
    expect(withLegacyScores(legacy, ['8', null, 2, Number.NaN]).scores).toEqual([0, 0, 2, 0]);
    expect(withLegacyScores(legacy, []).scores).toEqual([0, 0, 0, 0]);
    expect(withLegacyScores(legacy, null).scores).toEqual([0, 0, 0, 0]);
    expect(withLegacyScores(legacy, undefined).scores).toEqual([0, 0, 0, 0]);
  });

  it('leaves a table that has its own scores alone', () => {
    const own: TableState = { v: 1, scores: [9, -9, 0, 0], over: null, absence: EVERYONE_HERE, ready: null, extra: {} };
    expect(withLegacyScores(own, [1, 1, 1, 1])).toBe(own);
  });
});

describe('sameTableState', () => {
  it('compares what the tables hold, not which objects they are', () => {
    const a = parseTableState({ v: 1, scores: [1, -1, 0, 0], ready: { hand: 2, userIds: ['u-a'], dealAt: T0 }, later: { hand: 2, ids: [] } }).table;
    const b = parseTableState({ later: { ids: [], hand: 2 }, ready: { dealAt: T0, userIds: ['u-a'], hand: 2 }, scores: [1, -1, 0, 0], v: 1 }).table;
    expect(sameTableState(a, b)).toBe(true);
    expect(sameTableState(a, { ...a, scores: [1, -1, 0, 1] })).toBe(false);
    expect(sameTableState(a, { ...a, v: 2 })).toBe(false);
    expect(sameTableState(a, { ...a, extra: { later: { hand: 3, ids: [] } } })).toBe(false);
    // Who's ready for the next hand is news: a vote, another hand, a later start, or the wait over.
    expect(sameTableState(a, { ...a, ready: { hand: 2, userIds: ['u-a', 'u-b'], dealAt: T0 } })).toBe(false);
    expect(sameTableState(a, { ...a, ready: { hand: 3, userIds: ['u-a'], dealAt: T0 } })).toBe(false);
    expect(sameTableState(a, { ...a, ready: { hand: 2, userIds: ['u-a'], dealAt: T0 + 1 } })).toBe(false);
    expect(sameTableState(a, { ...a, ready: null })).toBe(false);
    expect(sameTableState(a, { ...a, extra: {} })).toBe(false);
    expect(sameTableState(NEW_TABLE, { ...NEW_TABLE, scores: null })).toBe(false);
  });

  it('ignores when each person last tapped, and nothing else about who’s away', () => {
    const tapped: TableState = { ...NEW_TABLE, absence: markPresent(EVERYONE_HERE, SEATS, 0, T0) };
    expect(sameTableState(NEW_TABLE, tapped)).toBe(true);
    expect(sameTableState(tapped, { ...tapped, absence: markPresent(tapped.absence, SEATS, 0, T0 + 5_000) })).toBe(true);
    expect(sameTableState(NEW_TABLE, { ...NEW_TABLE, absence: markAway(EVERYONE_HERE, SEATS, 1, 'host') })).toBe(false);
  });

  it('tells an ended game from one in play, and one end from another', () => {
    const ended: TableState = { ...NEW_TABLE, over: OVER };
    expect(sameTableState(NEW_TABLE, ended)).toBe(false);
    expect(sameTableState(ended, parseTableState(JSON.parse(JSON.stringify(tableStateJson(ended)))).table)).toBe(true);
    expect(sameTableState(ended, { ...ended, over: { ...OVER, hands: 15 } })).toBe(false);
  });
});

describe('lastActed', () => {
  it('gives a legacy table the later of acted_at and updated_at, since older code stamped only updated_at', () => {
    expect(lastActed({ legacy: true, actedAt: T0, updatedAt: T0 + 5000 })).toBe(T0 + 5000);
    expect(lastActed({ legacy: true, actedAt: T0 + 5000, updatedAt: T0 })).toBe(T0 + 5000);
  });

  it('gives a table with a "v" its acted_at, even when updated_at is later', () => {
    expect(lastActed({ legacy: false, actedAt: T0, updatedAt: T0 + 5000 })).toBe(T0);
  });
});

describe('wakeAt', () => {
  const at = (claim: number | null, turn: number | null) => wakeAt({ deadlines: { claim, turn }, table: NEW_TABLE, actedAt: T0 });

  it('is the earlier of the two clocks', () => {
    expect(at(T0 + 20_000, null)).toBe(T0 + 20_000);
    expect(at(null, T0 + 90_000)).toBe(T0 + 90_000);
    expect(at(T0 + 90_000, T0 + 20_000)).toBe(T0 + 20_000);
    expect(at(T0 + 20_000, T0 + 90_000)).toBe(T0 + 20_000);
  });

  it('is when the game would end as idle, six hours after a person last moved it, when no clock is running', () => {
    expect(at(null, null)).toBe(T0 + STALE_GAME_MS);
  });

  it('is the idle end when that comes before a clock, as for a table read long after its last move', () => {
    const stalled = wakeAt({ deadlines: { claim: null, turn: T0 + 90_000 }, table: NEW_TABLE, actedAt: T0 - STALE_GAME_MS });
    expect(stalled).toBe(T0);
    expect(wakeAt({ deadlines: { claim: null, turn: T0 + STALE_GAME_MS + 1 }, table: NEW_TABLE, actedAt: T0 })).toBe(T0 + STALE_GAME_MS);
  });

  it('is when the next hand starts, on a finished hand someone has tapped Next hand on, through its turn clock', () => {
    const table: TableState = { ...NEW_TABLE, ready: { hand: 4, userIds: ['u-amna'], dealAt: T0 + 20_000 } };
    expect(wakeAt({ deadlines: { claim: null, turn: T0 + 20_000 }, table, actedAt: T0 })).toBe(T0 + 20_000);
  });

  it('is null once the game is over, whatever the clocks or the last move say', () => {
    expect(wakeAt({ deadlines: { claim: T0 + 20_000, turn: T0 + 90_000 }, table: { ...NEW_TABLE, over: OVER }, actedAt: T0 })).toBeNull();
    expect(wakeAt({ deadlines: { claim: null, turn: null }, table: { ...NEW_TABLE, over: OVER }, actedAt: T0 })).toBeNull();
  });
});
