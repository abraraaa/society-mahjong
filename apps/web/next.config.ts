import type { NextConfig } from 'next';

const SITE = 'https://societymahjong.app';

/**
 * On every response. The CSP is frame-ancestors only: a full policy would
 * have to name hCaptcha and Supabase (script, frame, connect, wss) and nonce
 * the RSC inline scripts, which costs the static pages their prerender.
 */
const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
];

/** A year, immutable: a changed tile or icon must get a new filename, or phones keep the old one. */
const IMMUTABLE = [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }];
/** The install-sheet screenshots are retaken under the same names as the UI changes: a day, then quietly refresh. */
const DAILY = [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' }];

const nextConfig: NextConfig = {
  transpilePackages: ['@society/engine'],
  reactStrictMode: true,
  poweredByHeader: false,
  headers: async () => [
    { source: '/(.*)', headers: SECURITY_HEADERS },
    { source: '/tiles/:path*', headers: IMMUTABLE },
    { source: '/icons/:path*', headers: IMMUTABLE },
    { source: '/screenshots/:path*', headers: DAILY },
  ],
  redirects: async () => [
    // The bare Vercel alias serves the same site; search and shared links should know one host.
    // Exact host only, previews live on other *.vercel.app names. /api stays put: Vercel Cron
    // calls the deployment directly, and a cross-host redirect would drop its bearer token.
    {
      source: '/:path((?!api/).*)',
      has: [{ type: 'host', value: 'society-mahjong.vercel.app' }],
      destination: `${SITE}/:path`,
      permanent: true,
    },
  ],
};

export default nextConfig;
