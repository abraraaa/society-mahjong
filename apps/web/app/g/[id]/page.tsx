import type { Metadata } from 'next';
import { LiveTable } from './live-table';

export const dynamic = 'force-dynamic';
/** A table is for the people holding the link, not for search. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LiveTable gameId={id} />;
}
