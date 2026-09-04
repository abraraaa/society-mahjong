import Link from 'next/link';
import { JoinForm } from '@/components/join-form';

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-between px-6 py-10">
      <header className="space-y-3 pt-11">
        <p className="eyebrow">Society</p>
        <h1 className="font-display text-5xl leading-none text-ivory-50">Mahjong</h1>
        <p className="text-ivory-200/80 text-base leading-normal">
          Mahjong with your friends, wherever they are. Any table&rsquo;s rules, and a tutor who sits with you for your first rounds.
        </p>
      </header>
      <nav className="space-y-4">
        <div className="space-y-2">
          <Link href="/room" className="block rounded-2xl bg-ivory-50 px-5 py-4 text-center text-lg font-medium text-ink-900 shadow-lg transition hover:translate-y-[-1px]">
            Host a table
          </Link>
          <p className="text-center text-sm text-ivory-200/60">Get a code, send the link, bots fill any empty seats.</p>
        </div>
        <JoinForm />
        <div className="space-y-2 pt-2">
          <Link href="/play/solo" className="block text-center text-base text-ivory-100/90 underline decoration-ivory-200/40 underline-offset-4">
            Or play your first hand alone
          </Link>
          <p className="text-center text-sm text-ivory-200/60">Three bots, Karachi rules, no sign-in needed.</p>
        </div>
      </nav>
    </main>
  );
}
