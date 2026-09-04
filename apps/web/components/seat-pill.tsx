import type { Meld, Wind } from '@society/engine';
import { Tile, type TileSize } from './tile';

/** Decorative pip count for a row chip — capped so it never crowds a 28px-tall pill. */
const ROW_PIP_CAP = 4;

/**
 * One opponent's presence at the table: wind, name, hidden-tile count, and
 * any melds they've shown. `orientation="column"` is the tablet side-seat
 * card (full pip stack, pips laid on their side); `orientation="row"` is the
 * compact phone/tablet-top chip.
 *
 * A row pill has to survive three-to-a-phone-width with four sets down, so it
 * summarises each meld as a single tile (plus a 4 for a kong) rather than
 * laying every tile out — the suit an opponent is chasing is the part that
 * changes how you play, and the full strip is what used to run off both edges.
 */
export function SeatPill({
  wind,
  name,
  concealedCount,
  melds,
  isTurn,
  orientation = 'row',
  meldTileSize,
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
  const isColumn = orientation === 'column';
  const pipCount = isColumn ? concealedCount : Math.min(concealedCount, ROW_PIP_CAP);
  const setSize: TileSize = meldTileSize ?? (isColumn ? 'sm' : '2xs');

  return (
    <div className={`seat${isTurn ? ' is-turn' : ''}${isColumn ? ' is-column' : ''}`}>
      <span className="wind">{wind}</span>
      <span className="name">{name}</span>
      {!isColumn && <span className="held">{concealedCount}</span>}
      {isColumn && pipCount > 0 && (
        <span className="pips">
          {Array.from({ length: pipCount }, (_, i) => (
            <span key={i} className="bg-felt-800 h-3.5 w-5 rounded-sm shadow-[0_1px_2px_rgb(0_0_0/0.4)]" />
          ))}
        </span>
      )}
      {melds.length > 0 && (
        <span className="sets">
          {melds.map((m, mi) => (
            <SetGlyph key={mi} meld={m} size={setSize} rotate={rotateMelds} />
          ))}
        </span>
      )}
    </div>
  );
}

/** A pung or kong reads from one tile; anything mixed has to show its tiles. */
function SetGlyph({ meld, size, rotate }: { meld: Meld; size: TileSize; rotate?: boolean | undefined }) {
  const first = meld.tiles[0];
  const uniform = first !== undefined && meld.tiles.every((t) => t === first);
  if (!uniform) {
    return (
      <span className="meld">
        {meld.tiles.map((k, i) => (
          <Tile key={i} kind={k} size={size} rotate={rotate} />
        ))}
      </span>
    );
  }
  return (
    <span className="meld">
      <Tile kind={first} size={size} rotate={rotate} />
      {meld.tiles.length === 4 && <i>4</i>}
    </span>
  );
}
