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
    aim: 'Four pungs and a pair. No runs at all.',
    // The gate is the goulash's one trap: docs/RULES-KARACHI.md, "Goulash".
    watchOut: 'Honour pungs need two of: a dragon pung, the round wind, your own wind.',
    honours: 'gated',
  },
  honour: {
    aim: 'Three runs or three pungs, plus five honours.',
    watchOut: 'Usually that is one of each wind with one paired — so keep your lone winds.',
    honours: 'required',
  },
  noHonour: {
    aim: 'Four sets and a pair, and not one wind or dragon.',
    watchOut: 'Honours fit no hand this round. Let them go early.',
    honours: 'forbidden',
  },
  big: {
    aim: 'Only the big named hands count this round.',
    watchOut: 'Most want all four winds and the dragons — hold your honours for now.',
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
