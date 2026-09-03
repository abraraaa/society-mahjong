'use client';
import { isSuitTile, numOf, suitOf, tileName, type TileKind } from '@society/engine';

/** Unicode mahjong glyphs as placeholder art until the SVG tile set lands. */
const GLYPH: Partial<Record<TileKind, string>> = {
  WE: '🀀', WS: '🀁', WW: '🀂', WN: '🀃', DR: '🀄', DG: '🀅', DW: '🀆',
  F1: '🀢', F2: '🀣', F3: '🀤', F4: '🀥', S1: '🀦', S2: '🀧', S3: '🀨', S4: '🀩',
};
const SUIT_BASE: Record<'m' | 'p' | 's', number> = { m: 0x1f007, s: 0x1f010, p: 0x1f019 };

export function glyphFor(kind: TileKind): string {
  if (isSuitTile(kind)) return String.fromCodePoint(SUIT_BASE[suitOf(kind)] + numOf(kind) - 1);
  return GLYPH[kind] ?? '🀫';
}

export function Tile({
  kind,
  selectable,
  selected,
  back,
  onClick,
}: {
  kind?: TileKind;
  selectable?: boolean;
  selected?: boolean;
  back?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className="tile"
      data-selectable={selectable ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      data-back={back ? 'true' : undefined}
      aria-label={kind ? tileName(kind) : 'hidden tile'}
      onClick={onClick}
      disabled={!selectable}
    >
      {back || !kind ? '' : glyphFor(kind)}
    </button>
  );
}
