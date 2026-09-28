import { describe, expect, it } from 'vitest';
import { SEATS, karachi, startHand, viewFor, type HandState, type PrivatePlayerView, type Seat } from '@society/engine';
import { analyseFor } from './coach';
import { ROUNDS, coachOf, playHand } from './test-games';
import { NOTE_BUDGET, TAUGHT_KEY, createLessons, createTaughtStore, handNote, lessonFor, lessonKey, lessonWhere, lineKey, noteText, type Lesson, type TaughtStore } from './teach';
import type { CoachAction, CoachHandRef, CoachMoment, CoachSegment, CoachStage, CoachState, CoachTeach } from './types';
import { textOf, visibleLength } from './words';

const NOTHING: ReadonlySet<string> = new Set();

/** A hand the tutor can name, with a footnote of `note`. */
const hand = (title: string, note = 'a short shape'): CoachHandRef => ({ patternId: `test.${title}`, title, shape: note, whose: 'example', layout: [], note });
const named = (ref: CoachHandRef): CoachSegment => ({ text: ref.title, hand: ref });

/** Enough of the tutor's state for `lessonFor`: what it says, what it could teach, and where. */
function state(over: {
  say?: readonly CoachSegment[];
  teach?: readonly CoachTeach[];
  moment?: CoachMoment;
  stage?: CoachStage;
  plan?: CoachHandRef | null;
  goal?: { generalTitles: readonly string[]; handKind: string };
  action?: CoachAction;
  hand?: number;
  seq?: number;
}): CoachState {
  const plan = over.plan ?? null;
  return {
    moment: over.moment ?? 'turn',
    stage: over.stage ?? 'new',
    goal: over.goal ?? { generalTitles: [], handKind: 'big' },
    target: plan ? { hand: plan, title: plan.title } : null,
    runnerUp: null,
    action: over.action ?? { kind: 'wait' },
    plan: plan ? `${plan.title} · 3 tiles to go` : null,
    // No glossary word in it ("Discard" and "Dots" are both words a first-timer gets a footnote for).
    say: over.say ?? [{ text: 'Let it go', action: true }, { text: '.' }],
    reason: null,
    highlight: [],
    outcome: null,
    teach: over.teach ?? [],
    at: { hand: over.hand ?? 0, seq: over.seq ?? 1 },
  } as unknown as CoachState;
}

const note = (key: string, text = 'a short line'): CoachTeach => ({ key, place: 'note', label: key, text });
const said = (key: string, also: string[] = []): CoachTeach => ({ key, place: 'said', text: '', also });
const keys = (l: Lesson) => l.notes.map((n) => n.key);
const joined = (l: Lesson) => l.notes.map(noteText).join(' · ');

describe('how many notes, and how long', () => {
  const four = { teach: [note('round:a'), note('rule:b'), note('rule:c'), note('rule:d')] };

  it('shows one note to a learner, two to a first-timer', () => {
    expect(keys(lessonFor(state({ ...four, stage: 'learning' }), NOTHING))).toEqual(['round:a']);
    expect(keys(lessonFor(state({ ...four, stage: 'new' }), NOTHING))).toEqual(['round:a', 'rule:b']);
    expect(keys(lessonFor(state({ ...four, stage: 'first_hand' }), NOTHING))).toEqual(['round:a', 'rule:b']);
  });

  it("keeps two notes within the budget, taking a later one that fits when the next doesn't", () => {
    const long = 'x'.repeat(50);
    const l = lessonFor(state({ teach: [note('round:a', long), note('rule:b', long), note('rule:c')] }), NOTHING);
    expect(keys(l)).toEqual(['round:a', 'rule:c']);
    expect(visibleLength(joined(l))).toBeLessThanOrEqual(NOTE_BUDGET);
  });

  it('always shows the first', () => {
    const l = lessonFor(state({ teach: [note('round:a', 'x'.repeat(90)), note('rule:b')] }), NOTHING);
    expect(keys(l)).toEqual(['round:a']);
  });

  it('shows none to a regular, and none when the tutor says nothing, but still marks what the line says', () => {
    const teach = [note('round:a'), said('hand:X', ['round:y'])];
    const solid = lessonFor(state({ teach, stage: 'solid' }), NOTHING);
    expect(solid.notes).toEqual([]);
    expect(solid.marks).toEqual([]);
    const quiet = lessonFor(state({ teach, say: [] }), NOTHING);
    expect(quiet.notes).toEqual([]);
    expect(quiet.marks).toEqual(['hand:X', 'round:y']);
  });

  it('never repeats what this visit has been taught', () => {
    expect(keys(lessonFor(state({ teach: [note('round:a'), note('rule:b'), note('rule:c')] }), new Set(['round:a'])))).toEqual(['rule:b', 'rule:c']);
  });
});

