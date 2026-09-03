import type { Meld, Wind } from '@society/engine';
import { Tile, type TileSize } from './tile';

/** Decorative pip count for a row chip — capped so it never crowds a 28px-tall pill. */
const ROW_PIP_CAP = 4;

/**
 * One opponent's presence at the table: wind, name, hidden-tile count, and
 * any melds they've shown. `orientation="column"` is the tablet side-seat
 * card (full pip stack, pips laid on their side); `orientation="row"` is the
 * compact phone/tablet-top chip (pips upright, in a line).
 */
export function SeatPill({
  wind,
  name,
  concealedCount,
  melds,
  isTurn,
  orientation = 'row',
  meldTileSize = 'xs',
  rotateMelds,
}: {
  wind: Wind;
  name: string;
  concealedCount: number;
  melds: readonly Meld[];
  isTurn: boolean;
  orientation?: 'row' | 'column';
  meldTileSize?: TileSize;
  rotateMelds?: boolean;
}) {
  const pipCount = orientation === 'column' ? concealedCount : Math.min(concealedCount, ROW_PIP_CAP);

  return (
    <div className={`seat${isTurn ? ' is-turn' : ''}${orientation === 'column' ? ' is-column' : ''}`}>
      <span className="wind">{wind}</span>
      <span className={orientation === 'column' ? 'text-center' : 'flex-1'}>
        {name} · {concealedCount}
      </span>
      {pipCount > 0 && (
        <span className="pips">
          {Array.from({ length: pipCount }, (_, i) =>
            orientation === 'column' ? (
              <span key={i} className="h-3.5 w-5 rounded-sm bg-felt-800 shadow-[0_1px_2px_rgb(0_0_0/0.4)]" />
            ) : (
              <span key={i} className="h-5 w-3.5 rounded-sm bg-felt-800 shadow-[0_1px_2px_rgb(0_0_0/0.4)]" />
            ),
          )}
        </span>
      )}
      {melds.length > 0 && (
        <span className="meld">
          {melds.flatMap((m, mi) => m.tiles.map((k, ti) => <Tile key={`${mi}-${ti}`} kind={k} size={meldTileSize} rotate={rotateMelds} />))}
        </span>
      )}
    </div>
  );
}
