import { GLOSSARY, termsIn, type Term } from './glossary';
import type { CoachGoal, CoachHandRef, CoachMoment, CoachSegment, CoachState, CoachTeach } from './types';
import { NOTE_BUDGET, textOf, visibleLength } from './words';

/**
 * First-sight teaching. The first time this visit that a round, a hand, a rule
 * or a word comes up, one short footnote explains it, under whichever line
 * first says it: the tutor's bubble, or the line in the claim, exchange or
 * result sheet. After that it isn't explained again, and a hand's name is one
 * tap from its card.
 *
 * The coach says what a view could teach (`CoachState.teach`); `lessonFor`
 * picks what to show, given what this visit has already been taught. Nothing
 * here knows the table: it's handed the tutor's state and a set of keys.
 */

/** sessionStorage: this visit's footnotes, a JSON array of keys. Per tab, so a new tab or a new day teaches again. */
export const TAUGHT_KEY = 'sm:taught';

/** Visible characters over all the notes under one line: two lines at 375 px. It lives in words.ts, beside the bubble's budget, where the run tile's footnote is fitted to it. */
export { NOTE_BUDGET };

export interface Lesson {
  /** `lessonKey` of the tutor's state it was worked out for: a lesson is only drawn for that state */
  readonly key: string;
  /** bubble: under the tutor's bubble. sheet: under the line in the claim, exchange or result sheet, which covers the bubble */
  readonly where: 'bubble' | 'sheet';
  readonly notes: readonly CoachTeach[];
  /** the keys this lesson teaches: its notes and what they cover, and what the line itself already says */
  readonly marks: readonly string[];
}

/** Where the tutor's words are read at this moment: a sheet covers the bubble at a claim, the exchange and the end of a hand. */
export function lessonWhere(moment: CoachMoment): Lesson['where'] {
  return moment === 'claim' || moment === 'exchange' || moment === 'handEnd' ? 'sheet' : 'bubble';
}

/** One per view and line: the same view seen again (a poll, a retry) has the same key, and so the same notes. */
export function lessonKey(coach: CoachState): string {
  return `${coach.at.hand}.${coach.at.seq}|${coach.moment}|${textOf(coach.say)}|${coach.teach.map((t) => t.key).join(',')}`;
}

/**
 * The line a lesson goes under, whichever view it's on: the hand, the moment,
 * whether the tutor is asking for a move or waiting, its words, and what they
 * could teach. A non-dealer's hand-start bubble stays the same line through
 * the dealer's discard and every move after it, until their own turn. The same
 * words asking for a move are a new line.
 */
export function lineKey(coach: CoachState): string {
  return `${coach.at.hand}|${coach.moment}|${coach.action.kind}|${textOf(coach.say)}|${coach.teach.map((t) => `${t.key}:${t.place}`).join(',')}`;
}

/** A note as the reader sees it, which is what the budget counts: "label: text", or the text alone. */
export function noteText(note: Pick<CoachTeach, 'label' | 'text'>): string {
  return note.label ? `${note.label}: ${note.text}` : note.text;
}

/** The words of a line a word's footnote can be about: never inside a hand's name, which is a word of its own. */
export function plainText(say: readonly CoachSegment[]): string {
  return say
    .filter((s) => !s.hand)
    .map((s) => s.text)
    .join('');
}

/**
 * A named hand's footnote: its name, tappable, and its shape. The round's only
 * everyday hand (Goulash, Any Damn Hand) says what the round's own footnote
 * says, so the one teaches the other.
 */
export function handNote(ref: CoachHandRef, goal: Pick<CoachGoal, 'generalTitles' | 'handKind'>): CoachTeach {
  const only = goal.generalTitles.length === 1 && goal.generalTitles[0] === ref.title;
  return { key: `hand:${ref.title}`, place: 'note', label: ref.title, hand: ref, text: ref.note, ...(only ? { also: [`round:${goal.handKind}`] } : {}) };
}

/** A glossary word's footnote, as the bubble has always given it: the word in lower case, and its one-line meaning. */
export function termNote(term: Term): CoachTeach {
  return { key: `term:${term}`, place: 'note', label: GLOSSARY[term].label.toLowerCase(), text: GLOSSARY[term].short };
}

/** Every key a teaching covers: its own and the ones taught with it. */
function keysOf(t: CoachTeach): string[] {
  return [t.key, ...(t.also ?? [])];
}

/**
 * What could go under the line, in the order it's offered. Under the bubble:
 * the coach's own notes (the round, then rules), the hands the bubble names in
 * the order it names them, the plan's hand while the plan is shown, and for a
 * first-timer the glossary words it uses. Under a sheet's line, only the hands
 * it names: the claim sheet explains Pung, Kong and Pass itself.
 */
function candidates(coach: CoachState, where: Lesson['where']): CoachTeach[] {
  const names = coach.say.flatMap((s) => (s.hand ? [handNote(s.hand, coach.goal)] : []));
  if (where === 'sheet') return names;
  const plan = coach.plan !== null && coach.target ? [handNote(coach.target.hand, coach.goal)] : [];
  const terms = coach.stage === 'new' || coach.stage === 'first_hand' ? termsIn(plainText(coach.say)).map(termNote) : [];
  return [...coach.teach.filter((t) => t.place === 'note'), ...names, ...plan, ...terms];
}

