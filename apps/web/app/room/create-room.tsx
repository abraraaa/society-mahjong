'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { NameGate } from '@/components/name-gate';
import { Trouble, Waiting } from '@/components/trouble';
import { ApiError, api } from '@/lib/live/client';
import { NeedsCaptcha, ensureSession, rememberName, storedName } from '@/lib/supabase/session';

/** Host a table: a name, a room, and straight to the lobby with a code to share. */
export function CreateRoom() {
  const router = useRouter();
  const [name, setName] = useState<string | null>(() => (typeof window === 'undefined' ? null : storedName()));
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

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
  }, [name, captcha, router, attempt]);

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
  if (error) {
    return (
      <Trouble
        message={error}
        onRetry={() => {
          setError(null);
          setAttempt((n) => n + 1);
        }}
      />
    );
  }
  return <Waiting>Opening a room…</Waiting>;
}
