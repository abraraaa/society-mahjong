import { describe, expect, it } from 'vitest';
import { NAME_MAX, seatName } from './name-gate';

describe('seatName', () => {
  it('trims the name', () => {
    expect(seatName('  Abrar ')).toBe('Abrar');
  });

  it('has nothing to send for an empty or blank box', () => {
    expect(seatName('')).toBe('');
    expect(seatName('   ')).toBe('');
  });

  it('cuts a long name to fit the table', () => {
    expect(seatName('x'.repeat(40))).toHaveLength(NAME_MAX);
  });
});
