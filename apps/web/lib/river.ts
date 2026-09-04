import type { HandState, Seat, TileKind } from '@society/engine';

export interface RiverTile {
  readonly seat: Seat;
  readonly kind: TileKind;
}

/** Both of the reducer's paths that take a discard back off the table. */
function takenBy(ev: HandState['events'][number]): Seat | undefined {
  // A pung, chow or kong off the discard.
  if (ev.type === 'claimed') return ev.data?.['from'] as Seat | undefined;
  // A win off the discard: the reducer removes the tile there too, but the
  // event it emits is `won`, and the discarder is only named when the win was
  // not self-drawn.
  if (ev.type === 'won') return ev.data?.['discarder'] as Seat | undefined;
  return undefined;
}

/**
 * The river in the order it was actually discarded.
 *
 * `players[].discards` is per-seat, so reading it in seat order gives four
 * blocks rather than a table — and on a phone the only part of the river
 * anyone reads closely is the recent end. The event log is the one place the
 * global order survives; a tile that is taken off the discard leaves the
 * river, so those events pop the discarder's last entry, exactly as the
 * reducer does.
 */
export function riverOrder(state: HandState): RiverTile[] {
  const out: RiverTile[] = [];
  for (const ev of state.events) {
    if (ev.type === 'discarded' && ev.seat !== undefined && ev.tile !== undefined) {
      out.push({ seat: ev.seat, kind: ev.tile });
      continue;
    }
    const from = takenBy(ev);
    if (from === undefined) continue;
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i]!.seat === from) {
        out.splice(i, 1);
        break;
      }
    }
  }
  return out;
}
