// Relative rather than '@/': vitest runs without the path alias, and the tests load this.
import { asksToWatch, stageFor } from '../coach/stage';
import type { CoachStage } from '../coach/types';

/** What `profiles.stats` holds: the live table's tally of a player, and their answer to the tutor's offer to watch. Older rows hold none of it. */
export interface ProfileStats {
  readonly hands?: number;
  readonly wins?: number;
  /** they told the tutor to just watch */
  readonly watch?: boolean;
  /** their win count when they last told it to keep helping */
  readonly keptHelpingAt?: number;
}

/**
 * A player's level from their tally, on the solo table's thresholds: one
 * finished hand makes them `learning`, and their own "just watch" `solid`.
 * The profile never sees a discard, so `first_hand` cannot come from here; it
 * is timed the same as `new` anyway.
 */
export function stageFromStats(stats: ProfileStats): CoachStage {
  return stageFor({ handsFinished: count(stats.hands), wins: count(stats.wins), discardsMade: 0, watching: stats.watch === true });
}

/** Whether the tutor offers this player to just watch (coach/stage.ts asksToWatch). */
export function asksFromStats(stats: ProfileStats): boolean {
  return asksToWatch({ wins: count(stats.wins), watching: stats.watch === true, keptHelpingAt: kept(stats.keptHelpingAt) });
}

/** The player's wins, as the tally holds them. */
export function winsOf(stats: ProfileStats): number {
  return count(stats.wins);
}

/** A non-negative whole number, or nought: the column is JSON and its shape is not the database's to enforce. */
function count(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function kept(n: unknown): number | undefined {
  return typeof n === 'number' ? count(n) : undefined;
}

/** The tally after one more hand. */
export function tallyHand(stats: ProfileStats, won: boolean): ProfileStats {
  return { ...stats, hands: count(stats.hands) + 1, wins: count(stats.wins) + (won ? 1 : 0) };
}

/** The tally with the player's answer to the offer: "just watch", or "keep helping" (asked again three wins on). */
export function answerWatch(stats: ProfileStats, watch: boolean): ProfileStats {
  return watch ? { ...stats, watch: true } : { ...stats, keptHelpingAt: count(stats.wins) };
}
