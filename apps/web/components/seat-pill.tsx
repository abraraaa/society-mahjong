import type { Meld, Wind } from '@society/engine';
import { Tile, type TileSize } from './tile';

/**
 * One opponent's presence at the table: wind, name, hidden-tile count, and
 * any melds they've shown. `orientation="column"` is the tablet side-seat
 * card, which has the room to draw the concealed hand as a stack of pips;
 * `orientation="row"` is the compact phone/tablet-top chip, which shows the
 * count as a number instead.
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
}: {
  wind: Wind;
  name: string;
  concealedCount: number;
  melds: readonly Meld[];
  isTurn: boolean;
  orientation?: 'row' | 'column';
}) {
  const isColumn = orientation === 'column';
  const setSize: TileSize = isColumn ? 'sm' : '2xs';

  return (
    <div className={`seat${isTurn ? ' is-turn' : ''}${isColumn ? ' is-column' : ''}`}>
      <span className="wind">{wind}</span>
      <span className="name">{name}</span>
      {!isColumn && <span className="held">{concealedCount}</span>}
      {isColumn && concealedCount > 0 && (
        <span className="pips">
          {Array.from({ length: concealedCount }, (_, i) => (
            <span key={i} className="bg-felt-800 h-3.5 w-5 rounded-sm shadow-[0_1px_2px_rgb(0_0_0/0.4)]" />
          ))}
        </span>
      )}
      {melds.length > 0 && (
        <span className="sets">
          {melds.map((m, mi) => (
            <SetGlyph key={mi} meld={m} size={setSize} />
          ))}
        </span>
      )}
    </div>
  );
}

/** A pung or kong reads from one tile; anything mixed has to show its tiles. */
function SetGlyph({ meld, size }: { meld: Meld; size: TileSize }) {
  const first = meld.tiles[0];
  const uniform = first !== undefined && meld.tiles.every((t) => t === first);
  if (!uniform) {
    return (
      <span className="meld">
        {meld.tiles.map((k, i) => (
          <Tile key={i} kind={k} size={size} />
        ))}
      </span>
    );
  }
  return (
    <span className="meld">
      <Tile kind={first} size={size} />
      {meld.tiles.length === 4 && <i>4</i>}
    </span>
  );
}
