// Relative rather than '@/': vitest runs without the path alias, and the tests load this.
import { stageFor } from '../coach/stage';
import type { CoachStage } from '../coach/types';

/** What `profiles.stats` holds: the live table's tally of a player. Older rows hold neither key. */
export interface ProfileStats {
  readonly hands?: number;
  readonly wins?: number;
}

/**
 * A player's level from their tally, on the solo table's thresholds: one
 * finished hand makes them `learning`, three wins `solid`. The profile never
 * sees a discard, so `first_hand` cannot come from here; it is timed the same
 * as `new` anyway.
 */
export function stageFromStats(stats: ProfileStats): CoachStage {
  return stageFor({ handsFinished: stats.hands ?? 0, wins: stats.wins ?? 0, discardsMade: 0 });
}

/** The tally after one more hand. */
export function tallyHand(stats: ProfileStats, won: boolean): ProfileStats {
  return { ...stats, hands: (stats.hands ?? 0) + 1, wins: (stats.wins ?? 0) + (won ? 1 : 0) };
}
