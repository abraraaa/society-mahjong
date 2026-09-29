'use client';
import type { LayoutGroup } from '@society/engine';
import type { CoachHandRef } from '@/lib/coach';
import { cardClockLine, type CardClock } from '@/lib/coach/clock';
import { cardCaption, cardTileSize } from '@/lib/coach/hand-card';
import { heldOf, stripGroups } from '@/lib/coach/strip';
import { capitalise } from '@/lib/coach/words';
import { Tile } from './tile';

type RowStyle = React.CSSProperties & { '--strip-n'?: number; '--strip-g'?: number };

/** A hand laid out in its sets, the way a player sets the tiles out: held tiles lit, the ones still to find faded, a set not started face down. */
export function HandGroups({ layout, className, size = '2xs' }: { layout: readonly LayoutGroup[]; className: string; size?: '2xs' | 'xs' | 'sm' }) {
  const groups = stripGroups(layout);
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

/**
 * The top of a tutor sheet: the grabber, or over a clock, in its place, the line
 * that says the claim's held or how long a live clock has left. The two are the
 * same height, so a clock that starts or stops under an open sheet moves nothing
 * the player is reading: the ? sheet is as tall as it can be, and scrolls.
 */
export function ClockLine({ clock }: { clock: CardClock }) {
  const line = cardClockLine(clock);
  return line ? <p className="clock">{line}</p> : <div className="grabber" />;
}

/** For a screen reader, which can't see which tiles are lit. */
function summary(card: CoachHandRef): string {
  const { held, total } = heldOf(stripGroups(card.layout));
  return card.whose === 'yours' || card.whose === 'ifClaimed' ? `You hold ${held} of its ${total} tiles.` : `${total} tiles.`;
}

/**
 * A hand, big enough to read: its name, what it is in words, the tiles in their
 * sets, and whose they are. The same card wherever the tutor names a hand, in
 * the bubble, the plan strip, a sheet's line or "Hands this round". Over a
 * clock, its first line says whether the clock is held or still running.
 */
export function HandCard({ card, clock, onClose }: { card: CoachHandRef; clock: CardClock; onClose: () => void }) {
  const caption = cardCaption(card);
  const open = stripGroups(card.layout).some((g) => g.open);
  return (
    <>
      <div className="scrim scrim-top" onClick={onClose} />
      <div className="sheet sheet-top hand-card" role="dialog" aria-label={card.title} data-sheet="card" data-whose={card.whose}>
        <ClockLine clock={clock} />
        <h2 className="font-display text-xl">{card.title}</h2>
        {card.shape && <p className="text-ivory-100/80 mt-1 text-sm">{capitalise(card.shape)}.</p>}
        {card.layout.length > 0 && <HandGroups layout={card.layout} className="card-row" size={cardTileSize(card)} />}
        {caption && (
          <p className="text-ivory-100/90 text-sm">
            {caption.name !== undefined && <bdi>{caption.name}</bdi>}
            {caption.text}
          </p>
        )}
        {open && <p className="text-ivory-100/60 mt-1 text-xs">Face-down tiles are a set you haven&apos;t started: any set of that shape will do.</p>}
        {card.layout.length > 0 && <p className="sr-only">{summary(card)}</p>}
        <button className="btn btn-ghost btn-block mt-3" onClick={onClose}>
          Got it
        </button>
      </div>
    </>
  );
}
