import type { Seat } from '@society/engine';
import type { CoachStage } from '@/lib/coach';
import { isAway } from './absence';
import type { Absence } from './table-state';
import type { Seats, TimerPolicy } from './types';

/**
 * Claim windows and turn limits by player level (docs/MULTIPLAYER.md §3). The
 * level is the coach's stage, worked out from the tally on the player's
 * profile (stage.ts), so a stage the table never advanced cannot pin the
 * clocks. A table runs at the pace of its least experienced player, so one
 * first-timer makes everyone wait, and a table of regulars runs at seven
 * seconds.
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

/** The levels of the humans at a table, from a per-seat list: bots and empty seats (null) drop out. */
export function humanLevels(levels: readonly (CoachStage | null)[]): CoachStage[] {
  return levels.filter((l): l is CoachStage => l !== null);
}

/**
 * The levels of the humans who are here (R10), from a per-seat list: bots,
 * empty seats and anyone a bot is playing for (away) drop out. The clocks
 * are sized by these, so an away first-timer doesn't slow the others, and
 * gets their long clocks back the moment they return.
 */
export function presentLevels(levels: readonly (CoachStage | null)[], seats: Seats, a: Absence | undefined): CoachStage[] {
  return humanLevels(levels.map((l, i) => (i < 4 && seats[i]?.kind === 'human' && !isAway(a, seats, i as Seat) ? l : null)));
}

/**
 * How the bots in empty seats play. While anyone seated is still finding
 * their feet (below `solid`), they play gently, as the solo table's do: they
 * sometimes let a useful tile go or miss a claim, so a first-timer has room
 * to win. A table of regulars, a table with no humans, and a strict room get
 * the sharp ones. This is only the filler bots: a bot standing in for a
 * person whose clock ran out plays their hand as well as it can.
 */
export function emptySeatBots(levels: readonly (CoachStage | null)[], strict = false): 'sharp' | 'gentle' {
  if (strict) return 'sharp';
  return humanLevels(levels).some((l) => l !== 'solid') ? 'gentle' : 'sharp';
}
