import type { MetadataRoute } from 'next';

/**
 * The two pages search should know; everything else is behind a link or a deal.
 * lastModified is set by hand when that page's words change, never to "now":
 * Google trusts lastmod only while it stays accurate, and ignores changefreq and priority.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: 'https://societymahjong.app/', lastModified: '2026-09-24' },
    { url: 'https://societymahjong.app/rules', lastModified: '2026-09-24' },
  ];
}
