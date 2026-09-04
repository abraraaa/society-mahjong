import type { CoachSegment } from '@/lib/coach';

/**
 * The tutor's bubble. It renders what `coachFor` decided and nothing else — the
 * prose is assembled in the coach layer so a later conversational tutor can be
 * given the same structured state instead of a formatted string.
 *
 * `plan` is the one-line status ("Windy Chows · 3 away"); `say` is one or two
 * sentences with a single bold action, mirrored by the primary button below.
 */
export function Coach({ plan, say }: { plan?: string | null; say: readonly CoachSegment[] }) {
  if (!plan && say.length === 0) return null;
  return (
    <div className="coach">
      <span className="avatar">T</span>
      <div className="body">
        {plan && <p className="plan">{plan}</p>}
        {say.length > 0 && (
          <p className="say">
            {say.map((s, i) => (s.action ? <b key={i}>{s.text}</b> : <span key={i}>{s.text}</span>))}
          </p>
        )}
      </div>
    </div>
  );
}

/** The same words, unbubbled, for captions inside a sheet. */
export function CoachLine({ say }: { say: readonly CoachSegment[] }) {
  return (
    <>
      {say.map((s, i) => (s.action ? <b key={i}>{s.text}</b> : <span key={i}>{s.text}</span>))}
    </>
  );
}
