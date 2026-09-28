import { memo } from 'react';
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
 *
 * A seat a bot plays says so after the name ("Sana · bot"), and the marker
 * stays whole when a long name has to be cut short. The row pill gives the
 * name its whole first line, with the score below beside the tile count
 * (globals.css), so the name still shows next to a four-digit score.
 */
export const SeatPill = memo(function SeatPill({
  wind,
  name,
  concealedCount,
  melds,
  isTurn,
  orientation = 'row',
  score,
  clock,
  urgent,
  mark,
}: {
  wind: Wind;
  name: string;
  concealedCount: number;
  melds: readonly Meld[];
  isTurn: boolean;
  orientation?: 'row' | 'column';
  /** running total, shown signed; omitted when the table keeps no score */
  score?: string;
  /** time left on this seat's turn, "1:12"; live tables only */
  clock?: string | undefined;
  /** under twenty seconds: the clock turns brass and pulses */
  urgent?: boolean | undefined;
  /** what plays the seat when a person doesn't: shown after the name; live tables only */
  mark?: 'bot' | 'away' | undefined;
}) {
  const isColumn = orientation === 'column';
  const setSize: TileSize = isColumn ? 'sm' : '2xs';

  return (
    <div className={`seat${isTurn ? ' is-turn' : ''}${isColumn ? ' is-column' : ''}`}>
      <span className="wind">{wind}</span>
      {/* Never wider than the pill, even centred in the tablet's side seat, so a long name is cut short and the marker stays whole. */}
      <span className="name flex max-w-full min-w-0 items-baseline gap-1">
        <span className="truncate">{name}</span>
        {mark && (
          <small className="flex-none text-[10px] opacity-60">
            {' '}
            <span aria-hidden="true">· </span>
            {mark}
          </small>
        )}
      </span>
      {score !== undefined && <span className="score">{score}</span>}
      {!isColumn && (
        <span className="held">
          {clock && (
            <b className="clock" data-urgent={urgent || undefined}>
              {clock}
            </b>
          )}
          {concealedCount}
        </span>
      )}
      {isColumn && clock && (
        <span className="clock" data-urgent={urgent || undefined}>
          {clock}
        </span>
      )}
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
});

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
