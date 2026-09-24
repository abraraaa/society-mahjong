import type { Metadata, Viewport } from 'next';
import { SoloTable } from './solo-table';
import { newDealSeed } from '@/lib/seed';

/** The deal is random per visit, so there is nothing worth prerendering, and nothing for search to keep. */
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Practise on the bots',
  description: 'Practise a hand of mahjong against three bots, with a tutor that shows you what to throw and why.',
  robots: { index: false, follow: false },
};
/** The table keeps pinch-zoom off so a stray gesture never rescales the tiles; reading pages stay zoomable. */
export const viewport: Viewport = { maximumScale: 1 };

export default function SoloPage() {
  return <SoloTable seed={newDealSeed()} />;
}
