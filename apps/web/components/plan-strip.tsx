'use client';
import { memo, useState } from 'react';
import type { CoachTarget } from '@/lib/coach';
import { capitalise, planCount, tilesWord } from '@/lib/coach/words';
import { heldOf, stripGroups, type StripGroup } from '@/lib/coach/strip';
import { Tile } from './tile';

/**
 * The plan strip: the winning hand the player is nearest, laid out in its
 * sets just above their own tiles. Tiles they hold are lit; the ones still to
 * find are faded; a set they haven't started, which could be any set of that
 * shape, is face down. It changes as the hand does, so "4 tiles to go" is four
 * faded tiles you can watch light up. Tapping it opens the hand card.
 *
 * The slot keeps its height from the deal: a turn with no plan to show keeps
 * the last one, so the table never jumps.
 */
export const PlanStrip = memo(function PlanStrip({ target }: { target: CoachTarget | null }) {
  // The last plan that had a lay-out, kept for a turn that has none (React's "store what you saw" pattern).
  const [last, setLast] = useState<CoachTarget | null>(target?.layout ? target : null);
  if (target?.layout && target !== last) setLast(target);
  const shown = target?.layout ? target : last;
  const [open, setOpen] = useState(false);

  if (!shown?.layout) return <div className="plan-strip" aria-hidden="true" />;
  const groups = stripGroups(shown.layout);
  const { held, total } = heldOf(groups);
  const count = planCount(shown.away, shown.approximate);
  return (
    <>
      <button
        type="button"
        className="plan-strip"
        onClick={() => setOpen(true)}
        aria-label={`Your plan: ${shown.title}. ${held} of ${total} tiles in place, ${count}. Show the hand.`}
      >
        <span className="plan">
          <span className="plan-title">{shown.title}</span>
          <span className="plan-count">{`\u00a0·\u00a0${count}`}</span>
        </span>
        <Groups groups={groups} className="strip-row" />
      </button>
      {open && <HandCard target={shown} groups={groups} onClose={() => setOpen(false)} />}
    </>
  );
});

type RowStyle = React.CSSProperties & { '--strip-n'?: number; '--strip-g'?: number };

function Groups({ groups, className, size = '2xs' }: { groups: readonly StripGroup[]; className: string; size?: '2xs' | 'xs' | 'sm' }) {
  const style: RowStyle = { '--strip-n': heldOf(groups).total, '--strip-g': Math.max(0, groups.length - 1) };
  return (
    <span className={className} style={style} aria-hidden="true">
      {groups.map((g, i) => (
        <span key={i} className={`strip-group${g.exposed ? ' is-exposed' : ''}`}>
          {g.tiles.map((t, j) =>
            g.open ? <Tile key={j} picture back dim size={size} /> : <Tile key={j} picture kind={t.kind} dim={!t.held} size={size} className={t.held ? undefined : 'is-needed'} />,
          )}
        </span>
      ))}
    </span>
  );
}

/** The plan, big enough to read: the hand in its sets, what it is in words, and what's still to find. */
function HandCard({ target, groups, onClose }: { target: CoachTarget; groups: readonly StripGroup[]; onClose: () => void }) {
  const long = groups.some((g) => g.tiles.length > 7);
  const line =
    target.away <= 0
      ? "Every tile's yours. That's the hand, complete."
      : `The bright tiles are yours; the faded ones you still need. ${capitalise(`${target.approximate ? 'about ' : ''}${tilesWord(target.away)}`)} to go.`;
  return (
    <>
      <div className="scrim scrim-top" onClick={onClose} />
      <div className="sheet sheet-top hand-card" role="dialog" aria-label={target.title}>
        <div className="grabber" />
        <h2 className="font-display text-xl">{target.title}</h2>
        {target.shape && <p className="text-ivory-100/80 mt-1 text-sm">{capitalise(target.shape)}.</p>}
        <Groups groups={groups} className="card-row" size={long ? 'xs' : 'sm'} />
        <p className="text-ivory-100/90 text-sm">{line}</p>
        {groups.some((g) => g.open) && <p className="text-ivory-100/60 mt-1 text-xs">Face-down tiles are a set you haven&apos;t started: any set of that shape will do.</p>}
        <button className="btn btn-ghost btn-block mt-3" onClick={onClose}>
          Got it
        </button>
      </div>
    </>
  );
}
