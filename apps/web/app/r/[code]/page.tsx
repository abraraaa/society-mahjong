import type { Metadata } from 'next';
import { RoomLobby } from './room-lobby';
import { NoTable } from '@/components/no-table';
import { frontDoor } from '@/lib/front-door';
import { currentUser } from '@/lib/live/auth';
import { roomByCode } from '@/lib/live/store';
import { isRoomCode } from '@/lib/room-code';
import { supabaseServiceKey, supabaseUrl } from '@/lib/supabase/env';

export const dynamic = 'force-dynamic';

/** What the link says before anyone taps it: the code, and what happens next. */
export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  const upper = code.toUpperCase();
  const description = 'Give a name and take your seat. No sign-up. Karachi rules, and a tutor for new players.';
  // Only a code this app could have issued goes on the card; anything else gets a plain invite and no og:url.
  if (!isRoomCode(upper)) {
    const title = 'Join a mahjong table';
    return {
      title,
      description,
      openGraph: { siteName: 'Society Mahjong', type: 'website', locale: 'en_GB', title, description },
      twitter: { card: 'summary_large_image', title, description },
      robots: { index: false, follow: false },
    };
  }
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

/**
 * The code is checked before the lobby asks for a name or runs the captcha, so
 * a mistyped or dead link says so at once instead of after the name gate.
 *
 * This reveals whether a code exists without a captcha. The join endpoint
 * already reveals it after one captcha, so little is given away; what stops
 * someone guessing codes is rate limiting, and that belongs at the edge.
 */
export default async function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const upper = code.toUpperCase();
  const door = await frontDoor(upper, {
    configured: !!supabaseUrl() && !!supabaseServiceKey(),
    // Read-only, with the service role: the visitor may have no session yet. A failed read
    // throws; frontDoor then opens the lobby and the join has the final say.
    room: roomByCode,
    userId: async () => (await currentUser())?.id ?? null,
  });
  if (door !== 'lobby') return <NoTable code={upper} reason={door} />;
  return <RoomLobby code={upper} />;
}
