import { LiveTable } from './live-table';

export const dynamic = 'force-dynamic';

export default async function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LiveTable gameId={id} />;
}
