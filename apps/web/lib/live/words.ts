/**
 * Small pieces of the table's sentences, so every line says a count, a name
 * or a list the same way. Pure, and safe to load in the browser.
 */

/** A player's name inside a sentence, isolated so a right-to-left name can't reorder the words around it (as table.tsx does). */
export const isolate = (name: string | undefined): string => `⁨${name ?? ''}⁩`;

const WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/** A count inside a sentence: a word from one to nine, digits otherwise. */
export function numberWord(n: number): string {
  return Number.isInteger(n) && n >= 1 && n <= 9 ? WORDS[n - 1]! : String(n);
}

/** "one hand", "two hands", "10 hands". */
export function countOf(n: number, noun: 'hand' | 'bot' | 'turn' | 'set'): string {
  return `${numberWord(n)} ${noun}${n === 1 ? '' : 's'}`;
}

/** "A", "A and B", "A, B and C". */
export function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)!}`;
}