describe('where the notes go', () => {
  it('under a sheet at a claim, the exchange and the end of a hand, and under the bubble otherwise', () => {
    expect((['claim', 'exchange', 'handEnd'] as const).map(lessonWhere)).toEqual(['sheet', 'sheet', 'sheet']);
    expect((['handStart', 'turn', 'waiting'] as const).map(lessonWhere)).toEqual(['bubble', 'bubble', 'bubble']);
  });

  it("offers only the hands a sheet's line names: not the coach's notes, the plan or words", () => {
    const x = hand('Windy Chows');
    const s = state({
      moment: 'claim',
      teach: [note('rule:flowers')],
      plan: hand('Monty'),
      say: [{ text: 'Pung', action: true }, { text: " it: you'll be two tiles from " }, named(x), { text: '. Runs and pungs.' }],
    });
    const l = lessonFor(s, NOTHING);
    expect(l.where).toBe('sheet');
    expect(keys(l)).toEqual(['hand:Windy Chows']);
    expect(l.notes[0]!.hand).toBe(x);
  });

  it("explains the winner's hand under the result line the first time, and not the next", { timeout: 60_000 }, () => {
    // A hand one of the bots wins.
    let end: HandState | null = null;
    for (let i = 0; i < 30 && !end; i++) {
      const s = playHand({ seed: `teach-win-${i}`, progress: ROUNDS.E0, dealer: (i % 4) as Seat });
      if (s.result?.type === 'win' && s.result.winner !== 0) end = s;
    }
    expect(end, 'a hand a bot wins').not.toBeNull();
    const coach = coachOf(viewFor(end!, karachi, 0), 'new');
    const title = coach.outcome!.hand!.title;
    const first = lessonFor(coach, NOTHING);
    expect(first.where).toBe('sheet');
    expect(first.notes[0]).toMatchObject({ key: `hand:${title}`, label: title, text: coach.outcome!.hand!.ref.note });
    expect(first.notes[0]!.hand).toBe(coach.outcome!.hand!.ref);
    expect(keys(lessonFor(coach, new Set(first.marks)))).not.toContain(`hand:${title}`);
  });
});

describe('the order notes are offered in, under the bubble', () => {
  it("is the coach's own notes, then the hands named in the order they're said, then the plan's hand, then words", () => {
    const a = hand('Aa');
    const b = hand('Bb');
    const plan = hand('Pp');
    const s = state({
      teach: [note('rule:flowers', 'bonus')],
      plan,
      // A switch of plan names two hands: both are offered, in order.
      say: [{ text: 'Let it go', action: true }, { text: '. Switching to ' }, named(a), { text: ' from ' }, named(b), { text: ': a pung and a pair.' }],
    });
    const order: string[] = [];
    const taught = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const l = lessonFor(s, taught);
      order.push(keys(l)[0]!);
      taught.add(keys(l)[0]!);
    }
    expect(order).toEqual(['rule:flowers', 'hand:Aa', 'hand:Bb', 'hand:Pp']);
    expect(keys(lessonFor(s, taught))).toEqual(['term:pung', 'term:pair']);
  });

  it("offers the plan's hand only while the plan is shown", () => {
    expect(keys(lessonFor(state({ plan: hand('Pp') }), NOTHING))).toEqual(['hand:Pp']);
    expect(keys(lessonFor(state({ plan: null }), NOTHING))).toEqual([]);
  });

  it('offers words only to a first-timer', () => {
    const say: CoachSegment[] = [{ text: 'Let it go', action: true }, { text: ': a pung and a pair.' }];
    expect(keys(lessonFor(state({ say, stage: 'first_hand' }), NOTHING))).toEqual(['term:pung', 'term:pair']);
    expect(keys(lessonFor(state({ say, stage: 'learning' }), NOTHING))).toEqual([]);
  });

  it("never offers a word from inside a hand's name", () => {
    const say: CoachSegment[] = [{ text: 'Let it go', action: true }, { text: ': it does nothing for ' }, named(hand('Pung + 5 Honours')), { text: '.' }];
    expect(keys(lessonFor(state({ say }), new Set(['hand:Pung + 5 Honours'])))).toEqual([]);
  });
});

