import { countOf, isDragonTile, isWindTile, tileName, type TileKind } from '@society/engine';

export interface TutorTip {
  /** the tile the tip is pointing at, so the caller can highlight it in the hand rail */
  readonly tile: TileKind;
  readonly message: React.ReactNode;
}

/**
 * A small, honest slice of the coach layer described in docs/PLAN.md — not
 * the engine-grounded analysis planned for M3, just one rule everyone
 * learns early: a lone wind or dragon can only ever complete a set, so
 * holding exactly one is usually dead weight. Silent (returns null) rather
 * than guess when that isn't true.
 */
export function suggestDiscard(hand: readonly TileKind[]): TutorTip | null {
  const lone = hand.find((k) => (isWindTile(k) || isDragonTile(k)) && countOf(hand, k) === 1);
  if (!lone) return null;
  const family = isWindTile(lone) ? 'winds' : 'dragons';
  // Short on purpose: the bubble is clamped to three lines on a phone, and the
  // tile's name has to survive to the end of the sentence.
  return {
    tile: lone,
    message: (
      <>
        Lone {family} are dead weight — they only score in sets. <b>Discard {tileName(lone)}</b>.
      </>
    ),
  };
}