/**
 * The footnotes for this state, given what this visit has been taught.
 *
 * - None for a regular (`solid`), and none when the tutor has nothing to say.
 * - What the line already says counts as taught: a `said` teaching, and what
 *   it covers, is never a note, and is marked taught all the same.
 * - One note while learning, two for a first-timer. The first always shows; a
 *   second is the next that still fits `NOTE_BUDGET` beside it.
 * - Each note chosen, with what it covers, is taught before the next is
 *   looked at, so the round's note keeps its hand's note off the same line.
 */
export function lessonFor(coach: CoachState, taught: ReadonlySet<string>): Lesson {
  const key = lessonKey(coach);
  const where = lessonWhere(coach.moment);
  if (coach.stage === 'solid') return { key, where, notes: [], marks: [] };
  const said = coach.teach.filter((t) => t.place === 'said').flatMap(keysOf);
  const excluded = new Set([...taught, ...said]);
  const notes: CoachTeach[] = [];
  if (coach.say.length > 0) {
    const cap = coach.stage === 'learning' ? 1 : 2;
    for (const c of candidates(coach, where)) {
      if (notes.length >= cap) break;
      if (excluded.has(c.key) || c.text === '') continue;
      if (notes.length > 0 && visibleLength([...notes, c].map(noteText).join(' · ')) > NOTE_BUDGET) continue;
      notes.push(c);
      for (const k of keysOf(c)) excluded.add(k);
    }
  }
  return { key, where, notes, marks: [...new Set([...notes.flatMap(keysOf), ...said])] };
}

/** What this visit has been taught. */
export interface TaughtStore {
  all(): ReadonlySet<string>;
  add(keys: readonly string[]): void;
}

/** Lessons remembered by view, so a view seen again (StrictMode, a poll, a retry) gets the notes it got the first time. */
export const LESSONS_KEPT = 50;

/** The table's lessons, one view after another. */
export interface Lessons {
  /** The lesson for this state. `fromNothing`: a new line gets the notes a first visit would (the render that hydrates the server's HTML). */
  next(coach: CoachState, fromNothing?: boolean): Lesson;
  /** Nothing's on screen any more (the tutor's off): the next line is worked out afresh. */
  clear(): void;
}

/**
 * Works out each view's lesson once, as the table sees the views:
 *
 * - The same view again gets the lesson it got the first time.
 * - The same line on a new view (`lineKey`) keeps the lesson on screen, and
 *   teaches nothing more. A note comes with a new line and stays with it: it
 *   never goes, or turns into another, while the others move and the words
 *   under it stay put.
 * - Anything else is worked out from what this visit has been taught, and
 *   marked taught.
 */
export function createLessons(store: () => TaughtStore, kept = LESSONS_KEPT): Lessons {
  const byView = new Map<string, Lesson>();
  let shown: { readonly line: string; readonly lesson: Lesson } | null = null;
  return {
    next(coach, fromNothing = false) {
      const key = lessonKey(coach);
      const line = lineKey(coach);
      let lesson = byView.get(key);
      if (!lesson) {
        if (shown?.line === line) lesson = { ...shown.lesson, key };
        else {
          lesson = lessonFor(coach, fromNothing ? new Set() : store().all());
          store().add(lesson.marks);
        }
        if (byView.size >= kept) byView.delete(byView.keys().next().value!);
        byView.set(key, lesson);
      }
      shown = { line, lesson };
      return lesson;
    },
    clear() {
      shown = null;
    },
  };
}

/**
 * A JSON array of keys in `storage`, every read and write in try/catch. A set
 * in memory always holds the truth for this page, so a storage that throws (a
 * private window, blocked site data) still teaches each thing once per page.
 */
export function createTaughtStore(storage: Pick<Storage, 'getItem' | 'setItem'> | null): TaughtStore {
  const memory = new Set<string>();
  const stored = (): string[] => {
    try {
      const parsed: unknown = JSON.parse(storage?.getItem(TAUGHT_KEY) ?? '[]');
      return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
    } catch {
      return [];
    }
  };
  return {
    all() {
      for (const k of stored()) memory.add(k);
      return new Set(memory);
    },
    add(keys) {
      if (keys.length === 0) return;
      for (const k of [...stored(), ...keys]) memory.add(k);
      try {
        storage?.setItem(TAUGHT_KEY, JSON.stringify([...memory]));
      } catch {
        // The memory set keeps it for this page.
      }
    },
  };
}

let shared: TaughtStore | null = null;

/** This tab's store. On the server there's no visit to remember, so each call gets an empty one, shared with nobody. */
export function taughtStore(): TaughtStore {
  if (typeof window === 'undefined') return createTaughtStore(null);
  if (!shared) {
    let storage: Storage | null = null;
    try {
      storage = window.sessionStorage;
    } catch {
      storage = null;
    }
    shared = createTaughtStore(storage);
  }
  return shared;
}
