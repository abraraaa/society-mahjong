import Link from 'next/link';
import { JoinForm } from './join-form';
import { isRoomCode } from '@/lib/room-code';

const COPY = {
  'no-table': { heading: "There's no table with that code.", line: 'Check it with whoever sent you the link.' },
  closed: { heading: 'This table has closed.', line: 'Ask the host for a new link.' },
} as const;

/**
 * An invite link that leads nowhere, said before it asks for a name: no table
 * has that code, or the table has closed to newcomers. A box to try another
 * code, and a way home.
 */
export function NoTable({ code, reason }: { code: string; reason: keyof typeof COPY }) {
  const { heading, line } = COPY[reason];
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-10">
      <div className="space-y-2">
        {/* Only a code this app could have issued is repeated back; anything else in the address stays off the page. */}
        <p className="eyebrow">{isRoomCode(code) ? `Table ${code}` : 'Join a table'}</p>
        <h1 className="font-display text-3xl">{heading}</h1>
        <p className="text-ivory-200/70 text-sm">{line}</p>
      </div>
      <div className="flex flex-col items-center gap-4">
        <div className="w-full">
          <JoinForm />
        </div>
        <Link href="/" className="link-quiet">
          Back to the start
        </Link>
      </div>
    </main>
  );
}
