import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://societymahjong.app'),
  title: 'Society Mahjong',
  description: 'Social mahjong for phones and tablets. Play any table\'s rules with friends anywhere.',
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
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
