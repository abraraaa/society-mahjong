import type { Metadata, Viewport } from 'next';
import { Fraunces, Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-fraunces', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL('https://societymahjong.app'),
  title: { default: 'Society Mahjong', template: '%s · Society Mahjong' },
  description: 'A table for you and your friends, wherever they are. Karachi rules first, and a tutor who sits with you for your first hands.',
  openGraph: { siteName: 'Society Mahjong', type: 'website', locale: 'en_GB' },
  twitter: { card: 'summary_large_image' },
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Mahjong' },
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
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
