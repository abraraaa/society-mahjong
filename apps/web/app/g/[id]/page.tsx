import type { Metadata, Viewport } from 'next';
import { LiveTable } from './live-table';

export const dynamic = 'force-dynamic';
/** A table is for the people holding the link, not for search. */
export const metadata: Metadata = { title: 'At the table', robots: { index: false, follow: false } };
/** The table keeps pinch-zoom off so a stray gesture never rescales the tiles; reading pages stay zoomable. */
export const viewport: Viewport = { maximumScale: 1 };

export default async function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LiveTable gameId={id} />;
}
