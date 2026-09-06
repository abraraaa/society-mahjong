import type { MetadataRoute } from 'next';

/**
 * Served at /manifest.webmanifest; Next links it from every page. Android and
 * desktop Chrome will not offer "install" without it (iOS reads the apple-*
 * tags in layout.tsx instead, so short_name and appleWebApp.title must agree).
 * `id` names the app to the phone: change it and an installed copy becomes a
 * stranger. The icons are cached immutable, so new art needs a new filename.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: 'https://societymahjong.app/',
    name: 'Society Mahjong',
    short_name: 'Society',
    description: 'Karachi mahjong with friends, on your phone.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'browser'],
    background_color: '#0b2a26',
    theme_color: '#0b2a26',
    lang: 'en',
    categories: ['games', 'entertainment'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Full-bleed felt with the tile inside the safe circle, for launchers that cut their own shape.
      { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    // What Chrome's richer install sheet shows; sizes must match the PNGs exactly.
    screenshots: [
      { src: '/screenshots/landing-narrow.png', sizes: '390x844', type: 'image/png', form_factor: 'narrow', label: 'Host a table or join one with a code' },
      { src: '/screenshots/table-wide.png', sizes: '1280x800', type: 'image/png', form_factor: 'wide', label: 'A hand at the table' },
    ],
  };
}
