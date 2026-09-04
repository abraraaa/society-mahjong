'use client';
import { useEffect, useRef } from 'react';
import type { TileKind } from '@society/engine';
import { Tile } from './tile';
import type { RiverTile } from '@/lib/river';

/** Past this many tiles the river drops a size rather than a row. */
const DENSE_FROM = 20;
/** How close to the newest end still counts as "following the river". */
const PIN_SLACK = 24;

/**
 * The discard river. Chronological, newest last, and pinned to the newest
 * unless the player has scrolled back to look — the front of the queue is
 * what a claim decision turns on.
 *
 * `highlight` is the tile currently picked up in the hand: everything else
 * fades, which turns the river into a straight answer to "is the tile I need
 * already dead?" without a second screen or a sort that loses the order.
 */
export function River({ tiles, claimable, highlight }: { tiles: readonly RiverTile[]; claimable: boolean; highlight: TileKind | null }) {
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const count = tiles.length;
  const dense = count > DENSE_FROM;

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => {
      pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < PIN_SLACK;
      if (el.scrollTop > 4) el.dataset['above'] = 'true';
      else delete el.dataset['above'];
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    // The river also has to re-pin when it is the box that changed: the coach
    // bubble appearing takes 60-odd pixels out of the felt, and without this
    // the newest discard silently slides under the fold.
    const ro = new ResizeObserver(() => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
      onScroll();
    });
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (pinned.current) el.scrollTop = el.scrollHeight;
    if (el.scrollTop > 4) el.dataset['above'] = 'true';
    else delete el.dataset['above'];
  }, [count, dense]);

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
