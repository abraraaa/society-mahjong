'use client';
import { tileName, type TileKind } from '@society/engine';

export type TileSize = '2xs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/** Custom properties are not part of React's CSSProperties, so name the one we set. */
type TileStyle = React.CSSProperties & { '--tile-face'?: string };

/**
 * A physical tile. Faces are the SVG glyph set in `/public/tiles`, painted as
 * a background layer (see `.tile` in globals.css); a tile with no `kind` (or
 * `back`) renders the felt-and-back-pattern face used for opponents'
 * concealed tiles and the wall.
 */
export function Tile({
  kind,
  size = 'md',
  selectable,
  selected,
  back,
  dim,
  claimable,
  coached,
  fresh,
  latest,
  rotate,
  onClick,
  className,
}: {
  kind?: TileKind | undefined;
  size?: TileSize | undefined;
  selectable?: boolean | undefined;
  selected?: boolean | undefined;
  back?: boolean | undefined;
  /** faded, e.g. a coach bubble greying out tiles that aren't part of the tip */
  dim?: boolean | undefined;
  /** outlined and gently pulsing — a discard you can act on */
  claimable?: boolean | undefined;
  /** gold glow — the tile the coach is pointing at */
  coached?: boolean | undefined;
  /** just-drawn tile, offset from the rest of the rail */
  fresh?: boolean | undefined;
  /** the newest tile in the river, so the eye can find the front of the queue */
  latest?: boolean | undefined;
  /** rotate 90° for a tablet opponent's melds */
  rotate?: boolean | undefined;
  onClick?: (() => void) | undefined;
  className?: string | undefined;
}) {
  const face: TileStyle | undefined = !back && kind ? { '--tile-face': `url("/tiles/${kind}.svg")` } : undefined;
  return (
    <button
      type="button"
      className={`tile tile-${size}${className ? ` ${className}` : ''}`}
      style={face}
      data-selectable={selectable ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      data-back={back ? 'true' : undefined}
      data-dim={dim ? 'true' : undefined}
      data-claimable={claimable ? 'true' : undefined}
      data-coached={coached ? 'true' : undefined}
      data-fresh={fresh ? 'true' : undefined}
      data-latest={latest ? 'true' : undefined}
      data-rotate={rotate ? 'true' : undefined}
      aria-label={kind ? tileName(kind) : 'hidden tile'}
      onClick={onClick}
      disabled={!selectable}
    />
  );
}
