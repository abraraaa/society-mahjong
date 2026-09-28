import { describe, expect, it } from 'vitest';
import { NEW_TABLE, TABLE_STATE_V, lastActed, parseTableState, sameTableState, tableStateJson, wakeAt, withLegacyScores, type TableState } from './table-state';

const T0 = 1_700_000_000_000;

describe('parseTableState', () => {
  it('reads 0005’s default, and anything that isn’t a document, as a legacy table with no scores of its own', () => {
    for (const x of [{}, null, undefined, 0, 'v1', [], [1, 2, 3, 4], true]) {
      expect(parseTableState(x), JSON.stringify(x)).toEqual({ table: { v: TABLE_STATE_V, scores: null, extra: {} }, legacy: true });
    }
  });

  it('treats a "v" it can’t read as no "v" at all', () => {
    for (const v of ['1', 0, -1, 1.5, null, true]) expect(parseTableState({ v, scores: [1, 2, 3, 4] }).legacy, String(v)).toBe(true);
  });

  it('reads a v1 table’s scores', () => {
    expect(parseTableState({ v: 1, scores: [0, 14504, -8000, -6504] })).toEqual({ table: { v: 1, scores: [0, 14504, -8000, -6504], extra: {} }, legacy: false });
  });

  it('gives a table whose scores are missing or wrong nobody any points, rather than failing', () => {
    for (const scores of [undefined, null, [1, 2, 3], [1, 2, 3, 4, 5], ['1', 2, 3, 4], [1, null, 3, 4], 'none', { 0: 1 }]) {
      expect(parseTableState({ v: 1, scores }).table.scores, JSON.stringify(scores)).toEqual([0, 0, 0, 0]);
    }
  });

  it('reads a newer deploy’s table as given, parts and all, so the service can see it isn’t its own', () => {
    const { table, legacy } = parseTableState({ v: 2, scores: [5, -5, 0, 0], ready: { hand: 3 } });
    expect(legacy).toBe(false);
    expect(table).toEqual({ v: 2, scores: [5, -5, 0, 0], extra: { ready: { hand: 3 } } });
  });
});

describe('tableStateJson', () => {
  it('writes v1 with the scores', () => {
    expect(tableStateJson(NEW_TABLE)).toEqual({ v: 1, scores: [0, 0, 0, 0] });
    expect(tableStateJson({ v: 1, scores: [3, -3, 0, 0], extra: {} })).toEqual({ v: 1, scores: [3, -3, 0, 0] });
  });

  it('puts back the keys it doesn’t know, untouched, so an older deploy never erases a newer one’s bookkeeping', () => {
    const stored = { v: 1, scores: [1, -1, 0, 0], over: { how: 'host', at: T0 }, absence: [{ userId: 'u-a', misses: 1 }], later: [1, { deep: true }] };
    const back = tableStateJson(parseTableState(stored).table);
    expect(back).toEqual(stored);
    // And it survives the database's round trip.
    expect(parseTableState(JSON.parse(JSON.stringify(back)))).toEqual(parseTableState(stored));
  });

  it('writes a legacy table with its seeded scores as a v1 table', () => {
    const { table } = parseTableState({ note: 'kept' });
    const written = tableStateJson(withLegacyScores(table, [7, -7, 0, 0]));
    expect(written).toEqual({ note: 'kept', v: 1, scores: [7, -7, 0, 0] });
    expect(parseTableState(written)).toEqual({ table: { v: 1, scores: [7, -7, 0, 0], extra: { note: 'kept' } }, legacy: false });
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
    const own: TableState = { v: 1, scores: [9, -9, 0, 0], extra: {} };
    expect(withLegacyScores(own, [1, 1, 1, 1])).toBe(own);
  });
});

describe('sameTableState', () => {
  it('compares what the tables hold, not which objects they are', () => {
    const a = parseTableState({ v: 1, scores: [1, -1, 0, 0], over: { how: 'host', by: null } }).table;
    const b = parseTableState({ over: { by: null, how: 'host' }, scores: [1, -1, 0, 0], v: 1 }).table;
    expect(sameTableState(a, b)).toBe(true);
    expect(sameTableState(a, { ...a, scores: [1, -1, 0, 1] })).toBe(false);
    expect(sameTableState(a, { ...a, v: 2 })).toBe(false);
    expect(sameTableState(a, { ...a, extra: { over: { how: 'idle', by: null } } })).toBe(false);
    expect(sameTableState(a, { ...a, extra: {} })).toBe(false);
    expect(sameTableState(NEW_TABLE, { ...NEW_TABLE, scores: null })).toBe(false);
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

  it('is null when nothing is waiting on anyone', () => {
    expect(at(null, null)).toBeNull();
  });
});
