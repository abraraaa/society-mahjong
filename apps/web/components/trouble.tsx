'use client';
import Link from 'next/link';

/**
 * The screen for when a table could not be reached: what went wrong, a way to
 * try again, and a way home. Used by the host, lobby and live-table pages while
 * they are still finding their feet; a message alone leaves someone stuck.
 */
export function Trouble({ message, onRetry, retryLabel = 'Try again' }: { message: string; onRetry: () => void; retryLabel?: string }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6">
      <p className="font-display text-2xl">Hmm.</p>
      <p className="text-ivory-200/70 text-center text-sm">{message}</p>
      <div className="mt-4 flex w-full flex-col items-center gap-3">
        <button type="button" className="btn btn-primary btn-block min-h-[52px] text-[18px]" onClick={onRetry}>
          {retryLabel}
        </button>
        <Link href="/" className="link-quiet">
          Back to the front
        </Link>
      </div>
    </main>
  );
}

/** The screen shown while a table is still being reached. */
export function Waiting({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6">
      <p className="font-display text-2xl">{children}</p>
    </main>
  );
}
