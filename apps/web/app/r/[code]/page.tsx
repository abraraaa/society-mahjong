import type { Metadata } from 'next';
import { RoomLobby } from './room-lobby';

export const dynamic = 'force-dynamic';

/** What the link says before anyone taps it: the code, and what happens next. */
export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  const upper = code.toUpperCase();
  const description = 'Give a name and take your seat. No sign-up. Karachi rules, and a tutor for new players.';
  return {
    title: `Join table ${upper}`,
    description,
    // Next replaces a nested object whole, so the site fields from the root layout are repeated here.
    openGraph: { siteName: 'Society Mahjong', type: 'website', locale: 'en_GB', url: `/r/${upper}`, title: `Join my mahjong table · ${upper}`, description },
    twitter: { card: 'summary_large_image', title: `Join my mahjong table · ${upper}`, description },
    // The link is for the friends who hold it; the preview still works without an index entry.
    robots: { index: false, follow: false },
  };
}

export default async function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <RoomLobby code={code.toUpperCase()} />;
}
