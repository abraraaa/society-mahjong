'use client';
import { Fragment, createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CoachHandRef, CoachMoment, CoachSegment, CoachState, CoachTarget } from '@/lib/coach';
import { stepsAside, type CardClock } from '@/lib/coach/clock';
import { GLOSSARY, TERMS, annotate, type Term } from '@/lib/coach/glossary';
import { resolveHandRef } from '@/lib/coach/hand-card';
import { createLessons, lessonFor, lessonKey, taughtStore, type Lesson, type Lessons } from '@/lib/coach/teach';
import { planCount } from '@/lib/coach/words';
import { ClockLine, HandCard } from './hand-card';
import { Tile } from './tile';

/**
 * The tutor's sheets: a word's definition, "Hands this round" with the words
 * at the table, and a hand's card. Tapping a word or a hand's name anywhere
 * the tutor speaks opens one. The provider sits at the table root so a name
 * inside a claim sheet opens the same card as one in the bubble; each sheet
 * remembers where it was opened from, so it can go when that place goes.
 */
export type SheetOrigin = 'table' | 'claim' | 'exchange' | 'result' | 'list';
export type SheetState =
  | { readonly kind: 'term'; readonly term: Term; readonly origin: SheetOrigin }
  | { readonly kind: 'all'; readonly origin: SheetOrigin }
  | { readonly kind: 'hand'; readonly ref: CoachHandRef; readonly origin: SheetOrigin; readonly back?: SheetState };

interface SheetActions {
  readonly open: (s: SheetState) => void;
  /** closes the open sheet, or only one opened from `origin` */
  readonly close: (origin?: SheetOrigin) => void;
}

// Two contexts: the actions never change, so a word or a strip that only opens
// sheets isn't redrawn every time one opens or closes.
const ActionsContext = createContext<SheetActions>({ open: () => {}, close: () => {} });
const CurrentContext = createContext<SheetState | null>(null);

/** Holds which tutor sheet is open, if any. Draws nothing: `TutorSheet` does, last in the table. */
export function TermProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<SheetState | null>(null);
  // Stable for the provider's life. `CoachLine`'s cleanup depends on `close`: if
  // `close` changed whenever a sheet opened, that cleanup would run again and shut
  // the card that had just opened.
  const open = useCallback((s: SheetState) => setCurrent(s), []);
  const close = useCallback((origin?: SheetOrigin) => setCurrent((s) => (origin === undefined || s?.origin === origin ? null : s)), []);
  const actions = useMemo(() => ({ open, close }), [open, close]);
  return (
    <ActionsContext.Provider value={actions}>
      <CurrentContext.Provider value={current}>{children}</CurrentContext.Provider>
    </ActionsContext.Provider>
  );
}

/** Opens a word's definition, or with 'all' the ? sheet. */
export function useOpenTerm(): (term: Term | 'all') => void {
  const { open } = useContext(ActionsContext);
  return useCallback((term: Term | 'all') => open(term === 'all' ? { kind: 'all', origin: 'table' } : { kind: 'term', term, origin: 'table' }), [open]);
}

/** Open and close, without the open sheet: stable, so a component that only opens sheets isn't redrawn when one opens. */
export function useSheetActions(): SheetActions {
  return useContext(ActionsContext);
}

export function useTutorSheet(): SheetActions & { readonly current: SheetState | null } {
  const actions = useContext(ActionsContext);
  const current = useContext(CurrentContext);
  return useMemo(() => ({ ...actions, current }), [actions, current]);
}

/** Whether any tutor sheet is open. */
export function useSheetOpen(): boolean {
  return useContext(CurrentContext) !== null;
}

type DataProps = { readonly [key: `data-${string}`]: string | undefined };

/**
 * A tappable word. A span with the button role rather than a button: a button
 * is laid out as an inline block, so a two-word hand name can't break across
 * lines and moves whole to the next one, which costs the bubble a fourth line.
 * A span wraps exactly like the words round it.
 */
