'use client';
import { tileName, type TileKind } from '@society/engine';

export type TileSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/**
 * A physical tile. Faces are the SVG glyph set in `/public/tiles`; a tile
 * with no `kind` (or `back`) renders the felt-and-back-pattern face used for
 * opponents' concealed tiles and the wall.
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
  /** rotate 90° for a tablet opponent's melds */
  rotate?: boolean | undefined;
  onClick?: (() => void) | undefined;
  className?: string | undefined;
}) {
  const showFace = !back && kind;
  return (
    <button
      type="button"
      className={`tile tile-${size}${className ? ` ${className}` : ''}`}
      data-selectable={selectable ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      data-back={back ? 'true' : undefined}
      data-dim={dim ? 'true' : undefined}
      data-claimable={claimable ? 'true' : undefined}
      data-coached={coached ? 'true' : undefined}
      data-fresh={fresh ? 'true' : undefined}
      data-rotate={rotate ? 'true' : undefined}
      aria-label={kind ? tileName(kind) : 'hidden tile'}
      onClick={onClick}
      disabled={!selectable}
    >
      {showFace && <img src={`/tiles/${kind}.svg`} alt="" />}
    </button>
  );
}
