'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { NameGate } from '@/components/name-gate';
import { Trouble, Waiting } from '@/components/trouble';
import { api } from '@/lib/live/client';
import { plainError } from '@/lib/live/plain';
import { NeedsCaptcha, ensureSession } from '@/lib/supabase/session';
import { useGuestName } from '@/lib/supabase/use-guest-name';

/** Host a table: a name, a room, and straight to the lobby with a code to share. */
export function CreateRoom() {
  const router = useRouter();
  const { name, initialName, choose, askAgain } = useGuestName();
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
        if (err instanceof NeedsCaptcha) askAgain();
        else setError(plainError(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [name, captcha, router, attempt, askAgain]);

  if (!name) {
    return (
      <NameGate
        title="Host a table"
        initialName={initialName}
        onDone={(n, token) => {
          setCaptcha(token);
          choose(n);
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
          // A captcha token is spent once it's been tried; with no session yet, a retry goes back to the gate for a fresh one.
          setCaptcha(null);
          setAttempt((n) => n + 1);
        }}
      />
    );
  }
  return <Waiting>Opening a room…</Waiting>;
}
