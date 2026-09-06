import type { Metadata } from 'next';
import { SoloTable } from './solo-table';
import { newDealSeed } from '@/lib/seed';

/** The deal is random per visit, so there is nothing worth prerendering, and nothing for search to keep. */
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Play a hand', robots: { index: false, follow: false } };

export default function SoloPage() {
  return <SoloTable seed={newDealSeed()} />;
}
