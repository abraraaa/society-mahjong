import type { HandState, Seat, TileKind } from '@society/engine';

export interface RiverTile {
  readonly seat: Seat;
  readonly kind: TileKind;
}

/**
 * The river in the order it was actually discarded.
 *
 * `players[].discards` is per-seat, so reading it in seat order gives four
 * blocks rather than a table — and on a phone the only part of the river
 * anyone reads closely is the recent end. The event log is the one place the
 * global order survives; a claimed tile leaves the river, which is why a
 * `claimed` event pops the discarder's last entry, exactly as the reducer does.
 */
export function riverOrder(state: HandState): RiverTile[] {
  const out: RiverTile[] = [];
  for (const ev of state.events) {
    if (ev.type === 'discarded' && ev.seat !== undefined && ev.tile !== undefined) {
      out.push({ seat: ev.seat, kind: ev.tile });
    } else if (ev.type === 'claimed') {
      const from = ev.data?.['from'] as Seat | undefined;
      for (let i = out.length - 1; i >= 0; i--) {
        if (out[i]!.seat === from) {
          out.splice(i, 1);
          break;
        }
      }
    }
  }
  return out;
}