describe('what the line says, or a note has just said, is never a note too', () => {
  it("keeps the round's hands off a non-dealer's East hand-start bubble, which gives the aim", () => {
    const view = viewFor(startHand(karachi, { seed: 'teach-east', progress: ROUNDS.E1, dealer: 1 }), karachi, 0);
    const coach = coachOf(view, 'new');
    expect(coach.moment).toBe('handStart');
    expect(coach.plan).toBeNull();
    expect(coach.teach).toEqual([expect.objectContaining({ key: 'round:honour', place: 'said' })]);
    const l = lessonFor(coach, NOTHING);
    expect(keys(l).filter((k) => k.startsWith('hand:'))).toEqual([]);
    expect(keys(l).length).toBeGreaterThan(0);
    expect(l.marks).toEqual(expect.arrayContaining(['round:honour', 'hand:Chow + 5 Honours', 'hand:Pung + 5 Honours']));
  });

  it("gives the dealer's first goulash turn the round's note, and not the goulash's own", () => {
    const view = viewFor(startHand(karachi, { seed: 'teach-goulash', progress: ROUNDS.E0, dealer: 0 }), karachi, 0);
    for (const stage of ['new', 'learning'] as const) {
      const l = lessonFor(coachOf(view, stage), NOTHING);
      expect(keys(l)[0]).toBe('round:goulash');
      expect(keys(l)).not.toContain('hand:Goulash');
      expect(l.marks).toEqual(expect.arrayContaining(['round:goulash', 'hand:Goulash']));
    }
  });

  it("keeps the word's footnote for flowers off a line that explains flowers", () => {
    const flowers: CoachTeach = { key: 'rule:flowers', place: 'note', label: 'flowers', text: 'bonus tiles', also: ['term:bonus'] };
    const say: CoachSegment[] = [{ text: 'Let it go', action: true }, { text: ': flowers are no use to it.' }];
    const l = lessonFor(state({ say, teach: [flowers] }), NOTHING);
    expect(keys(l)).toEqual(['rule:flowers']);
    expect(l.marks).toEqual(['rule:flowers', 'term:bonus']);
  });

  it("teaches the round with the round's only everyday hand, and the other way round", () => {
    const adh = hand('Any Damn Hand');
    const south = { generalTitles: ['Any Damn Hand'], handKind: 'noHonour' };
    expect(handNote(adh, south).also).toEqual(['round:noHonour']);
    expect(handNote(hand('Crazy Chows'), south).also).toBeUndefined();
    // East has two everyday hands, and a round note of its own for them.
    expect(handNote(hand('Chow + 5 Honours'), { generalTitles: ['Chow + 5 Honours', 'Pung + 5 Honours'], handKind: 'honour' }).also).toBeUndefined();
    const l = lessonFor(state({ moment: 'handEnd', goal: south, say: [{ text: 'You were two tiles short of ' }, named(adh), { text: '.' }] }), NOTHING);
    expect(l.marks).toEqual(['hand:Any Damn Hand', 'round:noHonour']);
  });
});

describe('the key a lesson is worked out for', () => {
  it('is the same for the same view seen again, and new for a new one', () => {
    const view = viewFor(startHand(karachi, { seed: 'teach-key', progress: ROUNDS.E0, dealer: 0 }), karachi, 0);
    expect(lessonKey(coachOf(view, 'new'))).toBe(lessonKey(coachOf(view, 'new')));
    expect(lessonKey(state({ seq: 1 }))).not.toBe(lessonKey(state({ seq: 2 })));
    expect(lessonKey(state({ teach: [note('rule:flowers')] }))).not.toBe(lessonKey(state({})));
    expect(lessonFor(state({}), NOTHING).key).toBe(lessonKey(state({})));
  });
});

