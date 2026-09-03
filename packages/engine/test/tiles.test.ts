import { describe, expect, it } from 'vitest';
import { FULL_SET, buildTileSet, createRng, shuffle, sortTiles, tileName } from '../src/index';

describe('tiles', () => {
  it('builds a full 144 tile set', () => {
    const set = buildTileSet(FULL_SET);
    expect(set).toHaveLength(144);
    expect(new Set(set.map((t) => t.id)).size).toBe(144);
  });
  it('builds a 136 tile set without bonus tiles', () => {
    expect(buildTileSet({ ...FULL_SET, flowers: false, seasons: false })).toHaveLength(136);
  });
  it('sorts canonically', () => {
    expect(sortTiles(['DR', 's1', 'WE', 'm9', 'F1', 'm1'])).toEqual(['m1', 'm9', 's1', 'WE', 'DR', 'F1']);
  });
  it('names tiles', () => {
    expect(tileName('s3')).toBe('3 Bamboo');
    expect(tileName('WN')).toBe('North Wind');
  });
  it('shuffles deterministically from a seed', () => {
    const a = shuffle([1, 2, 3, 4, 5, 6, 7, 8], createRng('seed'));
    const b = shuffle([1, 2, 3, 4, 5, 6, 7, 8], createRng('seed'));
    const c = shuffle([1, 2, 3, 4, 5, 6, 7, 8], createRng('other'));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});
