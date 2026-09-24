import { OG_SIZE, ogCard } from '@/lib/og';

export const alt = 'Society Mahjong: a red dragon tile on felt';
export const size = OG_SIZE;
export const contentType = 'image/png';

export default function Image() {
  return ogCard('Mahjong', 'A private table for your friends.');
}
