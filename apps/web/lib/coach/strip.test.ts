import { describe, expect, it } from 'vitest';
import type { LayoutGroup } from '@society/engine';
import { heldOf, stripGroups } from './strip';

const g = (shape: LayoutGroup['shape'], tiles: string, held = '', extra: Partial<LayoutGroup> = {}): LayoutGroup => ({
  shape,
  exposed: false,
  open: false,
  ...extra,
  tiles: tiles.split(' ').map((kind, i) => ({ kind: kind as never, held: held[i] === '1' })),
});

describe('the plan strip’s lay-out', () => {
  it('puts sets laid face up first, then sets in suit order, the honours, then the pair', () => {
    const out = stripGroups([g('pair', 'DR DR'), g('honours', 'WE WS WW WN'), g('pung', 'p3 p3 p3'), g('run', 'm1 m2 m3'), g('pung', 's5 s5 s5', '111', { exposed: true })]);
    expect(out.map((x) => x.tiles.map((t) => t.kind).join(' '))).toEqual(['s5 s5 s5', 'm1 m2 m3', 'p3 p3 p3', 'WE WS WW WN', 'DR DR']);
    expect(out[0]!.exposed).toBe(true);
  });

  it('reads all four winds with one paired as five together', () => {
    const out = stripGroups([g('honours', 'WE WS WW WN', '1111'), g('singles', 'WN', '0')]);
    expect(out).toHaveLength(1);
    expect(out[0]!.tiles.map((t) => t.kind)).toEqual(['WE', 'WS', 'WW', 'WN', 'WN']);
  });

  it("lays Khalida's 1 to 9 out as one row in number order", () => {
    const loose = ['m9', 'p1', 's5', 'm2', 'p3', 's4', 'm6', 'p7', 's8'].map((k) => g('singles', k));
    const out = stripGroups([...loose, g('honours', 'WE WS WW WN')]);
    expect(out[0]!.tiles.map((t) => t.kind)).toEqual(['p1', 'm2', 'p3', 's4', 's5', 'm6', 'p7', 's8', 'm9']);
  });

  it('counts held tiles and tiles in all', () => {
    expect(heldOf(stripGroups([g('pung', 'p3 p3 p3', '110'), g('pair', 'DR DR', '10')]))).toEqual({ held: 3, total: 5 });
  });
});
