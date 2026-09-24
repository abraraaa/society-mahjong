import { OG_SIZE, ogCard } from '@/lib/og';
import { isRoomCode } from '@/lib/room-code';

export const alt = 'Join my mahjong table';
export const size = OG_SIZE;
export const contentType = 'image/png';

export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const upper = code.toUpperCase();
  // The code never breaks across lines; a path that is not a real code gets the plain card.
  return ogCard(isRoomCode(upper) ? ['Table', upper] : 'Mahjong', 'Give a name and take your seat. New players get a tutor.');
}
