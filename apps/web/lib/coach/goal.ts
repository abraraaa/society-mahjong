import type { HandSpec, Ruleset, Wind } from '@society/engine';
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

export function goalFor(spec: HandSpec, roundWind: Wind, ruleset: Ruleset): CoachGoal {
  const copy = COPY[spec.kind];
  return {
    roundWind,
    handKind: spec.kind,
    label: spec.label,
    aim: copy?.aim ?? spec.description ?? spec.label,
    watchOut: copy?.watchOut ?? null,
    honours: copy?.honours ?? 'optional',
    chowsClaimable: ruleset.claims.chowFromDiscard !== 'never',
  };
}
