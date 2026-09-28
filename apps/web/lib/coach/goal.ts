import type { HandSpec, Ruleset, Wind } from '@society/engine';
import { titleOf } from './shape';
import type { CoachGoal } from './types';

/**
 * The round's goal, read off the ruleset's own hand spec rather than remembered.
 *
 * `spec.kind` is the ruleset's word for what this hand has to be, so keying the
 * copy on it means the coach cannot describe a round the table is not playing.
 * Anything unrecognised falls back to the spec's own description.
 */

interface GoalCopy {
  readonly aim: string;
  readonly watchOut: string | null;
  readonly honours: CoachGoal['honours'];
}

const COPY: Readonly<Record<string, GoalCopy>> = {
  goulash: {
    aim: 'Four pungs and a pair. A pung is three matching tiles.',
    // The gate is the goulash's one trap: docs/RULES-KARACHI.md, "Goulash".
    watchOut: "Only keep winds and dragons if you've got lots.",
    honours: 'gated',
  },
  honour: {
    aim: 'Three runs or three pungs, plus five winds and dragons.',
    watchOut: "Usually that's all four winds with one paired.",
    honours: 'required',
  },
  noHonour: {
    // Runs count here, and they're usually the quickest way: say so, or a player fresh from the goulash chases pungs.
    aim: 'Four sets and a pair, runs or pungs, with no winds or dragons at all.',
    watchOut: 'Let your winds and dragons go early.',
    honours: 'forbidden',
  },
  big: {
    aim: 'Only the big named hands count: most are long runs in one suit, or full of winds and dragons.',
    watchOut: 'Hold on to your winds and dragons for now.',
    honours: 'optional',
  },
};

/**
 * The round's footnote, the first time this visit a hand of its kind is played:
 * what the hand has to be, in the fewest words. Keyed like the goal copy, so the
 * West goulash is "this hand" too, and a kind with no line gets no footnote.
 */
const ROUND_NOTES: Readonly<Record<string, { readonly label: string; readonly text: string }>> = {
  goulash: { label: 'this hand', text: "four pungs and a pair, and runs don't count" },
  honour: { label: 'East from here', text: 'three runs or three pungs, plus five winds and dragons' },
  noHonour: { label: 'South', text: 'four sets and a pair, runs or pungs, and no winds or dragons' },
  big: { label: 'North', text: 'only the big named hands count; tap ? to see them' },
};

export function roundNote(kind: string): { readonly label: string; readonly text: string } | null {
  return Object.prototype.hasOwnProperty.call(ROUND_NOTES, kind) ? ROUND_NOTES[kind]! : null;
}

/** The round's everyday hands: its general-tagged titles in spec order, or its one title when it deals only one hand. */
export function generalTitlesOf(spec: HandSpec): string[] {
  if (spec.patterns.length === 1) return [titleOf(spec.patterns[0]!)];
  return [...new Set(spec.patterns.filter((p) => p.tags?.includes('general')).map(titleOf))];
}

/** Everything but `hands`, which needs the player's analysis: `coachFor` adds it. */
export function goalFor(spec: HandSpec, roundWind: Wind, ruleset: Ruleset): Omit<CoachGoal, 'hands'> {
  const copy = COPY[spec.kind];
  return {
    roundWind,
    handKind: spec.kind,
    label: spec.label,
    aim: copy?.aim ?? spec.description ?? spec.label,
    watchOut: copy?.watchOut ?? null,
    honours: copy?.honours ?? 'optional',
    chowsClaimable: ruleset.claims.chowFromDiscard !== 'never',
    generalTitles: generalTitlesOf(spec),
  };
}
