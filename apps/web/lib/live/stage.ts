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
  return stageFor({ handsFinished: count(stats.hands), wins: count(stats.wins), discardsMade: 0 });
}

/** A non-negative whole number, or nought: the column is JSON and its shape is not the database's to enforce. */
function count(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/** The tally after one more hand. */
export function tallyHand(stats: ProfileStats, won: boolean): ProfileStats {
  return { ...stats, hands: count(stats.hands) + 1, wins: count(stats.wins) + (won ? 1 : 0) };
}
