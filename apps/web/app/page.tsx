import Link from 'next/link';

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-between px-6 py-10">
      <header className="space-y-3">
        <p className="text-brass-400 text-xs font-medium tracking-[0.3em] uppercase">Society</p>
        <h1 className="font-display text-5xl leading-none text-ivory-50">Mahjong</h1>
        <p className="text-ivory-200/80">Karachi rules, played with friends wherever they are. A tutor sits with you for your first rounds.</p>
      </header>
      <nav className="space-y-3">
        <Link
          href="/play/solo"
          className="block rounded-2xl bg-ivory-50 px-5 py-4 text-center text-lg font-medium text-ink-900 shadow-lg transition hover:translate-y-[-1px]"
        >
          Play your first hand
        </Link>
        <p className="text-center text-sm text-ivory-200/60">Three bots, Karachi rules, no sign-in needed.</p>
      </nav>
    </main>
  );
}
