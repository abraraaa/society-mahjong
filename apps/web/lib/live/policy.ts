import type { CoachStage } from '@/lib/coach';
import type { TimerPolicy } from './types';

/**
 * Claim windows and turn limits by player level (docs/MULTIPLAYER.md §3). A
 * table runs at the pace of its least experienced player, so one first-timer
 * makes everyone wait, and a table of regulars runs at seven seconds.
 */
const BY_STAGE: Readonly<Record<CoachStage, TimerPolicy>> = {
  new: { claimSeconds: 20, turnSeconds: 90 },
  first_hand: { claimSeconds: 20, turnSeconds: 90 },
  learning: { claimSeconds: 12, turnSeconds: 75 },
  solid: { claimSeconds: 7, turnSeconds: 60 },
};

/** The competitive option a room can opt into. */
export const STRICT: TimerPolicy = { claimSeconds: 7, turnSeconds: 30 };

export function policyFor(stages: readonly CoachStage[], strict = false): TimerPolicy {
  if (strict) return STRICT;
  let out: TimerPolicy = BY_STAGE.solid;
  for (const s of stages) {
    const p = BY_STAGE[s] ?? BY_STAGE.new;
    out = { claimSeconds: Math.max(out.claimSeconds, p.claimSeconds), turnSeconds: Math.max(out.turnSeconds, p.turnSeconds) };
  }
  return out;
}
