import Link from 'next/link';
import { HeroTiles } from '@/components/hero-tiles';
import { JoinForm } from '@/components/join-form';

export default function Home() {
  return (
    <main className="landing">
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
        <Link href="/play/solo" className="link-quiet">
          Or play a hand alone first
        </Link>
      </nav>
    </main>
  );
}
