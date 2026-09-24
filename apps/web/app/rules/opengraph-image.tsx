import { OG_SIZE, ogCard } from '@/lib/og';

export const alt = 'Society Mahjong: how to play, with a red dragon tile on felt';
export const size = OG_SIZE;
export const contentType = 'image/png';

/** The rules page sets its own openGraph, which drops the site card, so it carries its own. */
export default function Image() {
  return ogCard('How to play', 'Karachi rules, round by round.');
}
