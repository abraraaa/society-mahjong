import { describe, expect, it } from 'vitest';
import { generateRoomCode } from './room-code';

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

describe('generateRoomCode', () => {
  it('is the prefix, a dash and five characters from the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) expect(generateRoomCode()).toMatch(/^KHI-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/);
    expect(generateRoomCode('LHR')).toMatch(/^LHR-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/);
  });

  it('never uses 0, O, 1 or I, which are read wrong over the phone', () => {
    const codes = Array.from({ length: 1000 }, () => generateRoomCode().slice(4)).join('');
    expect(codes).not.toMatch(/[0O1I]/);
    expect(codes).toHaveLength(5000);
  });

  it('draws every symbol of the alphabet, so no code is out of reach', () => {
    const seen = new Set(Array.from({ length: 3200 }, () => generateRoomCode().slice(4)).join(''));
    expect([...seen].sort().join('')).toBe(ALPHABET);
  });

  it('a thousand draws are distinct, bar the odd clash 2^25 codes allow', () => {
    // The chance of one clash in a thousand draws is about 1.5%; of three, under one in a million.
    const codes = new Set(Array.from({ length: 1000 }, () => generateRoomCode()));
    expect(codes.size).toBeGreaterThanOrEqual(998);
  });
});
