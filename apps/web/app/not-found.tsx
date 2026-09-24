import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Page not found' };

/** A mistyped or stale link: still a 404 to search, but a way back for a person. */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-10">
      <div className="space-y-2">
        <p className="eyebrow">Not found</p>
        <h1 className="font-display text-3xl">There&apos;s nothing at this address.</h1>
        <p className="text-ivory-200/70 text-sm">If a friend sent you a table link, check it with them. Or start a table of your own.</p>
      </div>
      <div className="flex flex-col items-center gap-3">
        <Link href="/room" className="btn btn-primary btn-block min-h-[52px] text-[18px]">
          Host a table
        </Link>
        <Link href="/" className="link-quiet">
          Society Mahjong home
        </Link>
        <Link href="/rules" className="link-quiet">
          How to play
        </Link>
      </div>
    </main>
  );
}
