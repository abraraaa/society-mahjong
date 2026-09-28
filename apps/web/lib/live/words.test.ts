import { describe, expect, it } from 'vitest';
import { countOf, isolate, nameList, numberWord, timesOf } from './words';

describe('numberWord', () => {
  it('writes one to nine as words, and anything else in digits', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(numberWord)).toEqual(['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']);
    expect(numberWord(10)).toBe('10');
    expect(numberWord(16)).toBe('16');
    expect(numberWord(0)).toBe('0');
    expect(numberWord(1.5)).toBe('1.5');
  });
});

describe('countOf', () => {
  it('counts one thing in the singular and the rest in the plural', () => {
    expect(countOf(1, 'hand')).toBe('one hand');
    expect(countOf(2, 'hand')).toBe('two hands');
    expect(countOf(9, 'bot')).toBe('nine bots');
    expect(countOf(10, 'hand')).toBe('10 hands');
    expect(countOf(16, 'hand')).toBe('16 hands');
    expect(countOf(1, 'turn')).toBe('one turn');
    expect(countOf(3, 'set')).toBe('three sets');
  });
});

describe('timesOf', () => {
  it('says how many times the way a sentence does: once, twice, then a word to nine, then digits', () => {
    expect([1, 2, 3, 9].map(timesOf)).toEqual(['once', 'twice', 'three times', 'nine times']);
    expect(timesOf(10)).toBe('10 times');
    expect(timesOf(12)).toBe('12 times');
  });
});

describe('nameList', () => {
  it('joins names the way a sentence does', () => {
    expect(nameList([])).toBe('');
    expect(nameList(['A'])).toBe('A');
    expect(nameList(['A', 'B'])).toBe('A and B');
    expect(nameList(['A', 'B', 'C'])).toBe('A, B and C');
    expect(nameList(['A', 'B', 'C', 'D'])).toBe('A, B, C and D');
  });
});

describe('isolate', () => {
  it('wraps a name so a right-to-left one can’t reorder the words around it', () => {
    expect(isolate('Amna')).toBe('⁨Amna⁩');
    expect(isolate(undefined)).toBe('⁨⁩');
  });
});
