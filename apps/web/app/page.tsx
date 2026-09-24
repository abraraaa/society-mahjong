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

/**
 * The site's name for Google's site-name system, and what the app is; the same
 * facts as /llms.txt. Never add ratings or reviews that are not real and on the page.
 */
const SITE_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebSite', '@id': 'https://societymahjong.app/#website', name: 'Society Mahjong', url: 'https://societymahjong.app/' },
    {
      '@type': 'WebApplication',
      '@id': 'https://societymahjong.app/#app',
      name: 'Society Mahjong',
      url: 'https://societymahjong.app/',
      applicationCategory: 'GameApplication',
      browserRequirements: 'Runs in a current web browser. Requires JavaScript.',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    },
  ],
};

export default function Home() {
  return (
    <main className="landing">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(SITE_LD).replace(/</g, '\\u003c') }} />
      <header className="hero">
        {/* One heading that reads "Society Mahjong", styled as the eyebrow over the word. */}
        <h1 className="font-display">
          <span className="eyebrow eyebrow-quiet">Society</span> Mahjong
        </h1>
        <p className="lede">A private table for your friends. The tutor shows new players what to throw and why.</p>
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
