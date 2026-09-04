import { Tile } from './tile';

/**
 * The landing page's one picture: a short wall of tile backs, and five tiles
 * face up in front of it, the way a set looks the moment it comes out of the
 * box. The back is the product's mark; the faces are one of each family plus
 * a wind and a dragon, so the set is recognisable at a glance.
 */
export function HeroTiles() {
  return (
    <div className="hero-tiles" aria-hidden="true">
      <div className="wall">
        {Array.from({ length: 9 }, (_, i) => (
          <Tile key={i} back size="sm" />
        ))}
      </div>
      <div className="fan">
        <Tile kind="WE" size="lg" />
        <Tile kind="s1" size="lg" />
        <Tile kind="m5" size="lg" />
        <Tile kind="p1" size="lg" />
        <Tile kind="DR" size="lg" />
      </div>
    </div>
  );
}