describe('the line a lesson goes under', () => {
  it("is the same line on a new view, and a new one when the hand, the moment, the move asked for, the words or what they'd teach change", () => {
    const base = { teach: [note('rule:flowers')] };
    expect(lineKey(state({ ...base, seq: 2 }))).toBe(lineKey(state({ ...base, seq: 7 })));
    const others = [
      state({ ...base, hand: 1 }),
      state({ ...base, moment: 'handStart' }),
      state({ ...base, action: { kind: 'discard', tile: 'p1' } }),
      state({ ...base, say: [{ text: 'Keep it', action: true }, { text: '.' }] }),
      state({ teach: [] }),
      state({ teach: [{ ...note('rule:flowers'), place: 'said' }] }),
    ];
    for (const other of others) expect(lineKey(other)).not.toBe(lineKey(state(base)));
  });
});

describe("the table's lessons, one view after another", () => {
  /** A store that also records every set of keys it's told were taught. */
  function recording(): { store: TaughtStore; added: string[][] } {
    const inner = createTaughtStore(null);
    const added: string[][] = [];
    const store: TaughtStore = {
      all: () => inner.all(),
      add: (k) => {
        added.push([...k]);
        inner.add(k);
      },
    };
    return { store, added };
  }
  const flowers = { teach: [note('rule:flowers')], stage: 'learning' as const };

  it('gives a view seen again the lesson it got the first time, and teaches nothing more', () => {
    const { store, added } = recording();
    const lessons = createLessons(() => store);
    const first = lessons.next(state({ ...flowers, seq: 1 }));
    expect(keys(first)).toEqual(['rule:flowers']);
    expect(lessons.next(state({ ...flowers, seq: 1 }))).toBe(first);
    expect(added).toEqual([['rule:flowers']]);
  });

  it('keeps the notes on screen while the same line stays up on the next views, though they were taught with it', () => {
    const { store, added } = recording();
    const lessons = createLessons(() => store);
    const first = lessons.next(state({ ...flowers, seq: 1 }));
    for (const seq of [2, 3, 4]) {
      const now = state({ ...flowers, seq });
      // Worked out afresh, the note would be gone: it's been taught.
      expect(lessonFor(now, store.all()).notes).toEqual([]);
      const kept = lessons.next(now);
      expect(kept.notes).toEqual(first.notes);
      expect(kept.key).toBe(lessonKey(now));
    }
    expect(added).toEqual([['rule:flowers']]);
  });

  it('works a new line out from what this visit has been taught, the same words asking for a move included', () => {
    const store = createTaughtStore(null);
    const lessons = createLessons(() => store);
    lessons.next(state({ ...flowers, seq: 1 }));
    // The same words, now the player's turn: a new line, and the note has been taught.
    expect(lessons.next(state({ ...flowers, seq: 2, action: { kind: 'discard', tile: 'p1' } })).notes).toEqual([]);
    // And the first line back again after another is a new line too.
    expect(lessons.next(state({ ...flowers, seq: 3 })).notes).toEqual([]);
  });

  it('starts a line afresh once the notes have been off the screen', () => {
    const store = createTaughtStore(null);
    const lessons = createLessons(() => store);
    expect(keys(lessons.next(state({ ...flowers, seq: 1 })))).toEqual(['rule:flowers']);
    lessons.clear();
    expect(lessons.next(state({ ...flowers, seq: 2 })).notes).toEqual([]);
  });

  it('works a new line out as a first visit would while the page hydrates, and marks it taught all the same', () => {
    const { store, added } = recording();
    // Taught on this tab's last page: the server couldn't know, so the page it rendered explains it again.
    store.add(['rule:flowers']);
    added.length = 0;
    const lessons = createLessons(() => store);
    expect(keys(lessons.next(state({ ...flowers, seq: 1 }), true))).toEqual(['rule:flowers']);
    expect(added).toEqual([['rule:flowers']]);
  });

  it('remembers only so many views', () => {
    const lessons = createLessons(() => createTaughtStore(null), 2);
    const lines = [1, 2, 3].map((seq) => state({ seq, say: [{ text: `Line ${seq}`, action: true }] }));
    const [one, , three] = lines.map((s) => lessons.next(s));
    expect(lessons.next(lines[2]!)).toBe(three);
    expect(lessons.next(lines[0]!)).not.toBe(one);
  });

  /** Every view seat 0 sees from the deal to its own first turn, with someone else dealing. */
  function handStart(seed: string, round: keyof typeof ROUNDS, dealer: Seat): PrivatePlayerView[] {
    const views: PrivatePlayerView[] = [];
    playHand({ seed, progress: ROUNDS[round], dealer, onView: (v) => views.push(v), until: (v) => v.phase === 'turn' && v.turn === 0 });
    return views;
  }
  /** What the player sees staying put: the same hand, the same moment, the same words, and still waiting or still asked for the same kind of move. */
  const samePlace = (a: CoachState, b: CoachState) =>
    a.at.hand === b.at.hand && a.moment === b.moment && a.action.kind === b.action.kind && textOf(a.say) !== '' && textOf(a.say) === textOf(b.say);

  it("keeps a non-dealer's hand-start notes while the others move, and gives their own first turn notes it hasn't had", { timeout: 120_000 }, () => {
    let kept = 0;
    let keptFlowers = 0;
    let firstTurns = 0;
    for (const round of Object.keys(ROUNDS) as (keyof typeof ROUNDS)[]) {
      for (const dealer of SEATS.filter((x) => x !== 0)) {
        for (let i = 0; i < 3; i++) {
          const views = handStart(`lines-${round}-${dealer}-${i}`, round, dealer);
          const analyses = views.map((v) => analyseFor(v, karachi));
          for (const stage of ['new', 'learning'] as const) {
            const store = createTaughtStore(null);
            const lessons = createLessons(() => store);
            const shown = views.map((v, j) => {
              const coach = coachOf(v, stage, analyses[j]);
              return { coach, lesson: lessons.next(coach) };
            });
            for (let j = 1; j < shown.length; j++) {
              const [a, b] = [shown[j - 1]!, shown[j]!];
              if (!samePlace(a.coach, b.coach)) continue;
              expect(b.lesson.notes, `${round} dealer ${dealer} #${i} ${stage}, seq ${a.coach.at.seq} to ${b.coach.at.seq}`).toEqual(a.lesson.notes);
              if (a.lesson.notes.length > 0) kept++;
              if (a.lesson.notes.some((n) => n.key === 'rule:flowers')) keptFlowers++;
            }
            const last = shown[shown.length - 1]!;
            if (last.coach.action.kind !== 'discard' || last.coach.say.length === 0) continue;
            // The player's own first turn is a new line: nothing shown on the way to it shows again.
            firstTurns++;
            const before = new Set(shown.slice(0, -1).flatMap((x) => keys(x.lesson)));
            expect(
              keys(last.lesson).filter((k) => before.has(k)),
              `${round} dealer ${dealer} #${i} ${stage}`,
            ).toEqual([]);
          }
        }
      }
    }
    expect(kept, 'a hand-start line with notes stayed up for more than one view').toBeGreaterThan(0);
    expect(keptFlowers, 'a flower from the deal kept its note while the others moved').toBeGreaterThan(0);
    expect(firstTurns).toBeGreaterThan(0);
  });
});

