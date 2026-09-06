import { ImageResponse } from 'next/og';

export const OG_SIZE = { width: 1200, height: 630 };

/** The red dragon tile, drawn the way the app draws it, at a size a link card can read. */
function DragonTile({ height }: { height: number }) {
  const w = Math.round(height * (60 / 84));
  const r = Math.round(height * 0.085);
  return (
    <div style={{ display: 'flex', position: 'relative', width: w, height, borderRadius: r, background: '#e6dbc2' }}>
      <div style={{ display: 'flex', position: 'absolute', top: 0, left: 0, width: w, height: Math.round(height * 0.94), borderRadius: r, background: '#fbf7ee' }} />
      <svg style={{ position: 'absolute', top: 0, left: 0 }} width={w} height={height} viewBox="0 0 60 84">
        <path d="M16 22 H44 V54 H16 Z M30 8 V76" fill="none" stroke="#b3352d" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/**
 * One card for every link that gets shared: the tile, the name, and one line.
 * WhatsApp and iMessage show this before anyone has opened anything, so it
 * is the first thing a friend sees of the table.
 */
export function ogCard(headline: string, line: string): ImageResponse {
  return new ImageResponse(
    (
      <div style={{ display: 'flex', width: '100%', height: '100%', background: '#0b2a26', color: '#fbf7ee', alignItems: 'center', padding: '0 96px', fontFamily: 'sans-serif' }}>
        <DragonTile height={360} />
        <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 88, flex: 1 }}>
          <div style={{ display: 'flex', fontSize: 30, letterSpacing: 6, textTransform: 'uppercase', color: 'rgba(243,236,219,0.55)' }}>Society Mahjong</div>
          <div style={{ display: 'flex', fontSize: 96, fontWeight: 600, lineHeight: 1.05, marginTop: 18, letterSpacing: -2 }}>{headline}</div>
          <div style={{ display: 'flex', fontSize: 36, marginTop: 28, color: 'rgba(243,236,219,0.8)', lineHeight: 1.3 }}>{line}</div>
        </div>
      </div>
    ),
    OG_SIZE,
  );
}
