import type { GameSnapshot } from './snapshot';

/**
 * How early the claim sheet passes for the player, ahead of the server's
 * deadline. The countdown starts when the snapshot is made, but the page
 * gets it a download later and its pass lands an upload after that: without
 * a margin the player's own pass always arrived after the window had shut,
 * and a bot's choice (sometimes a pung) stood in for it.
 */
export const CLAIM_PASS_MARGIN_MS = 1500;

/** How long the claim sheet waits before passing: the window left on the server's clock, less the margin. Null with no claim window. */
export function claimMsLeft(s: Pick<GameSnapshot, 'deadlines' | 'now'>): number | null {
  if (s.deadlines.claim === null) return null;
  return Math.max(0, s.deadlines.claim - s.now - CLAIM_PASS_MARGIN_MS);
}
