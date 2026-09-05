import type { Metadata } from 'next';
import { RoomLobby } from './room-lobby';

export const dynamic = 'force-dynamic';

/** What the link says before anyone taps it: the code, and what happens next. */
export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  const upper = code.toUpperCase();
  const description = 'Tap the link, give a name, sit down. Karachi rules, and a tutor who sits with first-timers.';
  return {
    title: `Join table ${upper}`,
    description,
    openGraph: { title: `Join my mahjong table · ${upper}`, description },
    twitter: { card: 'summary_large_image', title: `Join my mahjong table · ${upper}`, description },
  };
}

export default async function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <RoomLobby code={code.toUpperCase()} />;
}
