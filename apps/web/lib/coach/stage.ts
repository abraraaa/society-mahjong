import { countWord } from './words';
import type { CoachStage } from './types';

/** Wins before the tutor asks whether it should just watch, and again after each "keep helping". */
export const WATCH_EVERY = 3;

/** What the coach has seen of a player, and what they told it when it offered to step back. */
export interface Tally {
  readonly handsFinished: number;
  readonly wins: number;
  readonly discardsMade: number;
  /** they said "just watch" */
  readonly watching?: boolean | undefined;
  /** their win count when they last said "keep helping" */
  readonly keptHelpingAt?: number | undefined;
}

/**
 * How much the coach should say. The profile carries this as `onboarding_stage`
 * (docs/PLAN.md §3); a solo table has no profile, so it counts what it has seen.
 *
 * Winning doesn't make a player `solid` by itself: a win with every tip taken
 * is the tutor's win as much as theirs. Three wins make the tutor ask
 * (`asksToWatch`), and only the player's "just watch" quiets it.
 */
export function stageFor({ handsFinished, discardsMade, watching }: Tally): CoachStage {
  if (watching) return 'solid';
  if (handsFinished >= 1) return 'learning';
  if (discardsMade > 0) return 'first_hand';
  return 'new';
}

/** Whether the tutor should offer to just watch: three wins in, and three more after each "keep helping". */
export function asksToWatch({ wins, watching, keptHelpingAt }: Pick<Tally, 'wins' | 'watching' | 'keptHelpingAt'>): boolean {
  if (watching) return false;
  return wins >= (keptHelpingAt ?? 0) + WATCH_EVERY;
}

/**
 * What the offer says under its heading. At the solo table "just watch" also
 * lets the bots off the leash; at a live table it counts towards quicker
 * clocks, but only once everyone seated has said it (live/policy.ts takes the
 * slowest level at the table).
 */
export const WATCH_LINE = {
  solo: "I'll still light the tile I'd let go, without the words, and the bots stop going easy on you.",
  live: "I'll still light the tile I'd let go, without the words. Once everyone at the table has said this, its clocks get quicker.",
} as const;

/** The offer's heading: "Three wins. Want me to just watch?" */
export function watchHeading(wins: number): string {
  const n = countWord(wins);
  return `${n.charAt(0).toUpperCase()}${n.slice(1)} wins. Want me to just watch?`;
}
