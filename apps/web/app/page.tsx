import type { Metadata } from 'next';
import Link from 'next/link';
import { HeroTiles } from '@/components/hero-tiles';
import { JoinForm } from '@/components/join-form';

export const metadata: Metadata = {
  // Absolute, so the front door is not titled "Society Mahjong … · Society Mahjong".
  title: { absolute: 'Society Mahjong — Karachi rules, on your phone' },
  alternates: { canonical: '/' },
  // Next replaces a nested object whole, so the site fields from the root layout are repeated here.
  openGraph: { siteName: 'Society Mahjong', type: 'website', locale: 'en_GB', url: '/' },
};

/** What this is, for search engines and answer agents; the same facts as /llms.txt. */
const APP_LD = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'Society Mahjong',
  url: 'https://societymahjong.app/',
  applicationCategory: 'GameApplication',
  operatingSystem: 'iOS, Android, Web',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
};

export default function Home() {
  return (
    <main className="landing">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(APP_LD).replace(/</g, '\\u003c') }} />
      <header className="hero">
        <p className="eyebrow eyebrow-quiet">Society</p>
        <h1 className="font-display">Mahjong</h1>
        <p className="lede">A table for you and your friends, wherever they are. Karachi rules first, and a tutor who sits with you for your first hands.</p>
      </header>

      <HeroTiles />

      <nav className="actions">
        <Link href="/room" className="btn btn-primary btn-block min-h-[52px] text-[18px]">
          Host a table
        </Link>
        <p className="hint">You get a code. Friends open the link, give a name, and sit down. Bots take any empty seats.</p>
        <JoinForm />
        <Link href="/rules" className="link-quiet">
          How it plays
        </Link>
        <Link href="/play/solo" className="link-quiet">
          Or play a hand alone first
        </Link>
      </nav>
    </main>
  );
}
