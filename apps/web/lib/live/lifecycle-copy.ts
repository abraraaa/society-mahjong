import type { Seat } from '@society/engine';
// Relative rather than '@/': vitest runs without the path alias, and the tests load this.
import { signed } from '../ledger';
import type { Standing } from './final';
import type { NextHandWait, PublicGameOver } from './lifecycle';
import { countOf, isolate, nameList } from './words';

/**
 * What the table says about a game's life: how it ended, who came out on
 * top, and the host's sheets for ending it. Every string a player reads about
 * that lives here, word for word, so the tests can hold each one to the copy.
 * Pure, and safe to load in the browser.
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

/**
 * The host's "are you sure?" before ending the game for everyone. From the
 * result sheet (`midHand` false) every hand so far has counted; mid-hand the
 * one being played won't. `hands` is how many have finished.
 */
export function endSheet(midHand: boolean, hands: number): { title: string; body: string; confirmLabel: string; cancelLabel: string } {
  const counted = countOf(hands, 'hand');
  const body = !midHand
    ? `Everyone will see the final scores from the ${counted} you've played.`
    : hands === 0
      ? 'No hands have finished yet, so nobody has any points.'
      : `This hand won't count. Everyone will see the final scores from the ${counted} you've finished.`;
  return { title: midHand ? 'End the game now?' : 'End the game here?', body, confirmLabel: 'End the game', cancelLabel: 'Keep playing' };
}

/** Time left as the table's clocks show it, whole seconds rounded up: '0:14', '1:05'. Nothing left, or less, is '0:00'. */
export function countdown(ms: number): string {
  const s = Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 1000)) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The result sheet's Next hand button and the line under it, while the table
 * waits for everyone here to tap it (R15). `me` is the reader's seat, `names`
 * who sits where, and `msLeft` how long until the next hand starts regardless
 * (null when nobody has tapped yet, so nothing has set a start). Once the
 * reader has tapped, the button says who it's waiting for and can't be
 * tapped again (`ready`). The line appears only while a start time is set.
 */
export function waitCopy(wait: NextHandWait, me: Seat, names: Readonly<Record<Seat, string>>, msLeft: number | null): { button: string; line: string | null; ready: boolean } {
  const listOf = (seats: readonly Seat[]) => nameList(seats.filter((s) => s !== me).map((s) => isolate(names[s])));
  const tapped = wait.ready.includes(me);
  const others = wait.waiting.filter((s) => s !== me);
  const button = tapped && others.length > 0 ? `Waiting for ${listOf(others)}` : 'Next hand';
  if (wait.startsAt === null || msLeft === null) return { button, line: null, ready: tapped };
  const starts = `The next hand starts in ${countdown(msLeft)}, or as soon as`;
  const ready = wait.ready.filter((s) => s !== me);
  // Whoever tapped first may have gone since: with nobody here ready to name, it's the plain line.
  if (tapped || ready.length === 0) return { button, line: `${starts} everyone's ready.`, ready: tapped };
  const who = `${listOf(ready)}${ready.length === 1 ? "'s" : ' are'} ready.`;
  return { button, line: `${who} ${starts} ${others.length === 0 ? 'you tap' : "everyone's ready"}.`, ready: false };
}

/** The host's Leave sheet, while the game is in play: leave (a bot takes the seat), end the game for everyone, or stay. */
export const HOST_LEAVE = {
  title: 'Leave the table?',
  body: "A bot will play your seat so the others can carry on, and someone still here can start the next game. Or, if everyone's done, end the game for the whole table.",
  leave: 'Leave',
  end: 'End the game for everyone',
  stay: 'Stay',
} as const satisfies { title: string; body: string; leave: string; end: string; stay: string };
