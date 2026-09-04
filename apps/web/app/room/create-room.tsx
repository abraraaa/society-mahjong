'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { NameGate } from '@/components/name-gate';
import { ApiError, api } from '@/lib/live/client';
import { NeedsCaptcha, ensureSession, rememberName, storedName } from '@/lib/supabase/session';

/** Host a table: a name, a room, and straight to the lobby with a code to share. */
export function CreateRoom() {
  const router = useRouter();
  const [name, setName] = useState<string | null>(() => (typeof window === 'undefined' ? null : storedName()));
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!name) return;
    let cancelled = false;
    (async () => {
      try {
        await ensureSession(name, captcha);
        const { code } = await api.createRoom('karachi');
        if (!cancelled) router.replace(`/r/${code}`);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof NeedsCaptcha) setName(null);
        else setError(err instanceof Error && err.message ? `Could not open a room: ${err.message}` : 'Could not open a room.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [name, captcha, router]);

  if (!name) {
    return (
      <NameGate
        title="Host a table"
        initialName={storedName() ?? ''}
        onDone={(n, token) => {
          rememberName(n);
          setCaptcha(token);
          setName(n);
        }}
      />
    );
  }
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6">
      <p className="font-display text-2xl">{error ? 'Hmm.' : 'Opening a room…'}</p>
      {error && <p className="text-ivory-200/70 text-center text-sm">{error}</p>}
    </main>
  );
}
