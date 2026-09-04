'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TileKind } from '@society/engine';
import { Tile } from './tile';
import type { RiverTile } from '@/lib/river';

/** Mirrors --tile-sm-w / --tile-sm-h / --river-gap in globals.css. */
const SM_W = 36;
const SM_H = 50;
const GAP = 4;
/** How close to the newest end still counts as "following the river". */
const PIN_SLACK = 24;

/** The fade at the top only earns its place once something is actually above. */
function syncAbove(el: HTMLDivElement) {
  if (el.scrollTop > 4) el.dataset['above'] = 'true';
  else delete el.dataset['above'];
}

/** How many tiles the felt can hold at the full river size. */
function capacityOf(el: HTMLDivElement) {
  const cols = Math.max(1, Math.floor((el.clientWidth + GAP) / (SM_W + GAP)));
  const rows = Math.max(1, Math.floor((el.clientHeight + GAP) / (SM_H + GAP)));
  return cols * rows;
}

/**
 * The discard river. Chronological, newest last, and pinned to the newest
 * unless the player has scrolled back to look — the front of the queue is
 * what a claim decision turns on.
 *
 * `highlight` is the tile currently picked up in the hand: everything else
 * fades, which turns the river into a straight answer to "is the tile I need
 * already dead?" without a second screen or a sort that loses the order.
 *
 * Density is a question about room, not about count: 21 discards crowd a
 * phone and rattle around a tablet, so the step down to the smaller tile
 * happens when the felt actually runs out. It latches for the rest of the
 * hand — a river that changes size every time the coach comes and goes is
 * harder to read than one that is a size too small.
 */
export function River({ tiles, claimable, highlight }: { tiles: readonly RiverTile[]; claimable: boolean; highlight: TileKind | null }) {
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  /** Once the river has outgrown the felt it stays small until the next hand. */
  const latched = useRef(false);
  const count = tiles.length;
  const [dense, setDense] = useState(false);

  const settle = useCallback(
    (el: HTMLDivElement) => {
      if (count === 0) latched.current = false;
      else latched.current = latched.current || count > capacityOf(el);
      setDense(latched.current);
    },
    [count],
  );

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => {
      pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < PIN_SLACK;
      syncAbove(el);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    // The river also has to re-pin when it is the box that changed: the coach
    // bubble appearing takes 60-odd pixels out of the felt, and without this
    // the newest discard silently slides under the fold.
    const ro = new ResizeObserver(() => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
      onScroll();
      settle(el);
    });
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
    // `settle` closes over the current count, so the observer is rebound with it
  }, [settle]);

  // Layout, not effect: at a discard every 450ms an effect-timed scroll paints
  // one frame at the old position, which reads as the river twitching.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    settle(el);
    if (pinned.current) el.scrollTop = el.scrollHeight;
    syncAbove(el);
  }, [settle, dense]);

  return (
    <div className="river-scroll" ref={scroller} data-empty={count === 0 ? 'true' : undefined}>
      {count === 0 ? (
        <p className="label">No discards yet</p>
      ) : (
        <div className="river" data-dense={dense ? 'true' : undefined}>
          {tiles.map((t, i) => {
            const last = i === count - 1;
            return (
              <Tile
                key={`${t.seat}-${i}-${t.kind}`}
                kind={t.kind}
                size={dense ? 'xs' : 'sm'}
                claimable={claimable && last}
                latest={!claimable && last}
                dim={highlight !== null && t.kind !== highlight}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
