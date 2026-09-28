import type { PrivatePlayerView } from '@society/engine';
import type { CoachStage } from '../coach/types';

const ORDER: readonly CoachStage[] = ['new', 'first_hand', 'learning', 'solid'];

/**
 * The live tutor's stage. The server's tally is the level, and it only moves
 * when a hand is counted, so it's read afresh on every snapshot rather than
 * counted on this phone: a refresh, a second phone or someone else tapping
 * "Next hand" never loses it. The one step the tally can't see is the first
 * discard of a first-timer's first hand, which the hand's own events show.
 * Never lower than the server says.
 */
export function liveStage(server: CoachStage | null | undefined, view: Pick<PrivatePlayerView, 'me' | 'events'>): CoachStage {
  const tallied = server ?? 'new';
  const discarded = view.events.some((e) => e.type === 'discarded' && e.seat === view.me);
  const floor: CoachStage = discarded ? 'first_hand' : 'new';
  return ORDER.indexOf(tallied) >= ORDER.indexOf(floor) ? tallied : floor;
}