export function TapWord({ className, onTap, children, ...data }: { className: string; onTap: () => void; children: React.ReactNode } & DataProps) {
  return (
    <span
      role="button"
      tabIndex={0}
      className={className}
      onClick={onTap}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onTap();
        }
      }}
      {...data}
    >
      {children}
    </span>
  );
}

/** Text with its glossary words tappable. */
function Words({ text, origin }: { text: string; origin: SheetOrigin }) {
  const { open } = useContext(ActionsContext);
  return (
    <>
      {annotate(text).map((run, i) => {
        const term = run.term;
        return term ? (
          <TapWord key={i} className="term" data-term={term} onTap={() => open({ kind: 'term', term, origin })}>
            {run.text}
          </TapWord>
        ) : (
          <span key={i}>{run.text}</span>
        );
      })}
    </>
  );
}

/** What the tutor says: the bold action, hand names that open their card, and words that open their definition. */
function Segments({ say, origin }: { say: readonly CoachSegment[]; origin: SheetOrigin }) {
  const { open } = useContext(ActionsContext);
  return (
    <>
      {say.map((s, i) => {
        const hand = s.hand;
        if (hand) {
          const name = (
            <TapWord key={i} className="term hand" onTap={() => open({ kind: 'hand', ref: hand, origin })}>
              {s.text}
            </TapWord>
          );
          return s.action ? <b key={i}>{name}</b> : name;
        }
        return s.action ? (
          <b key={i}>
            <Words text={s.text} origin={origin} />
          </b>
        ) : (
          <Words key={i} text={s.text} origin={origin} />
        );
      })}
    </>
  );
}

/** Subscribes to nothing: `useHydrating` only needs to know which render it's in. */
const subscribeToNothing = () => () => {};

/** True on the server and in the render that hydrates its HTML; false in every render after, and in a table first drawn after hydration. */
function useHydrating(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    () => false,
    () => true,
  );
}

const NOTHING_TAUGHT: ReadonlySet<string> = new Set();
/** Where the stylesheet hides the bubble's footnotes: a phone lying down has no room for them. */
const SHORT_LANDSCAPE = '(orientation: landscape) and (height < 32rem)';

/**
 * The footnotes for the tutor's state now: worked out before it's painted, so
 * a note comes with a new line and never pops in after it, and marked taught
 * for the rest of the visit. A line that stays on screen while the others move
 * keeps its notes (`createLessons`). Called once, at the table, so the bubble
 * and a sheet can't disagree. Null while the tutor is off.
 *
 * The first render after a page load can't read this visit's store (the
 * server rendered it), so it shows the notes a first visit would get, and
 * keeps them: the bubble never changes on hydration. A reload in the same tab
 * shows that one bubble's notes again, once.
 */
export function useLesson(coach: CoachState, enabled: boolean): Lesson | null {
  const hydrating = useHydrating();
  const key = lessonKey(coach);
  const lessons = useRef<Lessons | null>(null);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  useLayoutEffect(() => {
    lessons.current ??= createLessons(taughtStore);
    // Notes the stylesheet would hide aren't spent. Once they're off the screen, a line that comes back is worked out afresh.
    if (!enabled || window.matchMedia?.(SHORT_LANDSCAPE).matches) {
      lessons.current.clear();
      return;
    }
    setLesson(lessons.current.next(coach, hydrating));
  }, [coach, key, enabled, hydrating]);
  if (!enabled) return null;
  if (lesson?.key === key) return lesson;
  return hydrating ? lessonFor(coach, NOTHING_TAUGHT) : null;
}

/** Where a card opened from a footnote belongs: it goes when that place does. */
function originOf(moment: CoachMoment, where: Lesson['where']): SheetOrigin {
  if (where === 'bubble') return 'table';
  return moment === 'claim' ? 'claim' : moment === 'exchange' ? 'exchange' : 'result';
}

/**
 * The footnotes under a line, for the place they were worked out for: the
 * bubble, or a sheet's line. A hand's name in a note opens its card, like the
 * name in the line above.
 */
