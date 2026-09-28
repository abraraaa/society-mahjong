import type { Seat } from '@society/engine';
// Relative rather than '@/': vitest runs without the path alias, and the tests load this.
import { signed } from '../ledger';
import type { Standing } from './final';
import type { PublicGameOver } from './lifecycle';
import { countOf, isolate, nameList } from './words';

/**
 * What the table says about a game's life: how it ended and who came out on
 * top. Every string a player reads about that lives here, word for word, so
 * the tests can hold each one to the copy. Pure, and safe to load in the
 * browser.
 */

/**
 * Who finished top, as a sentence: `'now'` on the final table ("Bilal
 * finishes top on +14,504."), `'then'` for a game that's over ("Bilal
 * finished top on +14,504."). `me` is the reader's seat, which is "You"
 * whatever the seat's name; in a tie "You" comes first. `st` is ranked, as
 * finalStandings gives it.
 */
export function topLine(st: readonly Standing[], me: Seat | null, tense: 'now' | 'then'): string {
  const now = tense === 'now';
  if (st.every((s) => s.score === 0)) return now ? 'Nobody won a hand, so everyone finishes on 0.' : 'Nobody won a hand.';
  const top = st.filter((s) => s.rank === 1);
  const score = signed(top[0]!.score);
  if (top.length === 1) {
    const t = top[0]!;
    if (t.seat === me) return `You ${now ? 'finish' : 'finished'} top on ${score}.`;
    return `${isolate(t.name)}${t.bot ? ', a bot,' : ''} ${now ? 'finishes' : 'finished'} top on ${score}.`;
  }
  const names = [...top.filter((s) => s.seat === me).map(() => 'You'), ...top.filter((s) => s.seat !== me).map((s) => isolate(s.name))];
  return `${nameList(names)} ${now ? 'tie' : 'tied'} for top on ${score}.`;
}

/**
 * The line under the final scores: how the game ended, then who finished
 * top. A game that ended before any hand finished has no top to speak of, so
 * it gets the first sentence only. `over` null is a game whose last hand was
 * scored, as is a game that finished before its end was recorded.
 */
export function endLine(over: PublicGameOver | null, st: readonly Standing[], me: Seat | null): string {
  const top = topLine(st, me, 'now');
  if (over === null || over.how === 'complete') return `That's the game. ${top}`;
  const after = countOf(over.hands, 'hand');
  if (over.how === 'host') {
    const who = over.byMe ? 'You' : over.byName !== null ? isolate(over.byName) : 'The host';
    return over.hands === 0 ? `${who} ended the game before any hands finished.` : `${who} ended the game after ${after}. ${top}`;
  }
  if (over.how === 'idle') {
    return over.hands === 0
      ? 'This game ended before any hands finished, because nobody had played for a while.'
      : `This game ended after ${after}, because nobody had played for a while. ${top}`;
  }
  // Abandoned: everyone left, and the page says the table has closed rather than showing a final table.
  return top;
}
