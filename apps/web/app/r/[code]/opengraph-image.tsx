import { OG_SIZE, ogCard } from '@/lib/og';

export const alt = 'Join my mahjong table';
export const size = OG_SIZE;
export const contentType = 'image/png';

export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return ogCard(`Table ${code.toUpperCase()}`, 'Give a name and take your seat. New players get a tutor.');
}
