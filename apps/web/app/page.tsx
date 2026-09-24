import type { Metadata } from 'next';
import Link from 'next/link';
import { HeroTiles } from '@/components/hero-tiles';
import { JoinForm } from '@/components/join-form';

export const metadata: Metadata = {
  // Absolute, so the front door is not titled "Society Mahjong … · Society Mahjong".
  title: { absolute: 'Society Mahjong · A private table for four' },
  description: 'Host a private mahjong table, send friends the link and play on your phones. Karachi rules, no sign-up, bots for empty seats and a tutor for new players.',
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
        <p className="lede">A private table for your friends. The tutor suggests each discard and says why.</p>
      </header>

      <HeroTiles />

      <nav className="actions">
        <Link href="/room" className="btn btn-primary btn-block min-h-[52px] text-[18px]">
          Host a table
        </Link>
        <p className="hint">Karachi rules, no sign-up. Need a fourth? A bot sits in.</p>
        <JoinForm />
        <Link href="/rules" className="link-quiet">
          How to play
        </Link>
        <Link href="/play/solo" className="link-quiet">
          Practise on the bots
        </Link>
      </nav>
    </main>
  );
}