export function CoachNotes({ coach, lesson, where }: { coach: CoachState; lesson: Lesson | null; where: Lesson['where'] }) {
  const { open } = useContext(ActionsContext);
  if (!lesson || lesson.where !== where || lesson.notes.length === 0 || lesson.key !== lessonKey(coach)) return null;
  const origin = originOf(coach.moment, where);
  return (
    <p className="gloss">
      {lesson.notes.map((n, i) => {
        const hand = n.hand;
        return (
          <Fragment key={n.key}>
            {i > 0 && ' · '}
            <span data-note={n.key}>
              {hand ? (
                <b>
                  <TapWord className="term hand" onTap={() => open({ kind: 'hand', ref: hand, origin })}>
                    {n.label}
                  </TapWord>
                </b>
              ) : (
                n.label && <b>{n.label}</b>
              )}
              {n.label ? `: ${n.text}` : n.text}
            </span>
          </Fragment>
        );
      })}
    </p>
  );
}

/**
 * The tutor's bubble. It renders what `coachFor` decided and nothing else — the
 * prose is assembled in the coach layer so a later conversational tutor can be
 * given the same structured state instead of a formatted string.
 *
 * `plan` is the one-line status ("Windy Chows · 3 tiles to go"), a button that
 * opens the plan's card; `say` is one or two sentences with a single bold
 * action, mirrored by the primary button below. Under it, the first time this
 * visit a round, a hand, a rule or a word comes up, a footnote explains it
 * (`useLesson`); after that a word is only underlined, and a tap explains it.
 */
export const Coach = memo(function Coach({
  plan,
  target = null,
  say,
  coach = null,
  lesson = null,
  planInStrip = false,
}: {
  plan?: string | null;
  /** the plan's hand, for the plan line's card */
  target?: CoachTarget | null;
  say: readonly CoachSegment[];
  /** the tutor's state the footnotes were worked out for */
  coach?: CoachState | null;
  /** the footnotes, from `useLesson` */
  lesson?: Lesson | null;
  /** the plan strip shows the plan line, so the bubble keeps it only where the strip isn't drawn */
  planInStrip?: boolean;
}) {
  const { open } = useContext(ActionsContext);
  const text = say.map((s) => s.text).join('');
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  const bodyRef = useRef<HTMLParagraphElement>(null);

  // Is the clamp actually hiding anything? Only then show the "more" affordance.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    setClipped(!expanded && el.scrollHeight > el.clientHeight + 1);
  }, [text, expanded, lesson]);

  if ((!plan || planInStrip) && say.length === 0) return null;
  return (
    <div className={`coach${expanded ? ' expanded' : ''}`} onClick={() => clipped && setExpanded(true)}>
      <span className="avatar">T</span>
      <div className="body">
        {plan && (
          <button
            type="button"
            className="plan"
            data-strip={planInStrip ? '' : undefined}
            onClick={(e) => {
              e.stopPropagation();
              if (target) open({ kind: 'hand', ref: target.hand, origin: 'table' });
            }}
          >
            {target ? (
              <>
                <span className="plan-title">{target.title}</span>
                <span className="plan-count">{` · ${planCount(target.away, target.approximate)}`}</span>
              </>
            ) : (
              <span className="plan-title">{plan}</span>
            )}
          </button>
        )}
        {say.length > 0 && (
          <p className="say" ref={bodyRef}>
            <Segments say={say} origin="table" />
          </p>
        )}
        {coach && <CoachNotes coach={coach} lesson={lesson} where="bubble" />}
        {clipped && (
          <button type="button" className="more" onClick={() => setExpanded(true)}>
            more
          </button>
        )}
      </div>
    </div>
  );
});

/** The same words, unbubbled, for captions inside a sheet. The cards opened from them go when the sheet does: a claim resolved, a pass made, the next hand dealt. */
export function CoachLine({ say, origin }: { say: readonly CoachSegment[]; origin: SheetOrigin }) {
  const { close } = useContext(ActionsContext);
  useEffect(() => () => close(origin), [close, origin]);
  return <Segments say={say} origin={origin} />;
}

