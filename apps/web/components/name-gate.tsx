'use client';
import { useEffect, useRef, useState } from 'react';
import { solveCaptcha } from '@/lib/captcha';
import { NAME_MAX, seatName } from '@/lib/name-gate';

/**
 * The one question a guest is asked. Submitting also runs an invisible
 * hCaptcha, whose token the anonymous sign-in needs; most people never see it.
 */
export function NameGate({ title, initialName = '', onDone }: { title: string; initialName?: string; onDone: (name: string, captchaToken: string) => void }) {
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const captchaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // The box is on screen before the page can listen to it, so a name typed in
  // that moment is in the box but was never heard. Pick it up once we're live.
  // The input is uncontrolled so React never writes over what's been typed.
  useEffect(() => {
    const typed = inputRef.current?.value;
    if (typed !== undefined) setName(typed);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = seatName(name);
    if (!n || busy || !captchaRef.current) return;
    setBusy(true);
    setError(null);
    try {
      const token = await solveCaptcha(captchaRef.current);
      onDone(n, token);
    } catch (err) {
      setError(err instanceof Error && err.message.includes('load') ? 'Could not reach the bot check. Try again, or a different network.' : 'The bot check did not go through. Try again.');
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-10">
      <div className="space-y-2">
        <p className="eyebrow">{title}</p>
        <h1 className="font-display text-3xl">What should the table call you?</h1>
        <p className="text-ivory-200/70 text-sm">No account, no password. Just the name your friends know you by.</p>
      </div>
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <input
          ref={inputRef}
          autoFocus
          className="rounded-2xl bg-felt-800/60 px-4 py-3 text-lg text-ivory-50 outline-none ring-ivory-50/30 focus:ring-2"
          placeholder="Your name"
          maxLength={NAME_MAX}
          defaultValue={initialName}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
        />
        <button className="btn btn-primary btn-block min-h-[52px] text-[18px]" disabled={!seatName(name) || busy} type="submit">
          {busy ? 'One moment…' : 'Sit down'}
        </button>
        {error && <p className="text-center text-sm text-red-300">{error}</p>}
        <div ref={captchaRef} />
        <p className="text-ivory-200/40 text-center text-[11px] leading-snug">
          Protected by hCaptcha. Its{' '}
          <a className="underline" href="https://www.hcaptcha.com/privacy" target="_blank" rel="noreferrer">
            privacy policy
          </a>{' '}
          and{' '}
          <a className="underline" href="https://www.hcaptcha.com/terms" target="_blank" rel="noreferrer">
            terms
          </a>{' '}
          apply.
        </p>
      </form>
    </main>
  );
}
