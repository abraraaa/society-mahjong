'use client';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { CoachSegment, CoachStage } from '@/lib/coach';
import { GLOSSARY, TERMS, annotate, termsIn, type Term } from '@/lib/coach/glossary';
import { Tile } from './tile';

/**
 * Tapping a term anywhere the coach speaks opens its definition. The provider
 * sits at the table root so a term inside a claim sheet opens the same sheet
 * as one in the bubble.
 */
const TermContext = createContext<(term: Term | 'all') => void>(() => {});

export function TermProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState<Term | 'all' | null>(null);
  return (
    <TermContext.Provider value={setOpen}>
      {children}
      {open && <TermSheet term={open} onClose={() => setOpen(null)} />}
    </TermContext.Provider>
  );
}

export function useOpenTerm() {
  return useContext(TermContext);
}

/** Text with its glossary words tappable. */
function Words({ text }: { text: string }) {
  const open = useOpenTerm();
  return (
    <>
      {annotate(text).map((run, i) =>
        run.term ? (
          <button key={i} type="button" className="term" onClick={() => open(run.term!)}>
            {run.text}
          </button>
        ) : (
          <span key={i}>{run.text}</span>
        ),
      )}
    </>
  );
}

/**
 * The tutor's bubble. It renders what `coachFor` decided and nothing else — the
 * prose is assembled in the coach layer so a later conversational tutor can be
 * given the same structured state instead of a formatted string.
 *
 * `plan` is the one-line status ("Windy Chows · 3 away"); `say` is one or two
 * sentences with a single bold action, mirrored by the primary button below.
 * For a new player, the first time a word like "pung" appears it gets a
 * footnote; after that it is only underlined, and a tap explains it.
 */
export function Coach({ plan, say, stage = 'solid' }: { plan?: string | null; say: readonly CoachSegment[]; stage?: CoachStage }) {
  const text = say.map((s) => s.text).join('');
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  const bodyRef = useRef<HTMLParagraphElement>(null);

  // Footnotes: the first two words in this text that this player has not been
  // told about yet. Computed when the text changes, then those words count as told.
  const teach = stage === 'new' || stage === 'first_hand';
  const seen = useRef<Set<Term>>(new Set());
  // Remembered per text, so re-running the effect (StrictMode, a re-render) gives
  // the same footnotes rather than moving on to the next unseen words.
  const decided = useRef<Map<string, Term[]>>(new Map());
  const [notes, setNotes] = useState<Term[]>([]);
  useEffect(() => {
    if (!teach) return;
    let fresh = decided.current.get(text);
    if (!fresh) {
      fresh = termsIn(text).filter((t) => !seen.current.has(t)).slice(0, 2);
      for (const t of fresh) seen.current.add(t);
      decided.current.set(text, fresh);
    }
    setNotes(fresh);
  }, [text, teach]);

  // Is the clamp actually hiding anything? Only then show the "more" affordance.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    setClipped(!expanded && el.scrollHeight > el.clientHeight + 1);
  }, [text, expanded, notes]);

  if (!plan && say.length === 0) return null;
  return (
    <div className={`coach${expanded ? ' expanded' : ''}`} onClick={() => clipped && setExpanded(true)}>
      <span className="avatar">T</span>
      <div className="body">
        {plan && <p className="plan">{plan}</p>}
        {say.length > 0 && (
          <p className="say" ref={bodyRef}>
            {say.map((s, i) => (s.action ? <b key={i}>{<Words text={s.text} />}</b> : <Words key={i} text={s.text} />))}
          </p>
        )}
        {teach && notes.length > 0 && (
          <p className="gloss">
            {notes.map((t, i) => (
              <span key={t}>
                {i > 0 && ' · '}
                <b>{GLOSSARY[t].label.toLowerCase()}</b>: {GLOSSARY[t].short}
              </span>
            ))}
          </p>
        )}
        {clipped && (
          <button type="button" className="more" onClick={() => setExpanded(true)}>
            more
          </button>
        )}
      </div>
    </div>
  );
}

/** The same words, unbubbled, for captions inside a sheet. */
export function CoachLine({ say }: { say: readonly CoachSegment[] }) {
  return <>{say.map((s, i) => (s.action ? <b key={i}>{<Words text={s.text} />}</b> : <Words key={i} text={s.text} />))}</>;
}

/** One term explained, or the whole glossary. Sits above any other sheet. */
function TermSheet({ term, onClose }: { term: Term | 'all'; onClose: () => void }) {
  const entries = term === 'all' ? TERMS : [term];
  return (
    <>
      <div className="scrim scrim-top" onClick={onClose} />
      <div className="sheet sheet-top" role="dialog" aria-label={term === 'all' ? 'Glossary' : GLOSSARY[term].label}>
        <div className="grabber" />
        {term === 'all' && <h2 className="font-display mb-3 text-xl">The words at the table</h2>}
        <div className="glossary">
          {entries.map((t) => {
            const e = GLOSSARY[t];
            return (
              <div key={t} className="entry">
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
          })}
        </div>
        <button className="btn btn-ghost btn-block mt-3" onClick={onClose}>
          Got it
        </button>
      </div>
    </>
  );
}