/**
 * Whichever tutor sheet is open, drawn above every other sheet. A `yours` card
 * follows the player's hand as it changes; "Got it" on a card opened from
 * "Hands this round" goes back to the list.
 *
 * `clock` is what the sheet says about the clock under it: a claim held on the
 * bots, or a live clock still running. As a live clock comes into its last few
 * seconds, whatever's open closes, once, so the player can still act in time.
 * A word or a card they open after that is their own choice: it opens, and its
 * clock line says how little is left. A tap that did nothing would be worse.
 */
export function TutorSheet({ coach, clock }: { coach: CoachState; clock: CardClock }) {
  const { open, close, current } = useTutorSheet();
  const aside = stepsAside(clock);
  // On the way in, not for as long as it lasts. Before paint, so the sheet is never drawn over the last seconds.
  useLayoutEffect(() => {
    if (aside) close();
  }, [aside, close]);
  if (!current) return null;
  if (current.kind === 'term') return <TermSheet term={current.term} clock={clock} onClose={() => close()} />;
  if (current.kind === 'hand') {
    const back = current.back;
    return <HandCard card={resolveHandRef(coach, current.ref)} clock={clock} onClose={() => (back ? open(back) : close())} />;
  }
  return <HandsAndWords hands={coach.goal.hands} clock={clock} onHand={(ref) => open({ kind: 'hand', ref, origin: 'list', back: current })} onClose={() => close()} />;
}

/** One term explained. Sits above any other sheet. */
function TermSheet({ term, clock, onClose }: { term: Term; clock: CardClock; onClose: () => void }) {
  return (
    <>
      <div className="scrim scrim-top" onClick={onClose} />
      <div className="sheet sheet-top" role="dialog" aria-label={GLOSSARY[term].label} data-sheet="term">
        <ClockLine clock={clock} />
        <div className="glossary">
          <Entry term={term} />
        </div>
        <button className="btn btn-ghost btn-block mt-3" onClick={onClose}>
          Got it
        </button>
      </div>
    </>
  );
}

/** The ? sheet: every hand the round allows, each opening its card, then the words at the table. */
function HandsAndWords({ hands, clock, onHand, onClose }: { hands: readonly CoachHandRef[]; clock: CardClock; onHand: (ref: CoachHandRef) => void; onClose: () => void }) {
  return (
    <>
      <div className="scrim scrim-top" onClick={onClose} />
      <div className="sheet sheet-top" role="dialog" aria-label="Glossary" data-sheet="list">
        <ClockLine clock={clock} />
        {hands.length > 0 && (
          <>
            <h2 className="font-display text-xl">Hands this round</h2>
            <p className="text-ivory-100/70 mt-1 text-sm">Tap one to see it.</p>
            <div className="hands-list">
              {hands.map((ref) => (
                <button key={ref.title} type="button" className="chip" onClick={() => onHand(ref)}>
                  {ref.title}
                </button>
              ))}
            </div>
          </>
        )}
        <h2 className="font-display mb-3 text-xl">The words at the table</h2>
        <div className="glossary">
          {TERMS.map((t) => (
            <Entry key={t} term={t} />
          ))}
        </div>
        <button className="btn btn-ghost btn-block mt-3" onClick={onClose}>
          Got it
        </button>
      </div>
    </>
  );
}

function Entry({ term }: { term: Term }) {
  const e = GLOSSARY[term];
  return (
    <div className="entry">
      <h3 className="font-display text-lg">{e.label}</h3>
      {e.example && (
        <div className="my-2 flex flex-wrap gap-1">
          {e.example.map((k, i) => (
            <Tile key={i} kind={k} size="xs" />
          ))}
        </div>
      )}
      <p className="text-ivory-100/90 text-sm">{e.long}</p>
    </div>
  );
}
