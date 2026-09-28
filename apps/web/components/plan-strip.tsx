'use client';
import { memo, useState } from 'react';
import type { CoachTarget } from '@/lib/coach';
import { planCount } from '@/lib/coach/words';
import { heldOf, stripGroups } from '@/lib/coach/strip';
import { useSheetActions } from './coach';
import { HandGroups } from './hand-card';

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
  const { open } = useSheetActions();

  if (!shown?.layout) return <div className="plan-strip" aria-hidden="true" />;
  const { held, total } = heldOf(stripGroups(shown.layout));
  const count = planCount(shown.away, shown.approximate);
  return (
    <button
      type="button"
      className="plan-strip"
      onClick={() => open({ kind: 'hand', ref: shown.hand, origin: 'table' })}
      aria-label={`Your plan: ${shown.title}. ${held} of ${total} tiles in place, ${count}. Show the hand.`}
    >
      <span className="plan">
        <span className="plan-title">{shown.title}</span>
        <span className="plan-count">{` · ${count}`}</span>
      </span>
      <HandGroups layout={shown.layout} className="strip-row" />
    </button>
  );
});
