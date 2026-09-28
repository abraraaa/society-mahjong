import { describe, expect, it } from 'vitest';
import { finalStandings } from './final';
import { endLine, topLine } from './lifecycle-copy';
import type { PublicGameOver } from './lifecycle';

/**
 * The lifecycle copy, word for word. Names are wrapped in isolates (U+2068
 * and U+2069) so a right-to-left name can't reorder the sentence around it.
 */
const I = (name: string) => `⁨${name}⁩`;

/** Amna, Bilal (people), Sana and Omar (bots), with these totals. */
const table = (scores: readonly number[]) =>
  finalStandings(
    [
      { name: 'Amna', bot: false },
      { name: 'Bilal', bot: false },
      { name: 'Sana', bot: true },
      { name: 'Omar', bot: true },
    ],
    scores,
  );

const BILAL_TOP = table([2000, 14504, -8000, -8504]);
const AMNA_TOP = table([14504, 2000, -8000, -8504]);
const SANA_TOP = table([2000, -8504, 14504, -8000]);
const NOBODY = table([0, 0, 0, 0]);
const AMNA_AND_BILAL = table([6000, 6000, -4000, -8000]);
const THREE_TIE = table([4000, 4000, 4000, -12000]);

describe('topLine', () => {
  it('on the final table ("now")', () => {
    expect(topLine(NOBODY, 0, 'now')).toBe('Nobody won a hand, so everyone finishes on 0.');
    expect(topLine(AMNA_TOP, 0, 'now')).toBe('You finish top on +14,504.');
    expect(topLine(BILAL_TOP, 0, 'now')).toBe(`${I('Bilal')} finishes top on +14,504.`);
    expect(topLine(SANA_TOP, 0, 'now')).toBe(`${I('Sana')}, a bot, finishes top on +14,504.`);
    expect(topLine(AMNA_AND_BILAL, 2, 'now')).toBe(`${I('Amna')} and ${I('Bilal')} tie for top on +6,000.`);
  });

  it('puts "You" first in a tie the reader is in, whatever their seat', () => {
    expect(topLine(AMNA_AND_BILAL, 0, 'now')).toBe(`You and ${I('Bilal')} tie for top on +6,000.`);
    expect(topLine(AMNA_AND_BILAL, 1, 'now')).toBe(`You and ${I('Amna')} tie for top on +6,000.`);
    expect(topLine(THREE_TIE, 2, 'now')).toBe(`You, ${I('Amna')} and ${I('Bilal')} tie for top on +4,000.`);
  });

  it('for a game that’s over ("then")', () => {
    expect(topLine(NOBODY, 0, 'then')).toBe('Nobody won a hand.');
    expect(topLine(AMNA_TOP, 0, 'then')).toBe('You finished top on +14,504.');
    expect(topLine(BILAL_TOP, 0, 'then')).toBe(`${I('Bilal')} finished top on +14,504.`);
    expect(topLine(SANA_TOP, null, 'then')).toBe(`${I('Sana')}, a bot, finished top on +14,504.`);
    expect(topLine(AMNA_AND_BILAL, 3, 'then')).toBe(`${I('Amna')} and ${I('Bilal')} tied for top on +6,000.`);
    expect(topLine(AMNA_AND_BILAL, 1, 'then')).toBe(`You and ${I('Amna')} tied for top on +6,000.`);
  });

  it('calls someone watching by name, never "You"', () => {
    expect(topLine(AMNA_TOP, null, 'now')).toBe(`${I('Amna')} finishes top on +14,504.`);
  });
});

describe('endLine', () => {
  const ended = (how: PublicGameOver['how'], hands: number, byName: string | null = null, byMe = false): PublicGameOver => ({ how, hands, byName, byMe });
  const top = `${I('Bilal')} finishes top on +14,504.`;

  it('after the last hand', () => {
    expect(endLine(null, BILAL_TOP, 0)).toBe(`That's the game. ${top}`);
    expect(endLine(ended('complete', 16), BILAL_TOP, 0)).toBe(`That's the game. ${top}`);
    expect(endLine(ended('complete', 16), AMNA_TOP, 0)).toBe(`That's the game. You finish top on +14,504.`);
    expect(endLine(null, NOBODY, 0)).toBe(`That's the game. Nobody won a hand, so everyone finishes on 0.`);
  });

  it('ended by the reader', () => {
    expect(endLine(ended('host', 2, 'Amna', true), BILAL_TOP, 0)).toBe(`You ended the game after two hands. ${top}`);
    expect(endLine(ended('host', 1, 'Amna', true), BILAL_TOP, 0)).toBe(`You ended the game after one hand. ${top}`);
    expect(endLine(ended('host', 12, 'Amna', true), BILAL_TOP, 0)).toBe(`You ended the game after 12 hands. ${top}`);
    expect(endLine(ended('host', 0, 'Amna', true), NOBODY, 0)).toBe('You ended the game before any hands finished.');
  });

  it('ended by someone else, or by a host whose name isn’t known', () => {
    expect(endLine(ended('host', 2, 'Bilal'), BILAL_TOP, 0)).toBe(`${I('Bilal')} ended the game after two hands. ${top}`);
    expect(endLine(ended('host', 2, 'Amna'), BILAL_TOP, 1)).toBe(`${I('Amna')} ended the game after two hands. You finish top on +14,504.`);
    expect(endLine(ended('host', 0, 'Amna'), NOBODY, 1)).toBe(`${I('Amna')} ended the game before any hands finished.`);
    expect(endLine(ended('host', 7), BILAL_TOP, 0)).toBe(`The host ended the game after seven hands. ${top}`);
    expect(endLine(ended('host', 0), NOBODY, 0)).toBe('The host ended the game before any hands finished.');
  });

  it('ended because nobody was playing', () => {
    expect(endLine(ended('idle', 5), BILAL_TOP, 0)).toBe(`This game ended after five hands, because nobody had played for a while. ${top}`);
    expect(endLine(ended('idle', 1), BILAL_TOP, 0)).toBe(`This game ended after one hand, because nobody had played for a while. ${top}`);
    expect(endLine(ended('idle', 0), NOBODY, 0)).toBe('This game ended before any hands finished, because nobody had played for a while.');
  });
});
