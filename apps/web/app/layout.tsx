import type { Metadata, Viewport } from 'next';
import { Fraunces, Inter } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-fraunces', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL('https://societymahjong.app'),
  title: { default: 'Society Mahjong', template: '%s · Society Mahjong' },
  description: 'Karachi mahjong on your phone. A private table for you and your friends, wherever they are, and a tutor who sits with you for your first hands.',
  openGraph: { siteName: 'Society Mahjong', type: 'website', locale: 'en_GB' },
  twitter: { card: 'summary_large_image' },
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Society' },
  // The front door and the rules are for search; the lobby, tables and solo deal opt out on their own pages.
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#0b2a26',
  viewportFit: 'cover',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body className="min-h-dvh">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
