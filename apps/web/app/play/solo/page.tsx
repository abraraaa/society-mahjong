import { SoloTable } from './solo-table';
import { newDealSeed } from '@/lib/seed';

/** The deal is random per visit, so there is nothing worth prerendering. */
export const dynamic = 'force-dynamic';

export default function SoloPage() {
  return <SoloTable seed={newDealSeed()} />;
}
