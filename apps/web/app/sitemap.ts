import type { MetadataRoute } from 'next';

/** The two pages search should know; everything else is behind a link or a deal. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: 'https://societymahjong.app/', changeFrequency: 'monthly', priority: 1 },
    { url: 'https://societymahjong.app/rules', changeFrequency: 'monthly', priority: 0.8 },
  ];
}