describe('what this visit has been taught', () => {
  function memoryStorage() {
    const m = new Map<string, string>();
    return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  }

  it('keeps its keys in storage as JSON, for the next page in the tab', () => {
    const storage = memoryStorage();
    createTaughtStore(storage).add(['round:goulash', 'hand:Goulash']);
    expect(JSON.parse(storage.m.get(TAUGHT_KEY)!)).toEqual(['round:goulash', 'hand:Goulash']);
    const next = createTaughtStore(storage);
    expect([...next.all()]).toEqual(['round:goulash', 'hand:Goulash']);
    next.add(['term:pung']);
    expect([...createTaughtStore(storage).all()]).toEqual(['round:goulash', 'hand:Goulash', 'term:pung']);
  });

  it("reads nonsense in storage as nothing taught, and never lets another page's keys go", () => {
    const storage = memoryStorage();
    storage.m.set(TAUGHT_KEY, '{"not":"a list"}');
    expect([...createTaughtStore(storage).all()]).toEqual([]);
    storage.m.set(TAUGHT_KEY, '["a", 3, "b"]');
    expect([...createTaughtStore(storage).all()]).toEqual(['a', 'b']);
  });

  it('remembers in memory when storage throws, so a note still shows once a page', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const store = createTaughtStore(throwing);
    expect([...store.all()]).toEqual([]);
    expect(() => store.add(['round:goulash'])).not.toThrow();
    expect([...store.all()]).toEqual(['round:goulash']);
    const none = createTaughtStore(null);
    none.add(['term:pung']);
    expect([...none.all()]).toEqual(['term:pung']);
  });
});
